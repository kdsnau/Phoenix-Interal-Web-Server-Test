-- Phoenix NFC Door-Access -- Postgres schema
-- Idempotent-ish: safe to run on a fresh database. Enums are guarded.

DO $$ BEGIN CREATE TYPE user_role        AS ENUM ('admin','user');            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE credential_type  AS ENUM ('uid_card','phone');        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE rule_type        AS ENUM ('time_window','door_access'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE rule_scope       AS ENUM ('user','group','all');      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE rule_effect      AS ENUM ('allow','deny');            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE fail_policy      AS ENUM ('closed','open');           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE access_decision  AS ENUM ('granted','denied');        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- People who can hold credentials and/or log in.
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(120) NOT NULL,
    email         VARCHAR(190) UNIQUE NOT NULL,
    password_hash TEXT,                                  -- NULL = card-only user, cannot log in
    role          user_role NOT NULL DEFAULT 'user',
    active        BOOLEAN  NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A credential is one way a user opens doors: a physical UID card OR a phone.
CREATE TABLE IF NOT EXISTS credentials (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        credential_type NOT NULL,
    uid         TEXT,            -- uid_card: the card's hex UID (unique). Phones: NULL.
    public_id   TEXT,            -- phone: stable public identifier presented over HCE. Cards: NULL.
    token_key   TEXT,            -- phone: per-credential HMAC secret for rotating tokens. Cards: NULL.
    label       VARCHAR(120),
    active       BOOLEAN NOT NULL DEFAULT TRUE,
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS credentials_uid_key       ON credentials(uid)       WHERE uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credentials_public_id_key ON credentials(public_id) WHERE public_id IS NOT NULL;
CREATE INDEX        IF NOT EXISTS credentials_user_idx      ON credentials(user_id);

-- A door = one physical reader rig (one Arduino+PN532+relay).
CREATE TABLE IF NOT EXISTS doors (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    location        VARCHAR(190),
    reader_key      TEXT NOT NULL,                       -- shared HMAC secret for this reader's API calls
    fail_policy     fail_policy NOT NULL DEFAULT 'closed',
    relay_unlock_ms INT NOT NULL DEFAULT 5000,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Groups let rules/door-access apply to many users at once.
CREATE TABLE IF NOT EXISTS access_groups (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(120) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_groups (
    user_id  INT NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    group_id INT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
);

-- The rule engine's data. See services/ruleEngine.js for evaluation semantics.
--   type=door_access  -> WHO may use a door (effect allow/deny), no time component.
--   type=time_window  -> WHEN; effect=allow grants only inside the window, deny blocks inside it.
--   scope=all|user|group with target_id; door_id NULL = applies to every door.
--   days_mask bit i (i = JS getDay(): 0=Sun..6=Sat); 127 = all days.
CREATE TABLE IF NOT EXISTS rules (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    type       rule_type   NOT NULL,
    scope      rule_scope  NOT NULL DEFAULT 'all',
    target_id  INT,                                      -- user id or group id depending on scope
    door_id    INT REFERENCES doors(id) ON DELETE CASCADE,
    days_mask  INT  NOT NULL DEFAULT 127,
    start_time TIME,                                     -- time_window only
    end_time   TIME,                                     -- time_window only
    effect     rule_effect NOT NULL DEFAULT 'allow',
    priority   INT  NOT NULL DEFAULT 0,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rules_door_idx ON rules(door_id);

-- Every tap, granted or denied -- this is the scan-usage log.
CREATE TABLE IF NOT EXISTS access_events (
    id            SERIAL PRIMARY KEY,
    door_id       INT REFERENCES doors(id)       ON DELETE SET NULL,
    credential_id INT REFERENCES credentials(id) ON DELETE SET NULL,
    user_id       INT REFERENCES users(id)       ON DELETE SET NULL,
    decision      access_decision NOT NULL,
    reason        VARCHAR(80),
    raw_uid       TEXT,                                  -- captured even for unknown cards (enrollment / forensics)
    was_offline   BOOLEAN NOT NULL DEFAULT FALSE,
    scanned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS access_events_door_idx    ON access_events(door_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS access_events_user_idx    ON access_events(user_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS access_events_scanned_idx ON access_events(scanned_at DESC);
