Option Explicit

Dim shell, fso, wmi, scriptDir, stateDir, stdoutLog, stderrLog, command, process

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
stateDir = scriptDir & "\state"
stdoutLog = stateDir & "\dashboard-stdout.log"
stderrLog = stateDir & "\dashboard-stderr.log"

If Not fso.FolderExists(stateDir) Then
  fso.CreateFolder stateDir
End If

For Each process In wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'")
  If Not IsNull(process.CommandLine) Then
    If InStr(1, process.CommandLine, "dashboard-server.mjs", vbTextCompare) > 0 Then
      WScript.Quit 0
    End If
  End If
Next

command = "cmd.exe /c cd /d """ & scriptDir & """ && node dashboard-server.mjs --foreground-supervisor >> """ & stdoutLog & """ 2>> """ & stderrLog & """"

Do
  shell.Run command, 0, True
  WScript.Sleep 5000
Loop
