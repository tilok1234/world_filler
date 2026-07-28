@echo off
rem THE one-click entry point. Requirements: Node.js (nodejs.org), nothing
rem else — the compiled program ships inside this download (dist\), so
rem there is no install step. First run generates content packs for the
rem two bundled example worlds (a few seconds), then the map viewer opens
rem with everything loaded. After that, double-clicking this just opens
rem the viewer again.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org
  echo ^(big green button, default options^), then double-click this again.
  pause
  exit /b 1
)

if not exist "outputs\export\fen-hollow-basic-direction-content\view.html" (
  echo First run: generating content packs for the example worlds...
  node dist\src\cli.js export fixtures\packs\fen-hollow fixtures\recipes\basic-direction.json
  if errorlevel 1 (pause & exit /b 1)
  node dist\src\cli.js export fixtures\packs\dust-hollow fixtures\recipes\basic-direction.json
  if errorlevel 1 (pause & exit /b 1)
)

call "%~dp0open-viewer.bat"
