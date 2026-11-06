# ============================================================
#  Auto commit & push of monthly schedule PDFs (YYYY-MM.pdf)
#
#  Normal run : commits new/changed/deleted YYYY-MM.pdf files in
#               the schedule folder and pushes them to GitHub.
#               Does nothing when there is no change.
#  -Register  : registers a daily Windows task that runs this
#               script (default 06:30, runs later if the PC was off).
#  -Unregister: removes that task.
#
#  Log file   : windows\auto-push.log
#  (ASCII only on purpose: Windows PowerShell 5.1 misreads
#   UTF-8 files without BOM.)
# ============================================================
param(
  [switch]$Register,
  [switch]$Unregister,
  [string]$Time = '06:30'
)

$TaskName = 'StaffSchedulePush'
$Root = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $PSScriptRoot 'auto-push.log'

function Write-Log([string]$msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

if ($Unregister) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "[OK] Auto push task removed."
  exit 0
}

if ($Register) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"')
  $trigger = New-ScheduledTaskTrigger -Daily -At $Time
  # StartWhenAvailable: if the PC was off at that time, run as soon as possible
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host ("[OK] Registered: send new schedule PDFs to GitHub every day at " + $Time + ".")
  exit 0
}

# ---------- find git (PATH, Git for Windows, or GitHub Desktop's bundled git) ----------
$git = $null
$cmd = Get-Command git -ErrorAction SilentlyContinue
if ($cmd) { $git = $cmd.Source }
if (-not $git) {
  foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")) {
    if (Test-Path $p) { $git = $p; break }
  }
}
if (-not $git) {
  $gd = Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($gd) { $git = $gd.FullName }
}
if (-not $git) {
  Write-Log 'ERROR: git was not found. Please install Git for Windows (https://git-scm.com/download/win).'
  exit 1
}

function Invoke-Git {
  $out = & $git -C $Root @args 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Out = $out.Trim() }
}

# ---------- get latest from GitHub first ----------
$r = Invoke-Git pull --rebase --autostash
if ($r.Code -ne 0) {
  Write-Log ('ERROR: git pull failed: ' + $r.Out)
  exit 1
}

# ---------- stage only YYYY-MM.pdf files in the top folder ----------
$r = Invoke-Git add -A -- ':(glob)[0-9][0-9][0-9][0-9]-[0-9][0-9].pdf'
if ($r.Code -ne 0) {
  Write-Log ('ERROR: git add failed: ' + $r.Out)
  exit 1
}
$staged = (Invoke-Git diff --cached --name-only).Out
if (-not $staged) {
  Write-Log 'No new or changed PDF. Nothing to send.'
  exit 0
}
$files = ($staged -split "`r?`n" | Where-Object { $_ }) -join ', '

# Use a fallback author only when git has none configured
$ident = @()
if (-not (Invoke-Git config user.email).Out) {
  $ident = @('-c', 'user.name=StaffSchedule', '-c', 'user.email=staff-schedule@users.noreply.github.com')
}
$r = Invoke-Git @ident commit -q -m ('Update schedule: ' + $files)
if ($r.Code -ne 0) {
  Write-Log ('ERROR: git commit failed: ' + $r.Out)
  exit 1
}

$r = Invoke-Git push
if ($r.Code -ne 0) {
  Write-Log ('ERROR: git push failed (will retry next run): ' + $r.Out)
  exit 1
}
Write-Log ('OK: sent ' + $files)
exit 0
