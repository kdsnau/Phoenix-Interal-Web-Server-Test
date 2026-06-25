-- Provision a dedicated role + database for the door system.
-- Idempotent + portable: run ONCE per deployment as the postgres superuser:
--   psql -U postgres -h localhost -f scripts/create-db.sql
--
-- The password below is for LOCAL DEV only. For each client deployment, set a
-- unique strong password here (or via the DOOR_DB_PASSWORD pattern in the docs)
-- and match it in that client's backend/.env DATABASE_URL.

-- 1. App role (guarded so re-runs don't error).
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'phx') THEN
        CREATE ROLE phx WITH LOGIN PASSWORD 'phx_dev_pw';
    END IF;
END $$;

-- 2. Database owned by that role (CREATE DATABASE can't sit in a DO block; \gexec
--    runs the generated statement only when the db is absent).
SELECT 'CREATE DATABASE phx_door OWNER phx'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'phx_door')\gexec

GRANT ALL PRIVILEGES ON DATABASE phx_door TO phx;

-- 3. PG15+/18: the db owner does NOT automatically get CREATE on schema public,
--    so grant it explicitly or migrations can't create tables.
\connect phx_door
GRANT ALL ON SCHEMA public TO phx;

-- After this, in backend/.env:
--   DATABASE_URL=postgres://phx:phx_dev_pw@localhost:5432/phx_door
-- then: npm run migrate && npm run seed-admin
