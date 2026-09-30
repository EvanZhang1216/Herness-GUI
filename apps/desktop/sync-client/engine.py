import base64
import json
import re
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from local_store import LocalStore, atomic_json, fingerprint


def validate_endpoint(value):
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('服务器地址不能包含凭据、查询参数或片段')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise ValueError('公网同步服务必须使用 HTTPS；HTTP 仅限本机 SSH 隧道')
    if not parsed.hostname:
        raise ValueError('无效服务器地址')
    return value.rstrip('/')


class SyncEngine:
    def __init__(self, home, endpoint, token):
        self.local = LocalStore(home)
        self.client = httpx.Client(base_url=validate_endpoint(endpoint), headers={'Authorization': 'Bearer ' + token},
                                   timeout=45, follow_redirects=False, trust_env=False)

    def request(self, method, url, **kwargs):
        response = self.client.request(method, url, **kwargs)
        response.raise_for_status()
        return response

    def encode_attachments(self, snapshot):
        attachments = set()
        def convert(value):
            if isinstance(value, dict):
                return {k: convert(v) for k, v in value.items()}
            if isinstance(value, list):
                return [convert(v) for v in value]
            if isinstance(value, str):
                match = re.fullmatch(r'data:([\w.+/-]+);base64,([A-Za-z0-9+/=\s]+)', value)
                if match:
                    import hashlib
                    raw = base64.b64decode(match[2], validate=False)
                    if len(raw) > 20 * 1024 * 1024:
                        raise ValueError('附件超过 20 MB，未上传该会话')
                    aid = hashlib.sha256(raw).hexdigest()
                    if aid not in self.local.state['uploaded_blobs']:
                        self.request('PUT', '/v1/attachments/' + aid, content=raw)
                        self.local.state['uploaded_blobs'].append(aid)
                    attachments.add(aid)
                    return 'herness-attachment://' + aid + '/' + match[1]
                if value.startswith(('[', '{')):
                    try:
                        return json.dumps(convert(json.loads(value)), ensure_ascii=False)
                    except json.JSONDecodeError:
                        pass
            return value
        result = convert(snapshot)
        result['attachment_ids'] = sorted(attachments)
        return result

    def decode_attachments(self, snapshot):
        cache = {}
        allowed = {item['id'] for item in snapshot.get('attachments', [])}
        def convert(value):
            if isinstance(value, dict):
                return {k: convert(v) for k, v in value.items()}
            if isinstance(value, list):
                return [convert(v) for v in value]
            if isinstance(value, str):
                match = re.fullmatch(r'herness-attachment://([0-9a-f]{64})/([\w.+/-]+)', value)
                if match:
                    import hashlib
                    aid = match[1]
                    if aid not in allowed:
                        raise ValueError('消息引用未授权附件')
                    if aid not in cache:
                        data = self.request('GET', '/v1/attachments/' + aid).content
                        if hashlib.sha256(data).hexdigest() != aid:
                            raise ValueError('下载附件校验失败')
                        cache[aid] = base64.b64encode(data).decode()
                    return f'data:{match[2]};base64,' + cache[aid]
                if value.startswith(('[', '{')):
                    try:
                        return json.dumps(convert(json.loads(value)), ensure_ascii=False)
                    except json.JSONDecodeError:
                        pass
            return value
        return convert(snapshot)

    def sync(self):
        state = self.local.state
        snapshots = self.local.snapshots()
        self.local.save()
        uploaded = conflicts = 0
        for local_id, entry in list(state['sessions'].items()):
            if entry.get('retired'):
                continue
            snapshot = snapshots.get(local_id)
            deleted = local_id not in state.get('present_ids', [])
            if not snapshot and not deleted:
                continue  # In-flight turn, or an empty session.
            if deleted and not entry['version']:
                continue
            current_hash = fingerprint(snapshot) if snapshot else 'deleted'
            if local_id not in state['pending'] and current_hash == entry['hash']:
                continue
            if local_id not in state['pending']:
                body = self.encode_attachments(snapshot) if snapshot else {'deleted': True}
                body.update(operation_id=str(uuid.uuid4()), base_version=entry['version'])
                state['pending'][local_id] = {'body': body, 'hash': current_hash}
                self.local.save()
            pending = state['pending'][local_id]
            response = self.client.put('/v1/conversations/' + entry['cloud_id'], json=pending['body'])
            if response.status_code == 410:
                entry['retired'] = True
                state['pending'].pop(local_id)
                self.local.save()
                continue
            if response.status_code == 409:
                if pending['body'].get('deleted'):
                    state['pending'].pop(local_id)
                    # Download the newer server state; never delete unseen work on another device.
                    entry['hash'] = current_hash
                    self.local.save()
                    continue
                original = entry['cloud_id']
                fork = str(uuid.uuid4())
                pending['body']['session']['title'] = str(pending['body']['session'].get('title') or 'Untitled') + ' · 冲突分支'
                pending['body'].update(operation_id=str(uuid.uuid4()), base_version=0)
                entry.update(cloud_id=fork, version=0)
                self.local.save()
                response = self.request('PUT', '/v1/conversations/' + fork, json=pending['body'])
                self.local.stage(self.decode_attachments(self.request('GET', '/v1/conversations/' + original).json()))
                conflicts += 1
            response.raise_for_status()
            entry['version'] = response.json()['version']
            entry['hash'] = pending['hash']
            state['pending'].pop(local_id)
            if deleted:
                entry['retired'] = True
            self.local.save()
            uploaded += 1
        # Page change events; fetching a newer version is harmless because versions are monotonic.
        has_more = True
        while has_more:
            response = self.client.get('/v1/sync/changes', params={'after': state['cursor']})
            if response.status_code == 409:
                snapshot = self.request('GET', '/v1/sync/snapshot').json()
                changes = [{'conversation_id': c['id'], 'revision': c['version']} for c in snapshot['conversations']]
                next_cursor, has_more = snapshot['cursor'], False
            else:
                response.raise_for_status()
                page = response.json()
                changes, next_cursor, has_more = page['changes'], page['cursor'], page['has_more']
            known = {e['cloud_id']: e['version'] for e in state['sessions'].values()}
            for event in changes:
                cid = event['conversation_id']
                if event['revision'] <= max(known.get(cid, 0), state['inbox'].get(cid, 0)):
                    continue
                payload = self.request('GET', '/v1/conversations/' + cid).json()
                self.local.stage(self.decode_attachments(payload))
            state['cursor'] = next_cursor
            self.local.save()
        self.request('POST', '/v1/sync/ack', json={'revision': state['cursor']})
        return {'uploaded': uploaded, 'pending_downloads': len(state['inbox']), 'conflicts': conflicts,
                'last_sync_at': time.time(), **self.request('GET', '/v1/sync/status').json()}

    def close(self):
        self.client.close()
