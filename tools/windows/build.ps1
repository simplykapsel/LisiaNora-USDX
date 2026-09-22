param(
    [ValidateSet('Debug','Release')][string]$Configuration = 'Debug',
    [string]$MsysRoot = 'C:\msys64',
    [string]$FpcBin = 'C:\lazarus\fpc\3.2.2\bin\x86_64-win64'
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$bash = Join-Path $MsysRoot 'usr\bin\bash.exe'
if (!(Test-Path -LiteralPath $bash)) { throw "MSYS2 not found: $bash" }
if (!(Test-Path -LiteralPath (Join-Path $FpcBin 'fpc.exe'))) { throw "FPC not found: $FpcBin" }
$env:USDX_FPC_BIN = $FpcBin
$env:MSYSTEM = 'MINGW64'
Push-Location $repo
try {
    & $bash 'tools/windows/build.sh' $Configuration
    if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }
