param([switch]$Wait)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$game = Join-Path $repo 'game'
$exe = Join-Path $game 'ultrastardx.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Build USDX first.' }
if (!(Test-Path -LiteralPath (Join-Path $game 'config.ini'))) { & "$PSScriptRoot\init-dev.ps1" }
$existing = Get-Process ultrastardx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
if ($existing) { throw 'Development USDX is already running. Close it before starting another instance.' }
$process = Start-Process -FilePath $exe -WorkingDirectory $game -ArgumentList @('-ConfigFile','config.ini','-ScoreFile','Ultrastar-dev.db') -WindowStyle Normal -PassThru
Write-Host "Started development USDX (PID $($process.Id)): $exe"
if ($Wait) { $process.WaitForExit(); exit $process.ExitCode }
