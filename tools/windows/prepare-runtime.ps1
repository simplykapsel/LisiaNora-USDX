param([switch]$Download)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $repo
try {
    if ($Download -or !(Test-Path -LiteralPath 'usdx-dlls-x86_64.zip') -or !(Test-Path -LiteralPath 'game/bass.dll')) {
        python dldlls.py
        if ($LASTEXITCODE -ne 0) { throw 'Official DLL download failed.' }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $repo 'usdx-dlls-x86_64.zip'))
    try {
        foreach ($entry in $zip.Entries) {
            $name = [IO.Path]::GetFileName($entry.FullName)
            if ($name -eq 'config-win.inc') { $destination = Join-Path $repo 'src\config-win.inc' }
            elseif ($name -like '*.dll') { $destination = Join-Path $repo ('game\' + $name) }
            else { continue }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
    } finally { $zip.Dispose() }
} finally { Pop-Location }
