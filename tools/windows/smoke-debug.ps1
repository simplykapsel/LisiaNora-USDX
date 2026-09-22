param(
    [string]$Executable = 'ultrastardx.exe',
    [string]$Gdb = 'C:\lazarus\mingw\x86_64-win64\bin\gdb.exe'
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ($Executable -notin @('ultrastardx.exe','ultrastardx-lazarus.exe')) { throw 'Choose a development executable.' }
if (!(Test-Path -LiteralPath (Join-Path $repo 'game\config.ini'))) { & "$PSScriptRoot\init-dev.ps1" }
$local = Join-Path $repo '.local'
New-Item -ItemType Directory -Force -Path $local | Out-Null
$line = (Select-String -LiteralPath (Join-Path $repo 'src\base\UMain.pas') -SimpleMatch 'Delay := 1000 div MAX_FPS' | Select-Object -First 1).LineNumber
if (!$line) { throw 'Could not locate the main-loop breakpoint.' }
@"
set pagination off
set confirm off
set breakpoint pending on
set args -ConfigFile config.ini -ScoreFile Ultrastar-dev.db
break UMain.pas:$line
run
bt
print Done
print TicksCurrent
quit
"@ | Set-Content -LiteralPath (Join-Path $local 'smoke.gdb') -Encoding ASCII
$log = Join-Path $local 'smoke-gdb.log'
$err = Join-Path $local 'smoke-gdb-error.log'
$proc = Start-Process -FilePath $Gdb -ArgumentList @('-batch','-x','../.local/smoke.gdb',$Executable) -WorkingDirectory (Join-Path $repo 'game') -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
if (!$proc.WaitForExit(120000)) {
    # Stop only this debugger and its own test process after the bounded smoke test.
    & taskkill.exe /PID $proc.Id /T /F | Out-Null
    throw "Startup timed out; see $log"
}
$output = Get-Content -LiteralPath $log -Raw
if ($output -notmatch 'hit Breakpoint 1, MainLoop' -or $output -notmatch '\$1 = false') {
    Get-Content -LiteralPath $log -Tail 30
    throw "Breakpoint verification failed; see $log and $err"
}
Write-Host "PASS: $Executable loaded the library, rendered its first frame and stopped at UMain.pas:$line. Done=false."
Write-Host "Debugger evidence: $log"
