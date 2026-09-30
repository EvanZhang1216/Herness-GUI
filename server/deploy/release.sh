#!/usr/bin/env bash
set -euo pipefail
revision="${1:?Pass the validated source commit}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 2
source_dir="/srv/herness-gui/releases/$revision/server"
target="/opt/herness-sync/releases/$revision"
test -f "$source_dir/herness_sync/app.py"
mkdir -p "$target"
cp -a "$source_dir/." "$target/"
/opt/herness-sync/venv/bin/pip install --require-hashes --find-links /opt/herness-sync/staging/wheels -r "$target/requirements.txt"
set -a
. /etc/herness-sync/server.env
set +a
cd "$target"
/opt/herness-sync/venv/bin/python -m herness_sync.manage migrate
previous="$(readlink -f /opt/herness-sync/current)"
ln -sfn "$target" /opt/herness-sync/current
install -m 644 deploy/herness-sync*.service deploy/herness-sync*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl restart herness-sync
systemctl enable --now herness-sync-cleanup.timer herness-sync-backup.timer
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:18788/health >/dev/null; then
    printf 'Deployed service revision %s\n' "$revision"
    exit 0
  fi
  sleep 1
done
ln -sfn "$previous" /opt/herness-sync/current
systemctl restart herness-sync
printf 'Health check failed; restored previous service directory\n' >&2
exit 1
