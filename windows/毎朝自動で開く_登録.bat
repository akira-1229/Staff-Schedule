@echo off
rem ============================================================
rem  Open today's staff schedule every morning (Windows)
rem   - Every day at 07:00 (Task Scheduler)
rem   - Also when you sign in to Windows (Startup folder)
rem  To change the time, edit TIME below and run this file again.
rem ============================================================
set URL=https://akira-1229.github.io/Staff-Schedule/
set TIME=07:00

schtasks /create /tn "StaffScheduleMorning" /sc daily /st %TIME% /tr "explorer.exe %URL%" /f
if errorlevel 1 (
  echo [NG] Failed to register the 07:00 task.
) else (
  echo [OK] Registered: open %URL% every day at %TIME%.
)

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
(
  echo [InternetShortcut]
  echo URL=%URL%
) > "%STARTUP%\StaffSchedule.url"
echo [OK] Added to Startup: opens when you sign in.
echo.
pause
