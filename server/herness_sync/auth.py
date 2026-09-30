import hashlib
import re
import secrets
import threading
import uuid
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg.errors import UniqueViolation
from pydantic import BaseModel, Field, field_validator

router = APIRouter(prefix='/v1')
hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
dummy_hash = hasher.hash(secrets.token_urlsafe(32))
hash_slots = threading.BoundedSemaphore(2)
bearer = HTTPBearer(auto_error=False)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=10, max_length=128)
    device_id: uuid.UUID
    device_name: str = Field(default='Desktop', min_length=1, max_length=100)

    @field_validator('username')
    @classmethod
    def username_format(cls, value):
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{2,31}', value):
            raise ValueError('用户名使用 3–32 位英文字母、数字、点、下划线或连字符')
        return value


class Registration(Credentials):
    email: str = Field(max_length=254)

    @field_validator('email')
    @classmethod
    def email_format(cls, value):
        value = value.strip()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('邮箱格式不正确')
        return value


def limit(request, label, maximum):
    # Count failed requests in a separate committed transaction too. Never trust X-Forwarded-For here.
    key = f'{label}:{request.client.host}'
    with request.app.state.pool.connection() as db:
        row = db.execute('''INSERT INTO rate_limits(key,window_start,attempts) VALUES(%s,now(),1)
          ON CONFLICT(key) DO UPDATE SET
          attempts=CASE WHEN rate_limits.window_start < now()-interval '1 minute' THEN 1 ELSE rate_limits.attempts+1 END,
          window_start=CASE WHEN rate_limits.window_start < now()-interval '1 minute' THEN now() ELSE rate_limits.window_start END
          RETURNING attempts''', (key,)).fetchone()
    if row['attempts'] > maximum:
        raise HTTPException(429, '请求过于频繁，请稍后重试', headers={'Retry-After': '60'})


def public_user(user):
    return {key: str(user[key]) if key == 'id' else user[key]
            for key in ('id', 'username', 'email', 'email_verified_at')}


def issue(db, user, data):
    token = secrets.token_urlsafe(48)
    db.execute('''INSERT INTO devices(user_id,id,name) VALUES(%s,%s,%s)
      ON CONFLICT(user_id,id) DO UPDATE SET name=excluded.name,last_seen_at=now(),revoked_at=NULL''',
               (user['id'], data.device_id, data.device_name))
    db.execute('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=%s AND device_id=%s AND revoked_at IS NULL',
               (user['id'], data.device_id))
    db.execute('INSERT INTO auth_sessions(token_hash,user_id,device_id,expires_at) VALUES(%s,%s,%s,%s)',
               (digest(token), user['id'], data.device_id, datetime.now(timezone.utc) + timedelta(days=30)))
    return {'user': public_user(user), 'token': token, 'expires_in': 30 * 86400}


@router.post('/auth/register', status_code=201)
def register(data: Registration, request: Request):
    limit(request, 'register', 5)
    with hash_slots:
        password_hash = hasher.hash(data.password)
    try:
        with request.app.state.pool.connection() as db:
            user = db.execute('''INSERT INTO users(id,username,username_normalized,email,email_normalized,password_hash)
              VALUES(%s,%s,%s,%s,%s,%s) RETURNING *''',
                              (uuid.uuid4(), data.username, data.username.lower(), data.email,
                               data.email.casefold(), password_hash)).fetchone()
            db.execute('INSERT INTO sync_state(user_id) VALUES(%s)', (user['id'],))
            return issue(db, user, data)
    except UniqueViolation:
        raise HTTPException(409, '用户名或邮箱已被使用') from None


@router.post('/auth/login')
def login(data: Credentials, request: Request):
    limit(request, 'login', 10)
    with request.app.state.pool.connection() as db:
        user = db.execute('SELECT * FROM users WHERE username_normalized=%s', (data.username.lower(),)).fetchone()
        with hash_slots:
            try:
                valid = hasher.verify(user['password_hash'] if user else dummy_hash, data.password)
            except (VerifyMismatchError, InvalidHashError):
                valid = False
        if not valid or not user or user['status'] != 'active':
            raise HTTPException(401, '用户名或密码不正确')
        return issue(db, user, data)


def identity(request: Request, credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, '请先登录')
    with request.app.state.pool.connection() as db:
        row = db.execute('''SELECT s.user_id,s.device_id,u.username,u.email,u.email_verified_at
          FROM auth_sessions s JOIN users u ON u.id=s.user_id
          JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id
          WHERE s.token_hash=%s AND s.expires_at>now() AND s.revoked_at IS NULL
          AND d.revoked_at IS NULL AND u.status='active' ''', (digest(credentials.credentials),)).fetchone()
    if not row:
        raise HTTPException(401, '登录已过期或设备已退出，请重新登录')
    row['token_hash'] = digest(credentials.credentials)
    return row


@router.get('/auth/me')
def me(user=Depends(identity)):
    return {'id': str(user['user_id']), 'username': user['username'], 'email': user['email'],
            'email_verified_at': user['email_verified_at']}


@router.post('/auth/logout')
def logout(request: Request, user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        db.execute('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=%s', (user['token_hash'],))
    return {'ok': True}


@router.get('/devices')
def devices(request: Request, user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        return db.execute('SELECT id,name,last_seen_at,revoked_at FROM devices WHERE user_id=%s ORDER BY last_seen_at DESC',
                          (user['user_id'],)).fetchall()


@router.delete('/devices/{device_id}')
def revoke(device_id: uuid.UUID, request: Request, user=Depends(identity)):
    with request.app.state.pool.connection() as db:
        db.execute('UPDATE devices SET revoked_at=now() WHERE user_id=%s AND id=%s', (user['user_id'], device_id))
    return {'ok': True}
