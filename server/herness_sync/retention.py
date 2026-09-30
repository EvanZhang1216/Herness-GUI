from .database import lock_account
from .sync import delete_conversation


def cleanup(pool, blobs):
    counts = {'conversations': 0, 'attachments': 0}
    with pool.connection() as db:
        users = db.execute('SELECT user_id FROM sync_state').fetchall()
    for user in users:
        uid = user['user_id']
        with pool.connection() as db:
            lock_account(db, uid)
            expired = db.execute('SELECT id FROM conversations WHERE user_id=%s AND expires_at<=now() AND deleted_at IS NULL',
                                 (uid,)).fetchall()
            for conversation in expired:
                delete_conversation(db, uid, conversation['id'])
                counts['conversations'] += 1
            orphaned = db.execute('''SELECT id FROM attachments a WHERE user_id=%s AND created_at<now()-interval '1 day'
              AND NOT EXISTS(SELECT 1 FROM conversation_attachments c WHERE c.user_id=a.user_id AND c.attachment_id=a.id)''', (uid,)).fetchall()
            for attachment in orphaned:
                blobs.delete(f"{uid}/{attachment['id']}")
                db.execute('DELETE FROM attachments WHERE user_id=%s AND id=%s', (uid, attachment['id']))
                counts['attachments'] += 1
            removed = db.execute("DELETE FROM sync_changes WHERE user_id=%s AND created_at<now()-interval '180 days' RETURNING revision", (uid,)).fetchall()
            if removed:
                db.execute('UPDATE sync_state SET min_revision=GREATEST(min_revision,%s) WHERE user_id=%s',
                           (max(row['revision'] for row in removed), uid))
            db.execute("DELETE FROM conversations WHERE user_id=%s AND deleted_at<now()-interval '180 days'", (uid,))
            db.execute("DELETE FROM sync_operations WHERE user_id=%s AND created_at<now()-interval '180 days'", (uid,))
    with pool.connection() as db:
        db.execute("DELETE FROM auth_sessions WHERE expires_at<now()-interval '1 day'")
        db.execute('DELETE FROM verification_tokens WHERE expires_at<now()')
        db.execute("DELETE FROM rate_limits WHERE window_start<now()-interval '1 day'")
    return counts
