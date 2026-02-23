-- Inventory App v3 schema (Supabase Postgres)
-- Run this file first in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS app_settings (
    id            SERIAL PRIMARY KEY,
    pin_hash      TEXT,
    next_in_num   INTEGER DEFAULT 1,
    next_out_num  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS goods_groups (
    id         SERIAL PRIMARY KEY,
    parent_id  INTEGER REFERENCES goods_groups(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    price_in   NUMERIC(10,2) DEFAULT 0,
    price_out  NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goods (
    id         SERIAL PRIMARY KEY,
    barcode    TEXT,
    name       TEXT NOT NULL,
    group_id   INTEGER REFERENCES goods_groups(id),
    avg_cost   NUMERIC(10,2) DEFAULT 0,
    quantity   NUMERIC(10,2) DEFAULT 0,
    measure    TEXT
);

CREATE TABLE IF NOT EXISTS contragents (
    id        SERIAL PRIMARY KEY,
    name      TEXT NOT NULL,
    phone     TEXT,
    email     TEXT,
    address   TEXT,
    type      INTEGER NOT NULL, -- 0=supplier, 1=customer
    notes     TEXT
);

CREATE TABLE IF NOT EXISTS customer_group_prices (
    id             SERIAL PRIMARY KEY,
    contragent_id  INTEGER REFERENCES contragents(id) ON DELETE CASCADE,
    group_id       INTEGER REFERENCES goods_groups(id) ON DELETE CASCADE,
    price_out      NUMERIC(10,2),
    UNIQUE (contragent_id, group_id)
);

CREATE TABLE IF NOT EXISTS documents (
    id            SERIAL PRIMARY KEY,
    doc_type      INTEGER NOT NULL, -- 1=incoming, 2=outgoing
    doc_date      DATE NOT NULL,
    doc_num       TEXT NOT NULL,
    description   TEXT,
    contragent_id INTEGER REFERENCES contragents(id),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doc_lines (
    id           SERIAL PRIMARY KEY,
    doc_id        INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    good_id       INTEGER REFERENCES goods(id),
    quantity      NUMERIC(10,2) NOT NULL,
    price         NUMERIC(10,2) NOT NULL,
    cost_at_time  NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS idx_goods_group_id ON goods(group_id);
CREATE INDEX IF NOT EXISTS idx_goods_name ON goods(name);
CREATE INDEX IF NOT EXISTS idx_goods_groups_parent_id ON goods_groups(parent_id);
CREATE INDEX IF NOT EXISTS idx_contragents_type ON contragents(type);
CREATE INDEX IF NOT EXISTS idx_contragents_name ON contragents(name);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_doc_date ON documents(doc_date);
CREATE INDEX IF NOT EXISTS idx_documents_contragent_id ON documents(contragent_id);
CREATE INDEX IF NOT EXISTS idx_doc_lines_doc_id ON doc_lines(doc_id);
CREATE INDEX IF NOT EXISTS idx_doc_lines_good_id ON doc_lines(good_id);
CREATE INDEX IF NOT EXISTS idx_customer_group_prices_contragent ON customer_group_prices(contragent_id);
CREATE INDEX IF NOT EXISTS idx_customer_group_prices_group ON customer_group_prices(group_id);

INSERT INTO app_settings (id, pin_hash, next_in_num, next_out_num)
VALUES (1, NULL, 1, 1)
ON CONFLICT (id) DO NOTHING;

