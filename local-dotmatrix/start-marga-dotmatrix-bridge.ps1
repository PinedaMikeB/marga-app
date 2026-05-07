Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$BridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $BridgeRoot 'config.json'
$Config = $null
if (Test-Path $ConfigPath) {
    $Config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
}

function Get-ConfigValue {
    param([string] $Name)
    if (-not $Config) { return $null }
    $Property = $Config.PSObject.Properties[$Name]
    if ($Property) { return $Property.Value }
    return $null
}

$ConfiguredPort = Get-ConfigValue -Name 'port'
$ConfiguredPrinterName = Get-ConfigValue -Name 'printerName'

$Port = if ($env:MARGA_DOTMATRIX_PORT) {
    [int]$env:MARGA_DOTMATRIX_PORT
} elseif ($ConfiguredPort) {
    [int]$ConfiguredPort
} else {
    8765
}

$PrinterName = if ($env:MARGA_DOTMATRIX_PRINTER) {
    [string]$env:MARGA_DOTMATRIX_PRINTER
} elseif ($ConfiguredPrinterName) {
    [string]$ConfiguredPrinterName
} else {
    $DefaultPrinter = Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1
    if ($DefaultPrinter) { [string]$DefaultPrinter.Name } else { '' }
}

if (-not $PrinterName) {
    throw 'No printerName configured and no Windows default printer was found.'
}

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public class RawPrinterBridge
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)]
        public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, Int32 dwCount, out Int32 dwWritten);

    public static void SendBytes(string printerName, string jobName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenPrinter failed: " + printerName);
        }

        try
        {
            DOCINFOA di = new DOCINFOA();
            di.pDocName = jobName;
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di)) throw new Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter failed.");
            try
            {
                if (!StartPagePrinter(hPrinter)) throw new Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter failed.");
                try
                {
                    int written;
                    if (!WritePrinter(hPrinter, bytes, bytes.Length, out written)) throw new Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter failed.");
                    if (written != bytes.Length) throw new Exception("WritePrinter wrote " + written + " of " + bytes.Length + " bytes.");
                }
                finally
                {
                    EndPagePrinter(hPrinter);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
'@

function Write-HttpResponse {
    param(
        [Parameter(Mandatory = $true)] [System.Net.Sockets.NetworkStream] $Stream,
        [int] $StatusCode = 200,
        [string] $StatusText = 'OK',
        [string] $Body = '{"ok":true}'
    )

    $BodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $Header = @(
        "HTTP/1.1 $StatusCode $StatusText",
        'Content-Type: application/json; charset=utf-8',
        "Content-Length: $($BodyBytes.Length)",
        'Access-Control-Allow-Origin: *',
        'Access-Control-Allow-Methods: POST, OPTIONS',
        'Access-Control-Allow-Headers: Content-Type',
        'Access-Control-Allow-Private-Network: true',
        'Connection: close',
        '',
        ''
    ) -join "`r`n"
    $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
    $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
    $Stream.Write($BodyBytes, 0, $BodyBytes.Length)
}

function Read-HttpRequest {
    param([Parameter(Mandatory = $true)] [System.Net.Sockets.NetworkStream] $Stream)

    $Buffer = New-Object byte[] 65536
    $Bytes = New-Object System.Collections.Generic.List[byte]
    do {
        $Read = $Stream.Read($Buffer, 0, $Buffer.Length)
        if ($Read -le 0) { break }
        for ($Index = 0; $Index -lt $Read; $Index++) {
            $Bytes.Add($Buffer[$Index])
        }
        $TextSoFar = [System.Text.Encoding]::UTF8.GetString($Bytes.ToArray())
        if ($TextSoFar.Contains("`r`n`r`n")) {
            $HeaderText = $TextSoFar.Substring(0, $TextSoFar.IndexOf("`r`n`r`n"))
            $ContentLength = 0
            foreach ($Line in $HeaderText -split "`r`n") {
                if ($Line -match '^Content-Length:\s*(\d+)\s*$') {
                    $ContentLength = [int]$Matches[1]
                }
            }
            $HeaderByteCount = [System.Text.Encoding]::UTF8.GetByteCount($HeaderText + "`r`n`r`n")
            if (($Bytes.Count - $HeaderByteCount) -ge $ContentLength) { break }
        }
    } while ($Stream.DataAvailable -or $true)

    $RequestText = [System.Text.Encoding]::UTF8.GetString($Bytes.ToArray())
    $HeaderEnd = $RequestText.IndexOf("`r`n`r`n")
    if ($HeaderEnd -lt 0) { throw 'Invalid HTTP request.' }
    $HeaderText = $RequestText.Substring(0, $HeaderEnd)
    $Body = $RequestText.Substring($HeaderEnd + 4)
    $RequestLine = ($HeaderText -split "`r`n")[0]
    $Parts = $RequestLine -split '\s+'
    return @{
        Method = $Parts[0]
        Path = $Parts[1]
        Body = $Body
    }
}

$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$Listener.Start()
Write-Host "Marga Dot Matrix Print Bridge running on http://127.0.0.1:$Port"
Write-Host "Printer: $PrinterName"
Write-Host 'Keep this window open while printing billing invoices.'

try {
    while ($true) {
        $Client = $Listener.AcceptTcpClient()
        try {
            $Stream = $Client.GetStream()
            $Request = Read-HttpRequest -Stream $Stream

            if ($Request.Method -eq 'OPTIONS') {
                Write-HttpResponse -Stream $Stream
                continue
            }

            if ($Request.Method -ne 'POST' -or $Request.Path -ne '/print-invoice') {
                Write-HttpResponse -Stream $Stream -StatusCode 404 -StatusText 'Not Found' -Body '{"ok":false,"error":"Not found"}'
                continue
            }

            $Payload = $Request.Body | ConvertFrom-Json
            $Text = [string]$Payload.text
            if (-not $Text) {
                Write-HttpResponse -Stream $Stream -StatusCode 400 -StatusText 'Bad Request' -Body '{"ok":false,"error":"Missing text"}'
                continue
            }

            $JobName = if ($Payload.jobName) { [string]$Payload.jobName } else { 'Marga Billing Invoice' }
            $Bytes = [System.Text.Encoding]::ASCII.GetBytes($Text)
            [RawPrinterBridge]::SendBytes($PrinterName, $JobName, $Bytes)
            $JsonPrinter = ($PrinterName | ConvertTo-Json -Compress)
            Write-HttpResponse -Stream $Stream -Body "{""ok"":true,""printerName"":$JsonPrinter}"
            Write-Host "Printed invoice job: $JobName"
        }
        catch {
            $Message = ($_ | Out-String).Trim() -replace '\\', '\\' -replace '"', '\"' -replace "`r?`n", ' '
            try {
                Write-HttpResponse -Stream $Stream -StatusCode 500 -StatusText 'Server Error' -Body "{""ok"":false,""error"":""$Message""}"
            } catch {}
            Write-Warning $Message
        }
        finally {
            $Client.Close()
        }
    }
}
finally {
    $Listener.Stop()
}
