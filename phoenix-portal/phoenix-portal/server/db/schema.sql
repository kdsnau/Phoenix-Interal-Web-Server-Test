-- Phoenix Security & Technology -- Internal Portal Schema

CREATE TYPE user_role AS ENUM ('technician', 'accounting', 'admin');
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
CREATE TYPE record_type AS ENUM ('income', 'expense');

-- Users
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role        user_role NOT NULL DEFAULT 'technician',
    created_at  TIMESTAMP DEFAULT NOW()
);

-- Service Tickets (technician domain)
CREATE TABLE IF NOT EXISTS service_tickets (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    status      ticket_status NOT NULL DEFAULT 'open',
    created_by  INT REFERENCES users(id) ON DELETE SET NULL,
    assigned_to INT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- Financial Records (accounting domain)
CREATE TABLE IF NOT EXISTS financial_records (
    id          SERIAL PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    amount      NUMERIC(12, 2) NOT NULL,
    type        record_type NOT NULL,
    created_by  INT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- Notifications log
CREATE TABLE IF NOT EXISTS notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INT REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT NOT NULL,
    sent_at     TIMESTAMP DEFAULT NOW()
);

-- Seed: default admin account (password: Admin1234!)
INSERT INTO users (name, email, password_hash, role)
VALUES (
    'Admin',
    'admin@phoenixsectech.com',
    '$2a$10$wQj5PTj.MtCKW/fshLYLo.WAnA7GzFQy7k2jptGgXv3zV4OjhCcFe',
    'admin'
) ON CONFLICT (email) DO NOTHING;
