import os
from pathlib import Path
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


def create_pool():
    return ConnectionPool(os.environ['DATABASE_URL'], min_size=1, max_size=8,
                          kwargs={'row_factory': dict_row}, open=True, timeout=10)


def migrate(pool):
    with pool.connection() as db:
        db.execute('SELECT pg_advisory_xact_lock(742118001)')
        db.execute(Path(__file__).with_name('schema.sql').read_text(encoding='utf-8'))


def lock_account(db, user_id):
    return db.execute('SELECT revision,min_revision FROM sync_state WHERE user_id=%s FOR UPDATE',
                      (user_id,)).fetchone()


def change(db, user_id, conversation_id, operation):
    row = db.execute('UPDATE sync_state SET revision=revision+1 WHERE user_id=%s RETURNING revision',
                     (user_id,)).fetchone()
    revision = row['revision']
    db.execute('INSERT INTO sync_changes(user_id,revision,conversation_id,operation) VALUES(%s,%s,%s,%s)',
               (user_id, revision, conversation_id, operation))
    return revision
