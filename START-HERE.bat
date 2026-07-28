@echo off
rem THE one-click entry point. Requirements: Node.js (nodejs.org), nothing
rem else — the compiled program ships inside this download (dist\).
rem
rem What it does:
rem   1. First run: generates content packs for the two bundled example
rem      worlds so there is something to look at immediately.
rem   2. Directs every world you dropped into worlds\ (see the README
rem      there) that has no content pack yet, using recipes\<name>.json
rem      when present, the example recipe otherwise.
rem   3. Opens the newest content pack's map (view.html).
rem To regenerate a world, delete its folder under outputs\export first.
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org
  echo ^(big green button, default options^), then double-click this again.
  pause
  exit /b 1
)

if not exist "outputs\export\fen-hollow-basic-direction-content\view.html" (
  echo First run: generating the example worlds...
  node dist\src\cli.js export fixtures\packs\fen-hollow fixtures\recipes\basic-direction.json
  if errorlevel 1 (pause & exit /b 1)
  node dist\src\cli.js export fixtures\packs\dust-hollow fixtures\recipes\basic-direction.json
  if errorlevel 1 (pause & exit /b 1)
)

set "failed="
for /d %%W in ("worlds\*") do (
  if exist "%%W\manifest.json" (
    set "recipe=fixtures\recipes\basic-direction.json"
    if exist "recipes\%%~nxW.json" set "recipe=recipes\%%~nxW.json"
    if not exist "outputs\export\%%~nxW-content\view.html" (
      echo Directing %%~nxW with !recipe! ...
      node dist\src\cli.js export "%%W" "!recipe!" "outputs\export\%%~nxW-content"
      if errorlevel 1 set "failed=!failed! %%~nxW"
    )
  )
)
if defined failed (
  echo.
  echo Some worlds were REFUSED ^(details above^):!failed!
  echo A refusal means the world or recipe has a real problem the audit
  echo caught - nothing was written for those worlds.
  pause
)

call "%~dp0open-viewer.bat"
