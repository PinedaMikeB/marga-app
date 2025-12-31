# ============================================
# MARGA Daily Export - PowerShell Script
# ============================================
# 
# SETUP (One Time):
# 1. Right-click this file > "Run with PowerShell"
# 2. Or open PowerShell and run: .\daily-export.ps1
#
# REQUIREMENTS:
# - MySQL Connector/NET or MySql.Data.dll
# - Or just use MySQL Workbench manually with daily-export.sql
#
# ============================================

# --- CONFIGURATION (EDIT THESE!) ---
$DB_HOST = "localhost"
$DB_NAME = "maborot1_loloaborot"
$DB_USER = "root"
$DB_PASS = "your_password_here"

# Export folder - Google Drive recommended!
$EXPORT_FOLDER = "$env:USERPROFILE\Google Drive\Marga Sync"
# Or use: $EXPORT_FOLDER = "$env:USERPROFILE\Desktop\Marga Export"

# Days to look back
$DAYS_BACK = 1

# --- END CONFIGURATION ---

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   MARGA Daily Export" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Calculate since date
$sinceDate = (Get-Date).AddDays(-$DAYS_BACK).ToString("yyyy-MM-dd HH:mm:ss")
$today = (Get-Date).ToString("yyyyMMdd")

Write-Host "Exporting records since: $sinceDate" -ForegroundColor Yellow
Write-Host "Export folder: $EXPORT_FOLDER" -ForegroundColor Yellow
Write-Host ""

# Create folder if not exists
if (!(Test-Path $EXPORT_FOLDER)) {
    New-Item -ItemType Directory -Path $EXPORT_FOLDER | Out-Null
}

# Tables to export with their timestamp fields
$tables = @(
    @{name="tbl_billing"; field="tmestamp"},
    @{name="tbl_machinereading"; field="timestmp"},
    @{name="tbl_collections"; field="tmestamp"},
    @{name="tbl_paymentinfo"; field="tmestamp"},
    @{name="tbl_invoicenum"; field="tmestamp"}
)

# Connection string
$connectionString = "Server=$DB_HOST;Database=$DB_NAME;Uid=$DB_USER;Pwd=$DB_PASS;"

try {
    # Load MySQL connector
    Add-Type -Path "C:\Program Files (x86)\MySQL\MySQL Connector NET 8.0\Assemblies\v4.8\MySql.Data.dll"
    
    $connection = New-Object MySql.Data.MySqlClient.MySqlConnection($connectionString)
    $connection.Open()
    
    foreach ($table in $tables) {
        $tableName = $table.name
        $fieldName = $table.field
        
        Write-Host "Exporting $tableName..." -NoNewline
        
        $query = "SELECT * FROM $tableName WHERE $fieldName >= '$sinceDate'"
        $command = New-Object MySql.Data.MySqlClient.MySqlCommand($query, $connection)
        $adapter = New-Object MySql.Data.MySqlClient.MySqlDataAdapter($command)
        $dataset = New-Object System.Data.DataSet
        $adapter.Fill($dataset) | Out-Null
        
        $rows = $dataset.Tables[0].Rows
        $count = $rows.Count
        
        if ($count -gt 0) {
            # Convert to JSON
            $data = @()
            foreach ($row in $rows) {
                $obj = @{}
                foreach ($col in $dataset.Tables[0].Columns) {
                    $obj[$col.ColumnName] = $row[$col.ColumnName]
                }
                $data += $obj
            }
            
            $jsonPath = "$EXPORT_FOLDER\${tableName}_$today.json"
            $data | ConvertTo-Json -Depth 10 | Out-File -FilePath $jsonPath -Encoding UTF8
            
            Write-Host " $count records" -ForegroundColor Green
        } else {
            Write-Host " No new records" -ForegroundColor Gray
        }
    }
    
    $connection.Close()
    
} catch {
    Write-Host ""
    Write-Host "ERROR: Could not connect to MySQL" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "ALTERNATIVE: Use MySQL Workbench with daily-export.sql" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   EXPORT COMPLETE!" -ForegroundColor Cyan  
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Files saved to: $EXPORT_FOLDER" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Files should sync to Google Drive automatically"
Write-Host "2. On your Mac, open: https://margaapp.netlify.app/synclatest.html"
Write-Host "3. Upload the JSON files and click Sync"
Write-Host ""
Read-Host "Press Enter to exit"
