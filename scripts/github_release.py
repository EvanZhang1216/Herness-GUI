"""Publish a locally verified installer as one atomic (draft -> public) release."""
import argparse
import base64
import hashlib
import os
from pathlib import Path
import subprocess

import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.github.com/repos/EvanZhang1216/Herness-GUI'


def github_session():
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if not token:
        result = subprocess.run(['git', 'credential', 'fill'],
            input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True,
            env=dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never'), check=True)
        token = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line).get('password')
    if not token:
        raise RuntimeError('Configure GH_TOKEN or a GitHub credential helper on the publishing machine.')
    session = requests.Session()
    session.headers.update({'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
    return session


def publish(version, notes_path):
    directory = ROOT / 'apps/desktop/release'
    manifest = yaml.safe_load((directory / 'latest.yml').read_text())
    if manifest['version'] != version:
        raise RuntimeError('Release version differs from packaged manifest')
    installer = directory / manifest['path']
    with installer.open('rb') as stream:
        digest = base64.b64encode(hashlib.file_digest(stream, 'sha512').digest()).decode()
    if digest != manifest['sha512']:
        raise RuntimeError('Installer does not match latest.yml')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    session = github_session()
    response = session.post(API + '/releases', json={
        'tag_name': 'v' + version, 'target_commitish': revision, 'name': 'Herness GUI ' + version,
        'body': Path(notes_path).read_text(encoding='utf-8-sig'), 'draft': True, 'prerelease': False,
    }, timeout=30)
    response.raise_for_status()
    release = response.json()
    upload_url = release['upload_url'].split('{')[0]
    for artifact in [installer, installer.with_suffix('.exe.blockmap'), directory / 'latest.yml']:
        print('Uploading', artifact.name, f'({artifact.stat().st_size} bytes)', flush=True)
        with artifact.open('rb') as stream:
            uploaded = session.post(upload_url, params={'name': artifact.name}, data=stream,
                headers={'Content-Type': 'application/octet-stream'}, timeout=(30, 600))
        uploaded.raise_for_status()
    response = session.patch(API + f"/releases/{release['id']}", json={'draft': False}, timeout=30)
    response.raise_for_status()
    print('Published:', response.json()['html_url'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('version')
    parser.add_argument('--notes', required=True)
    args = parser.parse_args()
    publish(args.version, args.notes)
