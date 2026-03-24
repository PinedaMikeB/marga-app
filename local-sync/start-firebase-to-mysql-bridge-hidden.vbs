Option Explicit

Dim shell, fso, wmi, scriptDir, stateDir, stdoutLog, stderrLog, command, process

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
stateDir = scriptDir & "\state"
stdoutLog = stateDir & "\firebase-to-mysql-stdout.log"
stderrLog = stateDir & "\firebase-to-mysql-stderr.log"

If Not fso.FolderExists(stateDir) Then
  fso.CreateFolder stateDir
End If

For Each process In wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'")
  If Not IsNull(process.CommandLine) Then
    If InStr(1, process.CommandLine, "run-local-sync.mjs", vbTextCompare) > 0 And InStr(1, process.CommandLine, "--apply", vbTextCompare) > 0 Then
      WScript.Quit 0
    End If
  End If
Next

command = "cmd.exe /c cd /d """ & scriptDir & """ && node run-local-sync.mjs --baseline live --apply --loop-seconds 30 --out-dir .\output\firebase-to-mysql --state-file .\state\firebase-to-mysql-last-run.json >> """ & stdoutLog & """ 2>> """ & stderrLog & """"

shell.Run command, 0, False
