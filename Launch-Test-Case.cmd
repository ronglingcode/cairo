@echo off
setlocal
title Cairo simulation
cd /d "%~dp0"
call npm.cmd run build
if errorlevel 1 goto failed
call npm.cmd run test:case -- %*
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo Cairo simulation could not start. See the error above.
pause
exit /b 1
