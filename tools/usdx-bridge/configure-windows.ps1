param(
    [string]$ImportConfig,
    [string]$ServerUrl,
    [string]$SongsPath,
    [string]$Destination = (Join-Path $PSScriptRoot 'bridge.json'),
    [string]$GameConfig,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
if ((Test-Path -LiteralPath $Destination) -and !$Force) { throw 'Configuration exists. Use -Force to replace it.' }
$inputConfig = if ($ImportConfig) { Get-Content -LiteralPath $ImportConfig -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
if (!$ServerUrl) { $ServerUrl = $inputConfig.serverUrl }
if (!$SongsPath) { $SongsPath = $inputConfig.songsPath }
$uri = [Uri]$ServerUrl
if (!$uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/' -or ($uri.Scheme -ne 'https' -and !($uri.Scheme -eq 'http' -and $uri.IsLoopback))) { throw 'Use an HTTPS server origin, or HTTP localhost.' }
$songs = (Resolve-Path -LiteralPath $SongsPath).Path
if (!(Test-Path -LiteralPath $songs -PathType Container)) { throw 'Song library does not exist.' }
$token = $inputConfig.token
if (!$token) {
    $secret = Read-Host 'USDX_BRIDGE_TOKEN' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
if ($token -notmatch '^[A-Za-z0-9_-]{43,128}$') { throw 'Invalid bridge token.' }
$Destination = [IO.Path]::GetFullPath($Destination)
$directory = Split-Path -Parent $Destination
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$bridgeProfile = @{serverUrl=$uri.GetLeftPart([UriPartial]::Authority);token=$token;songsPath=$songs}
if ($inputConfig.exchangePath) { $bridgeProfile.exchangePath = $inputConfig.exchangePath }
$bridgeProfile | ConvertTo-Json | Set-Content -LiteralPath $Destination -Encoding UTF8
# Limit credentials to this Windows account and SYSTEM.
$acl = Get-Acl -LiteralPath $Destination
$acl.SetAccessRuleProtection($true,$false)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($user,'FullControl','Allow')))
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),'FullControl','Allow')))
Set-Acl -LiteralPath $Destination -AclObject $acl
if ($GameConfig -and !(Test-Path -LiteralPath (Join-Path $directory 'game.ini'))) {
    Copy-Item -LiteralPath $GameConfig -Destination (Join-Path $directory 'game.ini')
}
Write-Host "Configuration saved: $Destination"
