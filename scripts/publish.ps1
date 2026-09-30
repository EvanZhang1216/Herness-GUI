param([Parameter(Mandatory=$true)][string]$Message)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
git add -A
if ($LASTEXITCODE) { throw 'git add failed' }
git diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
  git commit -m $Message
  if ($LASTEXITCODE) { throw 'Commit failed' }
}
git push origin main
if ($LASTEXITCODE) { throw 'GitHub push failed; retry without creating a duplicate commit' }
& "$PSScriptRoot\sync-ecs.ps1"
if (-not $?) { throw 'ECS synchronization failed' }
