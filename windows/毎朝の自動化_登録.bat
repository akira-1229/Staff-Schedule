@echo off
rem ============================================================
rem  Morning automation (Windows)
rem   1) 06:30 every day : send new schedule PDFs to GitHub
rem   2) 07:00 every day : open today's schedule in the browser
rem   3) Windows sign-in : open today's schedule
rem  To change times, edit PUSH_TIME / OPEN_TIME and run again.
rem ============================================================
set URL=https://akira-1229.github.io/Staff-Schedule/
set PUSH_TIME=06:30
set OPEN_TIME=07:00

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-push.ps1" -Register -Time %PUSH_TIME%

schtasks /create /tn "StaffScheduleMorning" /sc daily /st %OPEN_TIME% /tr "explorer.exe %URL%" /f >nul
if errorlevel 1 (
  echo [NG] Failed to register the %OPEN_TIME% open task.
) else (
  echo [OK] Registered: open %URL% every day at %OPEN_TIME%.
)

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
(
  echo [InternetShortcut]
  echo URL=%URL%
) > "%STARTUP%\StaffSchedule.url"
echo [OK] Added to Startup: opens when you sign in.
echo.
pause
