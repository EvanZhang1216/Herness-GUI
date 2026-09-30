$ErrorActionPreference = 'Stop'
$deployKey = Join-Path $env:USERPROFILE '.ssh\herness_gui_deploy'
Write-Output 'Developer tunnel: enter http://127.0.0.1:18789 in Account settings. Keep this terminal open.'
ssh -N -i $deployKey -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L '127.0.0.1:18789:127.0.0.1:18788' root@39.107.193.57
