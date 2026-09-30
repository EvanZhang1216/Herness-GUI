"""Credentials enter on stdin, never command-line arguments or log output."""
import json
import os
import sys
from pathlib import Path


def run(data):
    sys.path.insert(0, data['source'])
    os.environ['HERMES_HOME'] = data['home']
    from local_store import LocalStore
    if data['command'] == 'apply':
        return {'applied': LocalStore(data['home']).apply()}
    if data['command'] == 'import_guest':
        source = LocalStore(data['guest_home'])
        destination = LocalStore(data['home'])
        snapshots = source.snapshots()
        source.save()
        for local_id, snapshot in snapshots.items():
            snapshot.update(id=source.state['sessions'][local_id]['cloud_id'], version=0)
            destination.stage(snapshot)
        destination.apply()
        # Imported records have not reached the server yet.
        for entry in destination.state['sessions'].values():
            entry['hash'] = ''
        destination.save()
        return {'imported': len(destination.state['sessions'])}
    if data['command'] == 'sync':
        from engine import SyncEngine
        engine = SyncEngine(data['home'], data['endpoint'], data['token'])
        try:
            return engine.sync()
        finally:
            engine.close()
    raise ValueError('Unknown worker command')


if __name__ == '__main__':
    try:
        result = run(json.load(sys.stdin))
        print(json.dumps({'ok': True, **result}, ensure_ascii=False))
    except Exception as error:
        import httpx
        if isinstance(error, httpx.HTTPStatusError):
            try:
                detail = error.response.json().get('detail', '同步请求失败')
            except ValueError:
                detail = '同步请求失败'
            result = {'ok': False, 'error': str(detail), 'status': error.response.status_code}
        else:
            result = {'ok': False, 'error': str(error)}
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)
