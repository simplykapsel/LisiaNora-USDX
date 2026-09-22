param([switch]$Build)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$profile = Join-Path $repo '.local\lazarus-profile'
$project = Join-Path $repo 'src\ultrastardx-queue-win64.lpi'
if ($Build) {
    & C:\lazarus\lazbuild.exe "--pcp=$profile" --build-all $project
    if ($LASTEXITCODE -ne 0) { throw 'Lazarus build failed.' }
} else {
    # Interactive debugger requested by the developer.
    Start-Process -FilePath C:\lazarus\lazarus.exe -ArgumentList @("--pcp=`"$profile`"", "`"$project`"") -WindowStyle Normal
}
