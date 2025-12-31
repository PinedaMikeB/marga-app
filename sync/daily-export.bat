@echo off
REM ============================================
REM MARGA Daily Export - Windows Batch Script
REM ============================================
REM 
REM SETUP (One Time):
REM 1. Install MySQL Command Line (comes with MySQL Workbench)
REM 2. Edit the config below with your database credentials
REM 3. Edit the export folder path (Google Drive recommended)
REM 4. Double-click this file to run daily export
REM
REM ============================================

REM --- CONFIGURATION (EDIT THESE!) ---
SET MYSQL_PATH="C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
SET DB_HOST=localhost
SET DB_NAME=maborot1_loloaborot
SET DB_USER=root
SET DB_PASS=your_password_here

REM Export folder - use Google Drive for easy access!
SET EXPORT_FOLDER=C:\Users\%USERNAME%\Google Drive\Marga Sync
REM Or use: SET EXPORT_FOLDER=C:\Users\%USERNAME%\Desktop\Marga Export

REM Days to look back (1 = yesterday, 7 = last week)
SET DAYS_BACK=1

REM --- END CONFIGURATION ---

echo ============================================
echo    MARGA Daily Export
echo ============================================
echo.

REM Create export folder if not exists
if not exist "%EXPORT_FOLDER%" mkdir "%EXPORT_FOLDER%"

REM Calculate date (yesterday by default)
for /f "tokens=1-3 delims=/" %%a in ('powershell -command "(Get-Date).AddDays(-%DAYS_BACK%).ToString('yyyy-MM-dd')"') do set SINCE_DATE=%%a

echo Exporting records since: %SINCE_DATE%
echo Export folder: %EXPORT_FOLDER%
echo.

REM Get today's date for filename
for /f "tokens=1-3 delims=/" %%a in ('powershell -command "(Get-Date).ToString('yyyyMMdd')"') do set TODAY=%%a

echo [1/5] Exporting tbl_billing...
%MYSQL_PATH% -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SELECT * FROM tbl_billing WHERE tmestamp >= '%SINCE_DATE%'" --batch --raw > "%EXPORT_FOLDER%\tbl_billing_%TODAY%.json" 2>nul
if %errorlevel%==0 (echo       Done!) else (echo       Failed or no records)

echo [2/5] Exporting tbl_machinereading...
%MYSQL_PATH% -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SELECT * FROM tbl_machinereading WHERE timestmp >= '%SINCE_DATE%'" --batch --raw > "%EXPORT_FOLDER%\tbl_machinereading_%TODAY%.json" 2>nul
if %errorlevel%==0 (echo       Done!) else (echo       Failed or no records)

echo [3/5] Exporting tbl_collections...
%MYSQL_PATH% -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SELECT * FROM tbl_collections WHERE tmestamp >= '%SINCE_DATE%'" --batch --raw > "%EXPORT_FOLDER%\tbl_collections_%TODAY%.json" 2>nul
if %errorlevel%==0 (echo       Done!) else (echo       Failed or no records)

echo [4/5] Exporting tbl_paymentinfo...
%MYSQL_PATH% -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SELECT * FROM tbl_paymentinfo WHERE tmestamp >= '%SINCE_DATE%'" --batch --raw > "%EXPORT_FOLDER%\tbl_paymentinfo_%TODAY%.json" 2>nul
if %errorlevel%==0 (echo       Done!) else (echo       Failed or no records)

echo [5/5] Exporting tbl_invoicenum...
%MYSQL_PATH% -h %DB_HOST% -u %DB_USER% -p%DB_PASS% %DB_NAME% -e "SELECT * FROM tbl_invoicenum WHERE tmestamp >= '%SINCE_DATE%'" --batch --raw > "%EXPORT_FOLDER%\tbl_invoicenum_%TODAY%.json" 2>nul
if %errorlevel%==0 (echo       Done!) else (echo       Failed or no records)

echo.
echo ============================================
echo    EXPORT COMPLETE!
echo ============================================
echo.
echo Files saved to: %EXPORT_FOLDER%
echo.
echo Next steps:
echo 1. Files should sync to Google Drive automatically
echo 2. On your Mac, open: https://margaapp.netlify.app/synclatest.html
echo 3. Upload the JSON files and click Sync
echo.
pause
