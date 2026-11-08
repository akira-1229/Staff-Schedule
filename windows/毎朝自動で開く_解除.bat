@echo off
rem Stop opening the schedule automatically on this PC
schtasks /delete /tn "StaffScheduleMorning" /f
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\StaffSchedule.url" 2>nul
echo [OK] Auto-open has been turned off.
pause
