@echo off
rem Opens the World Filler inspector. Preferred path: the newest export's
rem self-contained view.html (everything pre-loaded — emitted by
rem `wf-fill export` beside the pack). Fallback when no export exists yet:
rem the empty viewer plus the outputs\export folder for drag/pick loading.
rem The viewer never writes anything; see docs\WORKFLOW.md.
setlocal
if exist "%~dp0outputs\export" (
  for /f "delims=" %%D in ('dir /b /ad /o-d "%~dp0outputs\export" 2^>nul') do (
    if exist "%~dp0outputs\export\%%D\view.html" (
      start "" "%~dp0outputs\export\%%D\view.html"
      exit /b 0
    )
  )
)
start "" "%~dp0viewer\index.html"
if exist "%~dp0outputs\export" start "" "%~dp0outputs\export"
