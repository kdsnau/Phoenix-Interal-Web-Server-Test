CREATE TABLE IF NOT EXISTS inventory_items (
    id            SERIAL       PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    sku           VARCHAR(100),
    category      VARCHAR(50)  NOT NULL DEFAULT 'equipment',
    quantity      INT          NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    min_threshold INT          NOT NULL DEFAULT 0 CHECK (min_threshold >= 0),
    unit          VARCHAR(30)  NOT NULL DEFAULT 'ea',
    location      VARCHAR(150),
    notes         TEXT,
    created_at    TIMESTAMP    DEFAULT NOW(),
    updated_at    TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category);
