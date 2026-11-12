param([switch]$Download, [string]$MsysRoot = 'C:\msys64')
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$bash = Join-Path $MsysRoot 'usr\bin\bash.exe'
$env:MSYSTEM = 'UCRT64'
$env:CHERE_INVOKING = '1'
Push-Location $repo
try {
    # The upstream make target downloads, verifies and builds missing libraries.
    & $bash --login -c 'make -C dists/windows install'
    if ($LASTEXITCODE -ne 0) { throw 'Building the upstream Windows dependencies failed.' }
} finally { Pop-Location }
