param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a stable X.Y.Z version' }
$package = Get-Content apps/desktop/package.json -Raw | ConvertFrom-Json
if ($package.version -ne $Version) { throw 'Update apps/desktop/package.json and package-lock.json first' }
if ((git status --porcelain)) { throw 'Commit and synchronize all changes first' }
git tag -a "v$Version" -m "Release Herness GUI $Version"
if ($LASTEXITCODE) { throw 'Tag creation failed' }
git push origin "v$Version"
if ($LASTEXITCODE) { throw 'Release tag push failed' }
