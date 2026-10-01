@echo off
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 24.21.0 LTS or add it to PATH.
  pause
  exit /b 1
)
node launcher\start.js --postgres
set "VACATION_EXIT=%ERRORLEVEL%"
echo.
echo Exit code: %VACATION_EXIT%
popd
pause
exit /b %VACATION_EXIT%
