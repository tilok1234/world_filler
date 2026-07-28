@echo off
rem Opens the World Filler read-only viewer (viewer\index.html) in the
rem default browser, plus the outputs\export folder in Explorer when it
rem exists, so a generated content pack can be dragged straight onto the
rem page. The viewer never writes anything; see docs\WORKFLOW.md.
start "" "%~dp0viewer\index.html"
if exist "%~dp0outputs\export" start "" "%~dp0outputs\export"
