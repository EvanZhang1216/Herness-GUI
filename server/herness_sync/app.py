from contextlib import asynccontextmanager
from fastapi import FastAPI
from starlette.responses import JSONResponse
from . import auth, blobs, sync
from .database import create_pool


@asynccontextmanager
async def lifespan(app):
    app.state.pool = create_pool()
    app.state.pool.wait()
    app.state.blobs = blobs.BlobStore()
    yield
    app.state.pool.close()


app = FastAPI(title='Herness account and sync service', version='1', lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)


class BodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        limit = 21 * 1024 * 1024
        headers = dict(scope['headers'])
        try:
            oversized = int(headers.get(b'content-length', b'0')) > limit
        except ValueError:
            oversized = True
        if oversized:
            return await JSONResponse({'detail': '请求过大'}, status_code=413)(scope, receive, send)
        total = 0
        async def bounded_receive():
            nonlocal total
            message = await receive()
            total += len(message.get('body', b''))
            if total > limit:
                from fastapi import HTTPException
                raise HTTPException(413, '请求过大')
            return message
        await self.app(scope, bounded_receive, send)


app.add_middleware(BodyLimit)
app.include_router(auth.router)
app.include_router(sync.router)
app.include_router(blobs.router)


@app.get('/health')
def health():
    with app.state.pool.connection() as db:
        db.execute('SELECT 1')
    return {'ok': True, 'protocol': 1, 'retention_days': 180, 'email_verification_required': False}
