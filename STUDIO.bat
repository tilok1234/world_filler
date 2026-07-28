@echo off
rem Opens the Director Studio: a local browser UI for directing worlds —
rem edit recipes, lock placements, reroll regions, regenerate — all over
rem the same audited pipeline. Local only (127.0.0.1); closing this
rem window stops it. Requires Node.js, nothing else.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
start "" http://localhost:8787
node dist\src\cli.js serve 8787
pause
