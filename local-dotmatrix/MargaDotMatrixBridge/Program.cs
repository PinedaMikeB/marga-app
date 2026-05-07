using System.ComponentModel;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

const int DefaultPort = 8765;
const string AppName = "Marga Dot Matrix Print Bridge";
const string ExeName = "MargaDotMatrixBridge.exe";

if (args.Any(arg => arg.Equals("--install", StringComparison.OrdinalIgnoreCase))) {
    InstallBridge();
    return;
}

if (args.Any(arg => arg.Equals("--uninstall", StringComparison.OrdinalIgnoreCase))) {
    UninstallBridge();
    return;
}

var config = BridgeConfig.Load();
var port = ReadInt(Environment.GetEnvironmentVariable("MARGA_DOTMATRIX_PORT")) ?? config.Port ?? DefaultPort;
var printerName = FirstNonBlank(
    Environment.GetEnvironmentVariable("MARGA_DOTMATRIX_PRINTER"),
    config.PrinterName,
    RawPrinter.GetDefaultPrinterName()
);

if (string.IsNullOrWhiteSpace(printerName)) {
    throw new InvalidOperationException("No printerName configured and no Windows default printer was found.");
}

Console.Title = AppName;
Console.WriteLine($"{AppName} running on http://127.0.0.1:{port}");
Console.WriteLine($"Printer: {printerName}");
Console.WriteLine("Keep this running while billing invoices are printed.");

var listener = new TcpListener(IPAddress.Loopback, port);
try {
    listener.Start();
} catch (SocketException ex) when (ex.SocketErrorCode == SocketError.AddressAlreadyInUse) {
    Console.WriteLine($"Port {port} is already in use. The {AppName} is probably already running.");
    Console.WriteLine("You can close this window and click Dot Matrix Print in the Billing module.");
    return;
}

while (true) {
    using var client = listener.AcceptTcpClient();
    try {
        using var stream = client.GetStream();
        var request = HttpRequest.Read(stream);

        if (request.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase)) {
            HttpResponse.Write(stream, 200, "OK", new { ok = true });
            continue;
        }

        if (request.Method.Equals("GET", StringComparison.OrdinalIgnoreCase) && request.Path == "/health") {
            HttpResponse.Write(stream, 200, "OK", new { ok = true, printerName });
            continue;
        }

        if (!request.Method.Equals("POST", StringComparison.OrdinalIgnoreCase) || request.Path != "/print-invoice") {
            HttpResponse.Write(stream, 404, "Not Found", new { ok = false, error = "Not found" });
            continue;
        }

        var payload = JsonSerializer.Deserialize<PrintPayload>(request.Body, new JsonSerializerOptions {
            PropertyNameCaseInsensitive = true
        }) ?? new PrintPayload();
        if (string.IsNullOrEmpty(payload.Text)) {
            HttpResponse.Write(stream, 400, "Bad Request", new { ok = false, error = "Missing text" });
            continue;
        }

        var jobName = string.IsNullOrWhiteSpace(payload.JobName) ? "Marga Billing Invoice" : payload.JobName.Trim();
        var bytes = Encoding.ASCII.GetBytes(payload.Text);
        RawPrinter.SendBytes(printerName, jobName, bytes);
        HttpResponse.Write(stream, 200, "OK", new { ok = true, printerName });
        Console.WriteLine($"Printed invoice job: {jobName}");
    }
    catch (Exception ex) {
        try {
            using var stream = client.GetStream();
            HttpResponse.Write(stream, 500, "Server Error", new { ok = false, error = ex.Message });
        } catch {
            // Client may already be disconnected.
        }
        Console.Error.WriteLine(ex);
    }
}

static void InstallBridge() {
    var installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MargaDotMatrixBridge");
    Directory.CreateDirectory(installDir);

    var sourceExe = Environment.ProcessPath ?? throw new InvalidOperationException("Cannot resolve current executable path.");
    var targetExe = Path.Combine(installDir, ExeName);
    File.Copy(sourceExe, targetExe, true);

    var configPath = Path.Combine(installDir, "config.json");
    if (!File.Exists(configPath)) {
        var printerName = RawPrinter.GetDefaultPrinterName() ?? "EPSON LX-310";
        File.WriteAllText(configPath, JsonSerializer.Serialize(new BridgeConfig {
            PrinterName = printerName,
            Port = DefaultPort
        }, new JsonSerializerOptions { WriteIndented = true }));
    }

    RunSchtasks($"/Create /TN \"{AppName}\" /TR \"\\\"{targetExe}\\\"\" /SC ONLOGON /RL LIMITED /F");
    RunSchtasks($"/Run /TN \"{AppName}\"");

    Console.WriteLine($"{AppName} installed.");
    Console.WriteLine($"Installed path: {targetExe}");
    Console.WriteLine($"Config path: {configPath}");
}

static void UninstallBridge() {
    RunSchtasks($"/Delete /TN \"{AppName}\" /F", allowFailure: true);
    Console.WriteLine($"{AppName} startup task removed.");
}

static void RunSchtasks(string arguments, bool allowFailure = false) {
    using var process = Process.Start(new ProcessStartInfo {
        FileName = "schtasks.exe",
        Arguments = arguments,
        UseShellExecute = false,
        RedirectStandardError = true,
        RedirectStandardOutput = true,
        CreateNoWindow = true
    }) ?? throw new InvalidOperationException("Failed to start schtasks.exe.");

    process.WaitForExit();
    if (process.ExitCode != 0 && !allowFailure) {
        throw new InvalidOperationException($"schtasks failed: {process.StandardOutput.ReadToEnd()} {process.StandardError.ReadToEnd()}");
    }
}

static int? ReadInt(string? value) => int.TryParse(value, out var parsed) ? parsed : null;

static string? FirstNonBlank(params string?[] values) => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

sealed class BridgeConfig {
    public string? PrinterName { get; set; }
    public int? Port { get; set; }

    public static BridgeConfig Load() {
        var candidates = new[] {
            Path.Combine(AppContext.BaseDirectory, "config.json"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MargaDotMatrixBridge", "config.json")
        };

        foreach (var path in candidates) {
            if (!File.Exists(path)) continue;
            try {
                return JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(path)) ?? new BridgeConfig();
            } catch {
                return new BridgeConfig();
            }
        }

        return new BridgeConfig();
    }
}


sealed class PrintPayload {
    public string? JobName { get; set; }
    public string? Text { get; set; }
}

sealed class HttpRequest {
    public required string Method { get; init; }
    public required string Path { get; init; }
    public required string Body { get; init; }

    public static HttpRequest Read(NetworkStream stream) {
        var bytes = new List<byte>();
        var buffer = new byte[8192];
        var contentLength = 0;
        var headerBytes = -1;

        while (true) {
            var read = stream.Read(buffer, 0, buffer.Length);
            if (read <= 0) break;
            bytes.AddRange(buffer.Take(read));

            var headerEnd = FindHeaderEnd(bytes);
            if (headerEnd >= 0 && headerBytes < 0) {
                headerBytes = headerEnd + 4;
                var headerText = Encoding.UTF8.GetString(bytes.Take(headerEnd).ToArray());
                foreach (var line in headerText.Split("\r\n")) {
                    if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)
                        && int.TryParse(line["Content-Length:".Length..].Trim(), out var parsed)) {
                        contentLength = parsed;
                    }
                }
            }

            if (headerBytes >= 0 && bytes.Count - headerBytes >= contentLength) break;
        }

        var requestText = Encoding.UTF8.GetString(bytes.ToArray());
        var split = requestText.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        if (split < 0) throw new InvalidOperationException("Invalid HTTP request.");
        var header = requestText[..split];
        var body = requestText[(split + 4)..];
        var parts = header.Split("\r\n")[0].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) throw new InvalidOperationException("Invalid HTTP request line.");

        return new HttpRequest {
            Method = parts[0],
            Path = parts[1],
            Body = body
        };
    }

    static int FindHeaderEnd(List<byte> bytes) {
        for (var i = 0; i <= bytes.Count - 4; i++) {
            if (bytes[i] == 13 && bytes[i + 1] == 10 && bytes[i + 2] == 13 && bytes[i + 3] == 10) return i;
        }
        return -1;
    }
}

static class HttpResponse {
    public static void Write(NetworkStream stream, int statusCode, string statusText, object body) {
        var json = JsonSerializer.Serialize(body, new JsonSerializerOptions {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        });
        var bodyBytes = Encoding.UTF8.GetBytes(json);
        var header = string.Join("\r\n", new[] {
            $"HTTP/1.1 {statusCode} {statusText}",
            "Content-Type: application/json; charset=utf-8",
            $"Content-Length: {bodyBytes.Length}",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type",
            "Access-Control-Allow-Private-Network: true",
            "Connection: close",
            "",
            ""
        });
        var headerBytes = Encoding.ASCII.GetBytes(header);
        stream.Write(headerBytes, 0, headerBytes.Length);
        stream.Write(bodyBytes, 0, bodyBytes.Length);
    }
}

static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    sealed class DocInfo {
        [MarshalAs(UnmanagedType.LPStr)] public string? pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string? pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string? pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    static extern bool OpenPrinter(string printerName, out IntPtr printerHandle, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    static extern bool StartDocPrinter(IntPtr printerHandle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo docInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr printerHandle, byte[] bytes, int count, out int written);

    [DllImport("winspool.drv", EntryPoint = "GetDefaultPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool GetDefaultPrinter(StringBuilder printerName, ref int size);

    public static string? GetDefaultPrinterName() {
        var size = 0;
        GetDefaultPrinter(new StringBuilder(0), ref size);
        if (size <= 0) return null;
        var builder = new StringBuilder(size);
        return GetDefaultPrinter(builder, ref size) ? builder.ToString() : null;
    }

    public static void SendBytes(string printerName, string jobName, byte[] bytes) {
        if (!OpenPrinter(printerName, out var handle, IntPtr.Zero)) {
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"OpenPrinter failed: {printerName}");
        }

        try {
            var doc = new DocInfo {
                pDocName = jobName,
                pDataType = "RAW"
            };

            if (!StartDocPrinter(handle, 1, doc)) throw new Win32Exception(Marshal.GetLastWin32Error(), "StartDocPrinter failed.");
            try {
                if (!StartPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error(), "StartPagePrinter failed.");
                try {
                    if (!WritePrinter(handle, bytes, bytes.Length, out var written)) {
                        throw new Win32Exception(Marshal.GetLastWin32Error(), "WritePrinter failed.");
                    }
                    if (written != bytes.Length) throw new IOException($"WritePrinter wrote {written} of {bytes.Length} bytes.");
                } finally {
                    EndPagePrinter(handle);
                }
            } finally {
                EndDocPrinter(handle);
            }
        } finally {
            ClosePrinter(handle);
        }
    }
}
