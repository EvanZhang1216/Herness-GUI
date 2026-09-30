param(
  [string]$HostName = '39.107.193.57',
  [string]$UserName = 'root',
  [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\herness_gui_deploy')
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$commit = (& git rev-parse HEAD).Trim()
if ($commit -notmatch '^[a-f0-9]{40}$') { throw 'No valid committed revision' }
New-Item -ItemType Directory .local -Force | Out-Null
$archive = Join-Path (Get-Location) ".local\source-$commit.tar"
git archive --format=tar --output=$archive HEAD
if ($LASTEXITCODE) { throw 'Source archive creation failed' }
$sshOptions = @('-i', $KeyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
$destination = "${UserName}@${HostName}"
scp @sshOptions $archive "${destination}:/srv/herness-gui/source-$commit.tar"
if ($LASTEXITCODE) { throw 'ECS source upload failed; GitHub commit remains intact' }
# Every commit gets its own immutable directory; current is switched only after extraction.
$command = "set -eu; mkdir -p /srv/herness-gui/releases/$commit; tar -xf /srv/herness-gui/source-$commit.tar -C /srv/herness-gui/releases/$commit; ln -sfn releases/$commit /srv/herness-gui/current; printf '%s\n' $commit > /srv/herness-gui/REVISION"
ssh @sshOptions $destination $command
if ($LASTEXITCODE) { throw 'ECS source activation failed' }
Write-Output "ECS synchronized: $commit -> /srv/herness-gui/current"
