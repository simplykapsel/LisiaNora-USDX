param(
    [switch]$SkipBuild,
    [switch]$GameOnly,
    [string]$MsysRoot = 'C:\msys64',
    [string]$FpcBin = 'C:\lazarus\fpc\3.2.2\bin\x86_64-win64'
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $repo
try {
    if (!$SkipBuild) { & "$PSScriptRoot\build.ps1" -Configuration Release -MsysRoot $MsysRoot -FpcBin $FpcBin }
    if ($GameOnly) {
        & python "$PSScriptRoot\package.py"
    } else {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Client dependency installation failed.' }
        & node 'tools/usdx-bridge/build-windows.mjs' --fpc (Join-Path $FpcBin 'fpc.exe')
    }
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
} finally { Pop-Location }
