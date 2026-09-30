CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, username text NOT NULL, username_normalized text NOT NULL UNIQUE,
 email text NOT NULL, email_normalized text NOT NULL UNIQUE, password_hash text NOT NULL,
 email_verified_at timestamptz, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, id uuid NOT NULL,
 name text NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL, device_id uuid NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,device_id) REFERENCES devices(user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id,device_id);
CREATE TABLE IF NOT EXISTS verification_tokens (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK(purpose IN ('email_verification','password_reset')), token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE IF NOT EXISTS sync_state (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision bigint NOT NULL DEFAULT 0, min_revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversations (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, id uuid NOT NULL,
 version bigint NOT NULL, title text NOT NULL, session_data jsonb NOT NULL,
 schema_version integer NOT NULL DEFAULT 1, byte_size bigint NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, deleted_at timestamptz,
 PRIMARY KEY(user_id,id)
);
CREATE INDEX IF NOT EXISTS conversations_expiry ON conversations(expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS conversations_list ON conversations(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (
 user_id uuid NOT NULL, conversation_id uuid NOT NULL, id uuid NOT NULL,
 sequence integer NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(user_id,conversation_id,id), UNIQUE(user_id,conversation_id,sequence),
 FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attachments (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, id text NOT NULL,
 filename text NOT NULL, mime_type text NOT NULL, byte_size bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,id)
);
CREATE TABLE IF NOT EXISTS conversation_attachments (
 user_id uuid NOT NULL, conversation_id uuid NOT NULL, attachment_id text NOT NULL,
 PRIMARY KEY(user_id,conversation_id,attachment_id),
 FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,attachment_id) REFERENCES attachments(user_id,id)
);
CREATE TABLE IF NOT EXISTS sync_changes (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, revision bigint NOT NULL,
 conversation_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('upsert','delete')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,revision)
);
CREATE TABLE IF NOT EXISTS sync_operations (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, operation_id uuid NOT NULL,
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE IF NOT EXISTS device_sync_cursors (
 user_id uuid NOT NULL, device_id uuid NOT NULL, revision bigint NOT NULL DEFAULT 0,
 last_sync_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,device_id),
 FOREIGN KEY(user_id,device_id) REFERENCES devices(user_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
