@echo off
rem Send new schedule PDFs to GitHub right now (same as the 06:30 task).
rem Run this once after setup: if a GitHub sign-in window appears, sign in.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-push.ps1"
echo.
pause
