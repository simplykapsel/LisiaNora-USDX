$ErrorActionPreference = 'Stop'
python "$PSScriptRoot\package.py"
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
