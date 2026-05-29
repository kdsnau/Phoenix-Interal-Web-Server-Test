-- Phoenix Security & Technology — Fleet Schema
-- Run after schema.sql

CREATE TABLE IF NOT EXISTS vehicles (
    id            SERIAL        PRIMARY KEY,
    vehicle_id    VARCHAR(20)   UNIQUE NOT NULL,
    name          VARCHAR(100)  NOT NULL,
    make          VARCHAR(50),
    model         VARCHAR(100),
    year          INT,
    mileage       INT           DEFAULT 0,
    registration  VARCHAR(100),
    tags_renewal  DATE,
    slack_name    VARCHAR(100),   -- exact name used in Slack channel, e.g. "NV200 #1"
    created_at    TIMESTAMP     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_notes (
    id          SERIAL       PRIMARY KEY,
    vehicle_id  INT          NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    category    VARCHAR(20)  NOT NULL DEFAULT 'misc'
                             CHECK (category IN ('service', 'repair', 'misc')),
    content     TEXT         NOT NULL,
    created_at  TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_invoices (
    id            SERIAL        PRIMARY KEY,
    vehicle_id    INT           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    description   VARCHAR(255)  NOT NULL,
    amount        NUMERIC(10,2) NOT NULL,
    invoice_date  DATE          NOT NULL,
    created_at    TIMESTAMP     DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_service_notifications (
    id           SERIAL    PRIMARY KEY,
    vehicle_id   INT       UNIQUE NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    enabled      BOOLEAN   DEFAULT TRUE,
    last_sent_at TIMESTAMP,
    next_due_at  TIMESTAMP
);
