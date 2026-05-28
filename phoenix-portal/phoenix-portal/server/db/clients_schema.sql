/* -------------------------------------------------------------------
   Clients schema
   Run after schema.sql (depends on users and service_tickets tables).
   ------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS clients (
    id                    SERIAL        PRIMARY KEY,
    customer_id           VARCHAR(50)   UNIQUE NOT NULL,
    name                  VARCHAR(200)  NOT NULL,
    system_name           VARCHAR(200),
    system_type           VARCHAR(100),
    vendor                VARCHAR(20)   DEFAULT 'generic',
    services              TEXT[]        DEFAULT '{}',
    last_connection       TIMESTAMP,
    serial_number         VARCHAR(100),
    connection_type       VARCHAR(50),
    carrier               VARCHAR(50),
    monitoring_enabled    BOOLEAN       DEFAULT FALSE,
    monitoring_started_at TIMESTAMP,
    billing_amount        NUMERIC(10,2) DEFAULT 0,
    notes                 TEXT,
    created_at            TIMESTAMP     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_customer_id ON clients(customer_id);
CREATE INDEX IF NOT EXISTS idx_clients_services    ON clients USING GIN(services);

/* Add client_id FK to service_tickets if not already present */
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'service_tickets' AND column_name = 'client_id'
    ) THEN
        ALTER TABLE service_tickets
            ADD COLUMN client_id INT REFERENCES clients(id) ON DELETE SET NULL;
    END IF;
END $$;

/* Weekly monitoring schedule */
CREATE TABLE IF NOT EXISTS client_monitoring (
    id            SERIAL    PRIMARY KEY,
    client_id     INT       UNIQUE NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    next_email_at TIMESTAMP,
    last_sent_at  TIMESTAMP
);

/* Per-client financial transactions */
CREATE TABLE IF NOT EXISTS client_transactions (
    id          SERIAL        PRIMARY KEY,
    client_id   INT           NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    description VARCHAR(300)  NOT NULL,
    amount      NUMERIC(10,2) NOT NULL,
    type        VARCHAR(20)   NOT NULL CHECK (type IN ('invoice', 'payment', 'expense')),
    date        DATE          NOT NULL DEFAULT CURRENT_DATE,
    created_by  INT           REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_transactions_client ON client_transactions(client_id);
