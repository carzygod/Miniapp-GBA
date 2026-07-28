CREATE TABLE users (
    id uuid PRIMARY KEY,
    wechat_subject_hash char(64) NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('active', 'deleting', 'deleted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE devices (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    client_device_id uuid NOT NULL,
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, client_device_id)
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    device_id uuid NOT NULL REFERENCES devices(id),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE save_heads (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    rom_id char(64) NOT NULL CHECK (rom_id ~ '^[0-9a-f]{64}$'),
    kind text NOT NULL CHECK (kind IN ('battery', 'state', 'auto_state')),
    slot text NOT NULL CHECK (slot ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
    current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, rom_id, kind, slot)
);

CREATE TABLE blobs (
    digest char(64) PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    reference_count bigint NOT NULL CHECK (reference_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    delete_after timestamptz
);

CREATE TABLE save_versions (
    id uuid PRIMARY KEY,
    save_head_id uuid NOT NULL REFERENCES save_heads(id),
    revision bigint NOT NULL CHECK (revision > 0),
    checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    blob_digest char(64) NOT NULL REFERENCES blobs(digest),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    core_build_id text NOT NULL CHECK (char_length(core_build_id) BETWEEN 1 AND 128),
    device_id uuid REFERENCES devices(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE (save_head_id, revision)
);

CREATE TABLE idempotency_keys (
    user_id uuid NOT NULL REFERENCES users(id),
    key uuid NOT NULL,
    request_hash char(64) NOT NULL,
    response_status integer NOT NULL,
    response_body jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, key)
);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES users(id),
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deletion_jobs (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    status text NOT NULL CHECK (status IN ('pending', 'running', 'complete', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX devices_user_idx ON devices (user_id, last_seen_at DESC);
CREATE INDEX sessions_user_idx ON sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX save_heads_user_idx ON save_heads (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX save_heads_user_rom_idx ON save_heads (user_id, rom_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX save_versions_head_idx ON save_versions (save_head_id, revision DESC) WHERE deleted_at IS NULL;
CREATE INDEX save_versions_created_idx ON save_versions (created_at) WHERE deleted_at IS NULL;
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);
CREATE INDEX audit_events_user_idx ON audit_events (user_id, created_at DESC);
CREATE INDEX deletion_jobs_status_idx ON deletion_jobs (status, created_at);

