$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$revision = (& git rev-parse HEAD).Trim()
if ($revision -notmatch '^[a-f0-9]{40}$') { throw 'Invalid committed revision' }
$deployKey = Join-Path $env:USERPROFILE '.ssh\herness_gui_deploy'
ssh -i $deployKey -o BatchMode=yes -o StrictHostKeyChecking=yes root@39.107.193.57 "bash /srv/herness-gui/releases/$revision/server/deploy/release.sh $revision"
if ($LASTEXITCODE) { throw 'Cloud service deployment failed' }
