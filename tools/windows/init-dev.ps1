param([string]$SongsPath = 'D:\UltraStar Deluxe\songs')
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (!(Test-Path -LiteralPath $SongsPath -PathType Container)) { throw "Song library not found: $SongsPath" }
$config = Join-Path $repo 'game\config.ini'
if (!(Test-Path -LiteralPath $config)) {
    @"
[Game]
Language=Polish
Tabs=Off
Sorting=Artist
[Graphics]
FullScreen=Off
Resolution=1280x720
[Directories]
SongDir1=$SongsPath
"@ | Set-Content -LiteralPath $config -Encoding UTF8
}
New-Item -ItemType Directory -Force -Path (Join-Path $repo '.local'),(Join-Path $repo 'game\songs') | Out-Null
Write-Host "Development config: $config"
Write-Host 'Songs stay in their original directory. Scores and logs stay in this checkout.'
