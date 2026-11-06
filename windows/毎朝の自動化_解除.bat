@echo off
rem Turn off all morning automation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-push.ps1" -Unregister
schtasks /delete /tn "StaffScheduleMorning" /f
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\StaffSchedule.url" 2>nul
echo [OK] Auto-open and auto-push have been turned off.
pause
