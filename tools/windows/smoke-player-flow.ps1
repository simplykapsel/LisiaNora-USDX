param([ValidateSet('Fresh','Configured')][string]$Flow = 'Fresh', [string]$Song = 'D:\UltraStar Deluxe\songs\nowe\Hiroshi Kitadani - We are! (TV)\Hiroshi Kitadani - We are! (TV).txt', [string]$Python = 'python', [string]$LibraryPath, [string]$ExcludedSong)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (!(Test-Path -LiteralPath $Song)) { throw 'Choose an existing song loaded by the development game.' }
$local = Join-Path $repo '.local'
$env:USDX_TEST_FLOW = $Flow.ToLower()
$env:USDX_TEST_SONG = [IO.Path]::GetFullPath($Song)
$env:USDX_TEST_LIBRARY = $LibraryPath
$env:USDX_TEST_EXCLUDED_SONG = $ExcludedSong
$env:USDX_TEST_EXCHANGE = Join-Path $local ('player-flow-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $env:USDX_TEST_EXCHANGE | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'game\config.ini') -Destination (Join-Path $local 'player-flow.ini') -Force
$log = Join-Path $local 'player-flow.log'
$pythonExecutable = (Get-Command $Python).Source
$script = Join-Path $PSScriptRoot 'smoke-player-flow.py'
$proc = Start-Process -FilePath $pythonExecutable -WorkingDirectory $repo -ArgumentList "`"$script`"" -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $local 'player-flow-error.log')
if (!$proc.WaitForExit(60000)) { & taskkill.exe /PID $proc.Id /T /F | Out-Null; throw 'Player-flow test timed out.' }
if ($proc.ExitCode -ne 0 -or ([string](Get-Content -LiteralPath $log -Raw)) -notmatch 'PASS:') { Get-Content -LiteralPath $log -Tail 20; Get-Content (Join-Path $local 'player-flow-error.log') -Tail 12; throw 'Player-flow regression failed.' }
Write-Host "PASS: $Flow player setup, singing and busy-game rejection."
