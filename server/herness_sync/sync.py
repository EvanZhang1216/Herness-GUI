import hashlib
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from .auth import identity
from .database import change, lock_account

router = APIRouter(prefix='/v1')
MAX_BYTES = 16 * 1024 * 1024
RETENTION_DAYS = 180


class Message(BaseModel):
    id: uuid.UUID
    payload: dict


class Mutation(BaseModel):
    operation_id: uuid.UUID
    base_version: int = Field(ge=0)
    deleted: bool = False
    schema_version: int = 1
    session: dict = Field(default_factory=dict)
    messages: list[Message] = Field(default_factory=list, max_length=10000)
    attachment_ids: list[str] = Field(default_factory=list, max_length=1000)


def account_usage(db, user_id):
    return db.execute('''SELECT
      COALESCE((SELECT sum(byte_size) FROM conversations WHERE user_id=%s AND deleted_at IS NULL),0)
      + COALESCE((SELECT sum(byte_size) FROM attachments WHERE user_id=%s),0) AS used''',
                      (user_id, user_id)).fetchone()['used']


def quota_check(db, user_id, delta):
    limit = int(os.environ.get('ACCOUNT_QUOTA_BYTES', str(256 * 1024 * 1024)))
    if account_usage(db, user_id) + delta > limit:
        raise HTTPException(413, '账号云端存储配额已满，请删除不需要的数据')


def delete_conversation(db, user_id, conversation_id):
    revision = change(db, user_id, conversation_id, 'delete')
    db.execute('DELETE FROM messages WHERE user_id=%s AND conversation_id=%s', (user_id, conversation_id))
    db.execute('DELETE FROM conversation_attachments WHERE user_id=%s AND conversation_id=%s', (user_id, conversation_id))
    db.execute('''UPDATE conversations SET deleted_at=now(),updated_at=now(),version=%s,
               session_data='{}',title='',byte_size=0 WHERE user_id=%s AND id=%s''',
               (revision, user_id, conversation_id))
    return revision


@router.put('/conversations/{conversation_id}')
def put_conversation(conversation_id: uuid.UUID, data: Mutation, request: Request, user=Depends(identity)):
    if data.schema_version != 1:
        raise HTTPException(422, '同步数据版本不兼容，请升级客户端')
    encoded = json.dumps(data.model_dump(mode='json'), sort_keys=True, separators=(',', ':')).encode()
    if len(encoded) > MAX_BYTES:
        raise HTTPException(413, '单个会话超过同步大小限制')
    if len({m.id for m in data.messages}) != len(data.messages):
        raise HTTPException(422, '消息标识重复')
    request_hash = hashlib.sha256(str(conversation_id).encode() + encoded).hexdigest()
    uid = user['user_id']
    with request.app.state.pool.connection() as db:
        lock_account(db, uid)
        previous = db.execute('SELECT request_hash,result FROM sync_operations WHERE user_id=%s AND operation_id=%s',
                              (uid, data.operation_id)).fetchone()
        if previous:
            if previous['request_hash'] != request_hash:
                raise HTTPException(409, '操作标识已用于其他请求')
            return previous['result']
        current = db.execute('SELECT *,expires_at<=now() AS is_expired FROM conversations WHERE user_id=%s AND id=%s', (uid, conversation_id)).fetchone()
        if current and (current['deleted_at'] or current['is_expired']):
            raise HTTPException(410, '该会话已删除或到期，不可重新上传')
        if (current['version'] if current else 0) != data.base_version:
            raise HTTPException(409, {'message': '其他设备已修改该会话，请保留为分支',
                                      'version': current['version'] if current else 0})
        if data.deleted:
            if not current:
                raise HTTPException(404, '会话不存在')
            revision = delete_conversation(db, uid, conversation_id)
        else:
            try:
                created = datetime.fromtimestamp(float(data.session['started_at']), timezone.utc)
            except (KeyError, ValueError, TypeError, OverflowError):
                raise HTTPException(422, '会话创建时间无效') from None
            now = db.execute('SELECT now() AS current_time').fetchone()['current_time']
            if created > now + timedelta(minutes=5) or created <= now - timedelta(days=RETENTION_DAYS):
                raise HTTPException(410, '会话已超过 180 天保留期或设备时间不正确')
            if current:
                created = min(created, current['created_at'])
            for attachment_id in set(data.attachment_ids):
                if not db.execute('SELECT 1 FROM attachments WHERE user_id=%s AND id=%s', (uid, attachment_id)).fetchone():
                    raise HTTPException(422, '附件未上传或不属于当前账号')
            quota_check(db, uid, len(encoded) - (current['byte_size'] if current else 0))
            revision = change(db, uid, conversation_id, 'upsert')
            title = str(data.session.get('title') or 'Untitled')[:500]
            db.execute('''INSERT INTO conversations(user_id,id,version,title,session_data,byte_size,created_at,expires_at)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(user_id,id) DO UPDATE SET
              version=excluded.version,title=excluded.title,session_data=excluded.session_data,
              byte_size=excluded.byte_size,created_at=excluded.created_at,expires_at=excluded.expires_at,updated_at=now()''',
                       (uid, conversation_id, revision, title, Jsonb(data.session), len(encoded), created,
                        created + timedelta(days=RETENTION_DAYS)))
            # Only the current transcript is retained; no quadratic full-history snapshots.
            db.execute('DELETE FROM messages WHERE user_id=%s AND conversation_id=%s', (uid, conversation_id))
            with db.cursor() as cursor:
                cursor.executemany('INSERT INTO messages(user_id,conversation_id,id,sequence,payload) VALUES(%s,%s,%s,%s,%s)',
                                   [(uid, conversation_id, message.id, i, Jsonb(message.payload))
                                    for i, message in enumerate(data.messages)])
            db.execute('DELETE FROM conversation_attachments WHERE user_id=%s AND conversation_id=%s', (uid, conversation_id))
            for attachment_id in set(data.attachment_ids):
                db.execute('INSERT INTO conversation_attachments VALUES(%s,%s,%s)', (uid, conversation_id, attachment_id))
        result = {'id': str(conversation_id), 'version': revision}
        db.execute('INSERT INTO sync_operations(user_id,operation_id,request_hash,result) VALUES(%s,%s,%s,%s)',
                   (uid, data.operation_id, request_hash, Jsonb(result)))
        return result


@router.get('/conversations/{conversation_id}')
def get_conversation(conversation_id: uuid.UUID, request: Request, user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        # Version, context and messages must belong to the same committed snapshot.
        lock_account(db, user['user_id'])
        row = db.execute('SELECT *,expires_at<=now() AS is_expired FROM conversations WHERE user_id=%s AND id=%s',
                         (user['user_id'], conversation_id)).fetchone()
        if not row:
            raise HTTPException(404, '会话不存在')
        if row['deleted_at'] or row['is_expired']:
            return {'id': str(conversation_id), 'version': row['version'], 'deleted': True}
        messages = db.execute('SELECT id,payload FROM messages WHERE user_id=%s AND conversation_id=%s ORDER BY sequence',
                              (user['user_id'], conversation_id)).fetchall()
        attachments = db.execute('''SELECT a.id,a.filename,a.mime_type,a.byte_size FROM attachments a
          JOIN conversation_attachments c ON a.user_id=c.user_id AND a.id=c.attachment_id
          WHERE c.user_id=%s AND c.conversation_id=%s''', (user['user_id'], conversation_id)).fetchall()
        return {'id': str(conversation_id), 'version': row['version'], 'schema_version': row['schema_version'],
                'session': row['session_data'], 'messages': messages, 'attachments': attachments,
                'expires_at': row['expires_at']}


@router.get('/sync/changes')
def changes(request: Request, after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=200),
            user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        state = db.execute('SELECT * FROM sync_state WHERE user_id=%s', (user['user_id'],)).fetchone()
        if after < state['min_revision'] or after > state['revision']:
            raise HTTPException(409, '同步游标已失效，请重新获取云端列表')
        rows = db.execute('''SELECT revision,conversation_id,operation FROM sync_changes
           WHERE user_id=%s AND revision>%s ORDER BY revision LIMIT %s''', (user['user_id'], after, limit)).fetchall()
        return {'changes': rows, 'cursor': rows[-1]['revision'] if rows else after,
                'has_more': bool(rows and rows[-1]['revision'] < state['revision'])}


@router.get('/sync/snapshot')
def snapshot(request: Request, user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        # Serialize against writers so the list and its cursor describe the same state.
        state = lock_account(db, user['user_id'])
        rows = db.execute('SELECT id,version,deleted_at,expires_at FROM conversations WHERE user_id=%s',
                          (user['user_id'],)).fetchall()
        return {'conversations': rows, 'cursor': state['revision']}


class Acknowledgment(BaseModel):
    revision: int = Field(ge=0)


@router.post('/sync/ack')
def acknowledge(data: Acknowledgment, request: Request, user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        state = lock_account(db, user['user_id'])
        if data.revision > state['revision']:
            raise HTTPException(422, '无效版本')
        db.execute('''INSERT INTO device_sync_cursors(user_id,device_id,revision) VALUES(%s,%s,%s)
          ON CONFLICT(user_id,device_id) DO UPDATE SET revision=GREATEST(device_sync_cursors.revision,excluded.revision),last_sync_at=now()''',
                   (user['user_id'], user['device_id'], data.revision))
    return {'ok': True}


@router.get('/sync/status')
def status(request: Request, user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        return {'used_bytes': account_usage(db, user['user_id']),
                'quota_bytes': int(os.environ.get('ACCOUNT_QUOTA_BYTES', str(256 * 1024 * 1024))),
                'retention_days': RETENTION_DAYS}
