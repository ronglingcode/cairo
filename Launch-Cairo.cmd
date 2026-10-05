@echo off
setlocal
title Cairo
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-openai.ps1" %*
set "cairoExitCode=%ERRORLEVEL%"
if not "%cairoExitCode%"=="0" (
    echo.
    echo Cairo could not start. See the error above.
    pause
)
exit /b %cairoExitCode%
