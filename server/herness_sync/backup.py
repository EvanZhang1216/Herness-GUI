"""Private local backups; optional off-host copy through the configured S3/OSS bucket."""
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit


def backup():
    url = urlsplit(os.environ['DATABASE_URL'])
    directory = Path('/srv/herness-sync/backups').resolve()
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = directory / ('herness-' + stamp + '.dump')
    environment = dict(os.environ, PGPASSWORD=unquote(url.password or ''))
    subprocess.run(['/usr/pgsql-16/bin/pg_dump', '--host', url.hostname, '--port', str(url.port or 5432),
                    '--username', unquote(url.username), '--dbname', url.path.lstrip('/'),
                    '--format=custom', '--file', str(target)], env=environment, check=True)
    os.chmod(target, 0o600)
    if os.environ.get('S3_BUCKET'):
        import boto3
        client = boto3.client('s3', endpoint_url=os.environ.get('S3_ENDPOINT'),
                              region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))
        client.upload_file(str(target), os.environ['S3_BUCKET'], 'backups/' + target.name)
        # Configure a 7-day bucket lifecycle rule for this prefix; never enumerate other customer objects here.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).timestamp()
    for old in directory.glob('herness-*.dump'):
        if old.resolve().parent == directory and old.stat().st_mtime < cutoff:
            old.unlink()
    print('Database backup completed:', target.name)


if __name__ == '__main__':
    backup()
