@echo off
rem One-click setup: copies World Filler from wherever this ZIP was
rem unzipped into Documents\world_filler, installs and builds it there,
rem exports a first content pack for each fixture world, and opens the
rem viewer. Safe to re-run from a newer ZIP: it updates the Documents
rem copy in place and rebuilds. Requires Node.js >= 24.15 (nodejs.org).
setlocal
rem Resolve the REAL Documents folder: with OneDrive, "Documents" in
rem Explorer is often OneDrive\Documents, not %USERPROFILE%\Documents.
set "docs="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('MyDocuments')"`) do set "docs=%%D"
if not defined docs set "docs=%USERPROFILE%\Documents"
set "dest=%docs%\world_filler"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org (the
  echo current version), then run this again.
  pause
  exit /b 1
)

echo Installing World Filler into "%dest%" ...
robocopy "%~dp0." "%dest%" /e /xd node_modules dist outputs .git >nul
if errorlevel 8 (
  echo Copy failed - is "%dest%" open in another program?
  pause
  exit /b 1
)

cd /d "%dest%"
echo Installing dependencies ...
call npm install
if errorlevel 1 (pause & exit /b 1)
echo Building ...
call npm run build
if errorlevel 1 (pause & exit /b 1)

echo Exporting the fixture worlds ...
node dist\src\cli.js export fixtures\packs\fen-hollow fixtures\recipes\basic-direction.json
if errorlevel 1 (pause & exit /b 1)
node dist\src\cli.js export fixtures\packs\dust-hollow fixtures\recipes\basic-direction.json
if errorlevel 1 (pause & exit /b 1)

echo.
echo Done. World Filler now lives in "%dest%".
echo Opening the newest export in the viewer ...
call "%dest%\open-viewer.bat"
echo (Next time: just use open-viewer.bat inside Documents\world_filler.)
pause
