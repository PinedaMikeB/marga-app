# Marga Dot Matrix Print Bridge

This bridge lets the Billing module print invoices to an Epson LX dot-matrix printer as RAW text. It avoids Chrome or Firefox rasterizing the invoice, which can make LX-310 output unreadable.

## EXE Install

For Windows 10 64-bit staff PCs:

1. Extract the `MargaDotMatrixBridge-win-x64` ZIP.
2. Double-click `Install-MargaDotMatrixBridge.cmd`.
3. Leave the first bridge window running, or restart Windows once.
4. In the Billing module, click `Dot Matrix Print`.

The installer copies `MargaDotMatrixBridge.exe` to `%LOCALAPPDATA%\MargaDotMatrixBridge` and creates a Windows logon startup task for the current user.

## Windows Setup

This section is only needed if you are using the PowerShell fallback bridge instead of the EXE.

1. Open PowerShell on the Windows PC connected to the LX printer.
2. Optional but recommended: install the bridge to auto-start at Windows login:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-startup-task.ps1
```

3. To start it immediately without restarting Windows, run:

```powershell
.\start-marga-dotmatrix-bridge.cmd
```

4. In the Billing module, click `Dot Matrix Print`.

The bridge uses the Windows default printer unless `config.json` contains a `printerName`.

Example `config.json`:

```json
{
  "printerName": "EPSON LX-310"
}
```

The printer name must match the Windows printer name in Settings > Printers & scanners.

Daily use should not require downloading files or opening Notepad. Once this bridge is running, the web app sends invoice text directly to the local raw printer bridge.
