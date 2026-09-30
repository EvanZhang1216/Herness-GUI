import hashlib
import os
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from .auth import identity
from .database import lock_account
from .sync import quota_check

router = APIRouter(prefix='/v1')
MAX_ATTACHMENT = 20 * 1024 * 1024


class BlobStore:
    def __init__(self):
        self.bucket = os.environ.get('S3_BUCKET')
        if self.bucket:
            import boto3
            self.client = boto3.client('s3', endpoint_url=os.environ.get('S3_ENDPOINT'),
                                       region_name=os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))
        else:
            self.directory = Path(os.environ.get('BLOB_DIRECTORY', './private-blobs')).resolve()
            self.directory.mkdir(parents=True, exist_ok=True)

    def put(self, key, data):
        if self.bucket:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data)
        else:
            target = self.directory / key
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
            temporary.write_bytes(data)
            temporary.replace(target)

    def get(self, key):
        if self.bucket:
            return self.client.get_object(Bucket=self.bucket, Key=key)['Body'].read(MAX_ATTACHMENT + 1)
        return (self.directory / key).read_bytes()

    def delete(self, key):
        if self.bucket:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        else:
            (self.directory / key).unlink(missing_ok=True)


def check_id(value):
    if not re.fullmatch('[0-9a-f]{64}', value):
        raise HTTPException(422, '无效附件标识')


@router.put('/attachments/{attachment_id}')
async def upload(attachment_id: str, request: Request, user=Depends(identity)):
    check_id(attachment_id)
    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_ATTACHMENT:
            raise HTTPException(413, '单个附件不能超过 20 MB')
    if hashlib.sha256(content).hexdigest() != attachment_id:
        raise HTTPException(422, '附件校验失败')
    # Database and object-store work runs outside the async event loop.
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(save_attachment, request.app, user, attachment_id, bytes(content))


def save_attachment(app, user, attachment_id, content):
    with app.state.pool.connection() as db:
        lock_account(db, user['user_id'])
        if db.execute('SELECT 1 FROM attachments WHERE user_id=%s AND id=%s', (user['user_id'], attachment_id)).fetchone():
            return {'id': attachment_id}
        quota_check(db, user['user_id'], len(content))
        app.state.blobs.put(f"{user['user_id']}/{attachment_id}", content)
        db.execute('INSERT INTO attachments(user_id,id,filename,mime_type,byte_size) VALUES(%s,%s,%s,%s,%s)',
                   (user['user_id'], attachment_id, attachment_id, 'application/octet-stream', len(content)))
    return {'id': attachment_id}


@router.get('/attachments/{attachment_id}')
def download(attachment_id: str, request: Request, user=Depends(identity)):
    check_id(attachment_id)
    with request.app.state.pool.connection() as db:
        row = db.execute('SELECT * FROM attachments WHERE user_id=%s AND id=%s', (user['user_id'], attachment_id)).fetchone()
    if not row:
        raise HTTPException(404, '附件不存在')
    return Response(request.app.state.blobs.get(f"{user['user_id']}/{attachment_id}"),
                    media_type='application/octet-stream', headers={'Cache-Control': 'private, no-store'})
