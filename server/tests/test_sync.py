import base64
from contextlib import closing
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path

import httpx
import uvicorn
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'server'))
from herness_sync.app import app
from herness_sync.database import create_pool, migrate
from herness_sync.retention import cleanup


class SyncContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.environ.get('DATABASE_URL', '').split('?')[0].endswith('/herness_sync_test'):
            raise RuntimeError('Tests require the dedicated herness_sync_test database')
        cls.directory = tempfile.TemporaryDirectory(prefix='herness-sync-contract-')
        os.environ['BLOB_DIRECTORY'] = str(Path(cls.directory.name) / 'blobs')
        cls.pool = create_pool()
        cls.pool.wait()
        migrate(cls.pool)
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        cls.pool.close()
        cls.directory.cleanup()

    def setUp(self):
        with self.pool.connection() as db:
            db.execute('TRUNCATE rate_limits')
        self.user_ids = []

    def tearDown(self):
        with self.pool.connection() as db:
            for uid in self.user_ids:
                db.execute('DELETE FROM users WHERE id=%s', (uid,))

    def register(self):
        credentials = {'username': 'test_' + uuid.uuid4().hex[:14], 'password': 'Local-test-only-2026!',
                       'email': uuid.uuid4().hex + '@example.test', 'device_id': str(uuid.uuid4()), 'device_name': 'Contract device'}
        response = self.client.post('/v1/auth/register', json=credentials)
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.user_ids.append(body['user']['id'])
        return credentials, body, {'Authorization': 'Bearer ' + body['token']}

    def test_auth_isolation_idempotency_conflicts_attachments_and_expiration(self):
        credentials, user, headers = self.register()
        _, other, other_headers = self.register()
        self.assertIsNone(user['user']['email_verified_at'])
        with self.pool.connection() as db:
            saved = db.execute('SELECT password_hash FROM users WHERE id=%s', (user['user']['id'],)).fetchone()
        self.assertTrue(saved['password_hash'].startswith('$argon2id$'))
        blob = b'private attachment for contract test'
        aid = hashlib.sha256(blob).hexdigest()
        self.assertEqual(self.client.put('/v1/attachments/' + aid, content=blob, headers=headers).status_code, 200)
        self.assertEqual(self.client.get('/v1/attachments/' + aid, headers=other_headers).status_code, 404)
        cid = str(uuid.uuid4())
        payload = {'operation_id': str(uuid.uuid4()), 'base_version': 0,
                   'session': {'title': 'Private chat', 'started_at': time.time()},
                   'messages': [{'id': str(uuid.uuid4()), 'payload': {'role': 'user', 'content': 'hello'}}],
                   'attachment_ids': [aid]}
        response = self.client.put('/v1/conversations/' + cid, json=payload, headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        version = response.json()['version']
        retry = self.client.put('/v1/conversations/' + cid, json=payload, headers=headers)
        self.assertEqual(retry.json(), response.json())
        self.assertEqual(self.client.get('/v1/conversations/' + cid, headers=other_headers).status_code, 404)
        stale = {**payload, 'operation_id': str(uuid.uuid4())}
        self.assertEqual(self.client.put('/v1/conversations/' + cid, json=stale, headers=headers).status_code, 409)
        forged = {**payload, 'operation_id': str(uuid.uuid4()), 'attachment_ids': [aid]}
        self.assertEqual(self.client.put('/v1/conversations/' + str(uuid.uuid4()), json=forged, headers=other_headers).status_code, 422)
        events = self.client.get('/v1/sync/changes', headers=headers).json()
        self.assertEqual(len(events['changes']), 1)
        self.assertEqual(events['cursor'], version)
        with self.pool.connection() as db:
            db.execute("UPDATE conversations SET expires_at=now()-interval '1 second' WHERE user_id=%s AND id=%s", (user['user']['id'], cid))
            db.execute("UPDATE attachments SET created_at=now()-interval '2 days' WHERE user_id=%s", (user['user']['id'],))
        self.assertTrue(self.client.get('/v1/conversations/' + cid, headers=headers).json()['deleted'])
        result = cleanup(self.pool, app.state.blobs)
        self.assertEqual(result['conversations'], 1)
        self.assertEqual(result['attachments'], 1)
        self.assertEqual(self.client.get('/v1/attachments/' + aid, headers=headers).status_code, 404)
        stale['base_version'] = version
        self.assertEqual(self.client.put('/v1/conversations/' + cid, json=stale, headers=headers).status_code, 410)
        self.assertEqual(self.client.delete('/v1/devices/' + credentials['device_id'], headers=headers).status_code, 200)
        self.assertEqual(self.client.get('/v1/auth/me', headers=headers).status_code, 401)

    def test_two_real_hermes_stores_retain_context_and_branch_parallel_edits(self):
        credentials, user, _ = self.register()
        second_credentials = {**credentials, 'device_id': str(uuid.uuid4()), 'device_name': 'Second device'}
        response = self.client.post('/v1/auth/login', json=second_credentials)
        self.assertEqual(response.status_code, 200)
        token_b = response.json()['token']
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=18790, log_level='error', lifespan='off'))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(.05)
        self.assertTrue(server.started)
        python = ROOT / 'runtime/python/python.exe'
        worker = ROOT / 'apps/desktop/sync-client/worker.py'
        source = ROOT / 'vendor/hermes'
        folder = Path(self.directory.name) / uuid.uuid4().hex
        a, b = folder / '设备A', folder / '设备B'
        a.mkdir(parents=True); b.mkdir()
        def seed(home, session_id='first', text='original', initial=False):
            code = '''import sys,os,json
from pathlib import Path
sys.path.insert(0,sys.argv[1]);os.environ['HERMES_HOME']=sys.argv[2]
from hermes_state import SessionDB
d=SessionDB(Path(sys.argv[2])/'state.db')
if sys.argv[5]=='yes':
 d.create_session(sys.argv[3],'desktop',model='mock',system_prompt='stable system context',model_config={'api_key':'must-not-upload','model':'mock'})
d.append_message(sys.argv[3],'user',sys.argv[4])
d.append_message(sys.argv[3],'assistant','reply: '+sys.argv[4],finish_reason='stop')
d.close()
'''
            subprocess.run([str(python), '-X', 'utf8', '-c', code, str(source), str(home), session_id, text, 'yes' if initial else 'no'], check=True, capture_output=True)
        def work(home, token, command='sync'):
            result = subprocess.run([str(python), '-X', 'utf8', str(worker)], input=json.dumps({
                'command': command, 'home': str(home), 'source': str(source), 'endpoint': 'http://127.0.0.1:18790', 'token': token,
            }), text=True, encoding='utf-8', capture_output=True, timeout=120)
            parsed = json.loads(result.stdout.strip().splitlines()[-1])
            self.assertTrue(parsed['ok'], parsed)
            return parsed
        try:
            seed(a, initial=True)
            self.assertEqual(work(a, user['token'])['uploaded'], 1)
            self.assertEqual(work(b, token_b)['pending_downloads'], 1)
            self.assertEqual(work(b, token_b, 'apply')['applied'], 1)
            with closing(sqlite3.connect(b / 'state.db')) as db:
                session_id, config = db.execute('SELECT id,model_config FROM sessions').fetchone()
                self.assertNotIn('must-not-upload', config)
                self.assertEqual(db.execute('SELECT prompt FROM system_prompts').fetchone()[0], 'stable system context')
                self.assertEqual(db.execute('SELECT count(*) FROM messages').fetchone()[0], 2)
            self.assertEqual(work(b, token_b)['uploaded'], 0, 'Downloaded data must not echo as a local edit')
            seed(a, text='A updated before download')
            work(a, user['token'])
            self.assertEqual(work(b, token_b)['pending_downloads'], 1)
            seed(b, session_id=session_id, text='B changed after download')
            work(b, token_b, 'apply')
            with closing(sqlite3.connect(b / 'state.db')) as db:
                contents = [row[0] for row in db.execute('SELECT content FROM messages')]
                self.assertIn('A updated before download', contents)
                self.assertIn('B changed after download', contents)
            seed(a, text='A continued offline')
            seed(b, session_id=session_id, text='B continued offline')
            work(a, user['token'])
            self.assertEqual(work(b, token_b)['conflicts'], 1)
            work(b, token_b, 'apply')
            with closing(sqlite3.connect(b / 'state.db')) as db:
                contents = [row[0] for row in db.execute('SELECT content FROM messages')]
                self.assertIn('A continued offline', contents)
                self.assertIn('B continued offline', contents)
        finally:
            server.should_exit = True
            thread.join(timeout=10)


if __name__ == '__main__':
    unittest.main()
