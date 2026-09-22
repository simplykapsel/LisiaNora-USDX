$ErrorActionPreference = 'Stop'
Push-Location ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')))
try {
    & node 'tools/usdx-bridge/index.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'USDX bridge stopped with an error.' }
} finally { Pop-Location }
