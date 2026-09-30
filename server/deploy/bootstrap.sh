#!/usr/bin/env bash
set -euo pipefail
# PostgreSQL 16 and Python 3.11 must be installed before this script.
if [ ! -f /var/lib/pgsql/16/data/PG_VERSION ]; then
  /usr/pgsql-16/bin/postgresql-16-setup initdb
fi
if ! grep -q '# herness-sync' /var/lib/pgsql/16/data/postgresql.conf; then
  cat >> /var/lib/pgsql/16/data/postgresql.conf <<'CONFIG'
# herness-sync: loopback-only initial deployment on the small ECS host
listen_addresses = '127.0.0.1'
max_connections = 40
shared_buffers = '128MB'
password_encryption = 'scram-sha-256'
CONFIG
  sed -i '1i host herness_sync,herness_sync_test herness_sync,herness_sync_test 127.0.0.1/32 scram-sha-256' /var/lib/pgsql/16/data/pg_hba.conf
fi
systemctl enable --now postgresql-16
systemctl reload postgresql-16
id herness-sync >/dev/null 2>&1 || useradd --system --home-dir /srv/herness-sync --shell /sbin/nologin herness-sync
install -d -m 750 -o herness-sync -g herness-sync /srv/herness-sync /srv/herness-sync/blobs /srv/herness-sync/backups
install -d -m 750 -o root -g herness-sync /etc/herness-sync
python3.11 - <<'PY'
import os, secrets, subprocess
from pathlib import Path
for name in ('herness_sync', 'herness_sync_test'):
    file = Path('/etc/herness-sync/' + ('server.env' if name == 'herness_sync' else 'test.env'))
    if file.exists():
        continue
    password = secrets.token_urlsafe(36)
    sql = f"CREATE ROLE {name} LOGIN PASSWORD '{password}';\nCREATE DATABASE {name} OWNER {name};\n"
    subprocess.run(['runuser','-u','postgres','--','/usr/pgsql-16/bin/psql','-v','ON_ERROR_STOP=1'],input=sql,text=True,check=True,stdout=subprocess.DEVNULL)
    file.write_text(f'DATABASE_URL=postgresql://{name}:{password}@127.0.0.1:5432/{name}\nBLOB_DIRECTORY=/srv/herness-sync/blobs\nACCOUNT_QUOTA_BYTES=268435456\n')
    os.chmod(file,0o640)
    subprocess.run(['chown','root:herness-sync',str(file)],check=True)
PY
install -d -m 755 /opt/herness-sync
test -d /opt/herness-sync/venv || python3.11 -m venv /opt/herness-sync/venv
