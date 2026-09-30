"""Versioned adapter around Hermes' existing SQLite store, not a replacement agent."""
import hashlib
import json
import sqlite3
import time
import uuid
from pathlib import Path

SESSION_FIELDS = {
    'source', 'model', 'model_config', 'started_at', 'ended_at', 'end_reason', 'message_count',
    'tool_call_count', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
    'reasoning_tokens', 'title', 'title_source', 'last_activity_at', 'api_call_count', 'archived',
    'pinned', 'hidden', 'tool_names', 'rewind_count',
}
SECRET_NAMES = {'api_key', 'apikey', 'key', 'token', 'access_token', 'refresh_token', 'password',
                'secret', 'authorization', 'api_keys', 'credentials'}


def clean_config(value):
    if isinstance(value, dict):
        return {k: clean_config(v) for k, v in value.items()
                if k.lower() not in SECRET_NAMES and not k.lower().endswith(('_api_key', '_secret', '_token', '_password'))}
    if isinstance(value, list):
        return [clean_config(v) for v in value]
    return value


def atomic_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.replace(file)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class LocalStore:
    def __init__(self, home):
        self.home = Path(home)
        self.directory = self.home / '.cloud-sync'
        self.state_file = self.directory / 'state.json'
        self.state = json.loads(self.state_file.read_text(encoding='utf-8')) if self.state_file.exists() else {
            'cursor': 0, 'sessions': {}, 'message_ids': {}, 'uploaded_blobs': [], 'inbox': {}, 'pending': {}}

    def save(self):
        atomic_json(self.state_file, self.state)

    def snapshots(self):
        file = self.home / 'state.db'
        if not file.exists():
            return {}
        db = sqlite3.connect(file.as_uri() + '?mode=ro', uri=True, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN')
            rows = db.execute('SELECT * FROM sessions ORDER BY started_at,id').fetchall()
            for row in rows:
                self.state['sessions'].setdefault(row['id'], {'cloud_id': str(uuid.uuid4()), 'version': 0, 'hash': ''})
            result = {}
            leases = {row[0] for row in db.execute('SELECT conversation_id FROM session_turn_leases WHERE expires_at>?', (time.time(),))}
            for row in rows:
                local_id = row['id']
                if local_id in leases:
                    continue
                session = {key: row[key] for key in SESSION_FIELDS if key in row.keys()}
                if session.get('model_config'):
                    session['model_config'] = json.dumps(clean_config(json.loads(session['model_config'])), ensure_ascii=False)
                parent = self.state['sessions'].get(row['parent_session_id'])
                session['parent_cloud_id'] = parent['cloud_id'] if parent else None
                prompt = row['system_prompt']
                if row['system_prompt_hash']:
                    found = db.execute('SELECT prompt FROM system_prompts WHERE hash=?', (row['system_prompt_hash'],)).fetchone()
                    prompt = found[0] if found else prompt
                session['system_prompt'] = prompt
                messages = []
                for message in db.execute('SELECT * FROM messages WHERE session_id=? ORDER BY id', (local_id,)):
                    message_id = self.state['message_ids'].setdefault(str(message['id']), str(uuid.uuid4()))
                    payload = {key: message[key] for key in message.keys() if key not in ('id', 'session_id')}
                    messages.append({'id': message_id, 'payload': payload})
                if messages:
                    result[local_id] = {'schema_version': 1, 'session': session, 'messages': messages, 'attachment_ids': []}
            self.state['present_ids'] = [row['id'] for row in rows]
            return result
        finally:
            db.close()

    def stage(self, payload):
        file = self.directory / 'inbox' / (str(uuid.UUID(payload['id'])) + '.json')
        atomic_json(file, payload)
        self.state['inbox'][payload['id']] = payload['version']
        self.save()

    def apply(self):
        """Called before the backend starts. Never rewrite a live agent's cached context."""
        if not self.state['inbox']:
            return 0
        current_snapshots = self.snapshots()
        from hermes_state import SessionDB
        facade = SessionDB(self.home / 'state.db')
        facade.close()
        db = sqlite3.connect(self.home / 'state.db', timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        if db.execute('SELECT 1 FROM session_turn_leases WHERE expires_at>? LIMIT 1', (time.time(),)).fetchone():
            db.close()
            raise ValueError('独立网关或其他进程正在使用会话，停止任务后再应用云端更新')
        session_columns = {r[1] for r in db.execute('PRAGMA table_info(sessions)')}
        message_columns = {r[1] for r in db.execute('PRAGMA table_info(messages)')}
        cloud_to_local = {m['cloud_id']: local for local, m in self.state['sessions'].items()}
        payloads = [json.loads((self.directory / 'inbox' / (cid + '.json')).read_text(encoding='utf-8'))
                    for cid in self.state['inbox']]
        local_branches = set()
        for item in list(payloads):
            local_id = cloud_to_local.get(item['id'])
            current = current_snapshots.get(local_id)
            metadata = self.state['sessions'].get(local_id, {})
            if current and metadata.get('version', 0) > 0 and fingerprint(current) != metadata.get('hash'):
                # A user can continue offline after a download. Preserve those new turns before applying it.
                branch = json.loads(json.dumps(current))
                branch.update(id=str(uuid.uuid4()), version=0)
                branch['session']['title'] = str(branch['session'].get('title') or 'Untitled') + ' · 本地未同步分支'
                local_branches.add(branch['id'])
                payloads.insert(0, branch)
                self.state['pending'].pop(local_id, None)
        try:
            with db:
                # Insert parent placeholders first; no cross-device working-directory binding.
                for item in payloads:
                    cid = item['id']
                    if cid not in cloud_to_local:
                        candidate = 'cloud-' + cid
                        if candidate in cloud_to_local.values() or db.execute('SELECT 1 FROM sessions WHERE id=?', (candidate,)).fetchone():
                            candidate += '-' + uuid.uuid4().hex[:12]
                        cloud_to_local[cid] = candidate
                    local_id = cloud_to_local[cid]
                    if not item.get('deleted'):
                        db.execute('INSERT OR IGNORE INTO sessions(id,source,started_at) VALUES(?,?,?)',
                                   (local_id, 'desktop', item['session']['started_at']))
                for item in payloads:
                    cid, local_id = item['id'], cloud_to_local[item['id']]
                    if item.get('deleted'):
                        # Keep an empty hidden row for lineage FK references. Wipe all transcript content.
                        db.execute('DELETE FROM messages WHERE session_id=?', (local_id,))
                        db.execute("UPDATE sessions SET hidden=1,archived=1,title='已从云端删除',system_prompt=NULL,system_prompt_hash=NULL,model_config=NULL WHERE id=?", (local_id,))
                        self.state['sessions'][local_id] = {'cloud_id': cid, 'version': item['version'], 'hash': '', 'retired': True}
                        continue
                    session = {k: v for k, v in item['session'].items() if k in SESSION_FIELDS and k in session_columns}
                    prompt = item['session'].get('system_prompt')
                    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest() if prompt else None
                    if prompt:
                        db.execute('INSERT OR IGNORE INTO system_prompts(hash,prompt) VALUES(?,?)', (prompt_hash, prompt))
                    parent = cloud_to_local.get(item['session'].get('parent_cloud_id'))
                    session.update(source='desktop', system_prompt=None, system_prompt_hash=prompt_hash,
                                   parent_session_id=parent, profile_name=None)
                    columns = list(session)
                    db.execute('UPDATE sessions SET ' + ','.join(f'"{k}"=?' for k in columns) + ' WHERE id=?',
                               [session[k] for k in columns] + [local_id])
                    db.execute('DELETE FROM messages WHERE session_id=?', (local_id,))
                    for message in item['messages']:
                        values = {k: v for k, v in message['payload'].items() if k in message_columns and k not in ('id', 'session_id')}
                        values['session_id'] = local_id
                        columns = list(values)
                        cursor = db.execute('INSERT INTO messages(' + ','.join('"' + k + '"' for k in columns) + ') VALUES(' + ','.join('?' for _ in columns) + ')',
                                            [values[k] for k in columns])
                        self.state['message_ids'][str(cursor.lastrowid)] = message['id']
                    self.state['sessions'][local_id] = {'cloud_id': cid, 'version': item['version'], 'hash': ''}
                db.execute('DELETE FROM system_prompts WHERE hash NOT IN (SELECT system_prompt_hash FROM sessions WHERE system_prompt_hash IS NOT NULL)')
        finally:
            db.close()
        # Recompute local hashes so applying an update does not echo it straight back to the server.
        snapshots = self.snapshots()
        for cid in list(self.state['inbox']) + list(local_branches):
            local = cloud_to_local[cid]
            if local in snapshots:
                self.state['sessions'][local]['hash'] = '' if cid in local_branches else fingerprint(snapshots[local])
        count = len(self.state['inbox'])
        self.state['inbox'] = {}
        self.save()
        for item in payloads:
            (self.directory / 'inbox' / (item['id'] + '.json')).unlink(missing_ok=True)
        return count
