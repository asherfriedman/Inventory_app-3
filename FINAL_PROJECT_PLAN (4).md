# Inventory App — Final Specification v4

## Tech Stack

| Layer | Choice |
|-------|--------|
| **Frontend** | Plain HTML + CSS + vanilla JS (no frameworks, no build step) |
| **Backend** | Vercel Node.js serverless functions (`/api/*.js`) |
| **Database** | Supabase Postgres (free tier) |
| **Transactions** | Postgres RPC functions for atomic doc create/edit/delete |
| **PWA** | Service worker + manifest (installable on iPhone home screen) |
| **Auth** | Simple PIN/password gate (client-side, stored hashed in Supabase) |
| **Target device** | iPhone 17 Pro — 393×852pt viewport, light theme |

Everything is JavaScript. No Python, no React, no build tools.

## Architecture

```
iPhone 17 Pro (Safari PWA)
    │
    ▼
Vercel (free tier)
    ├── public/*.html, css/, js/     ← static files
    └── api/*.js                     ← Node.js serverless functions
            │                           (thin wrappers calling Supabase RPCs)
            ▼
    Supabase Postgres (free tier)
        └── RPC functions             ← atomic transactions for documents
```

---

## Features — Final Scope

### ✅ Building
- Goods catalog with **nested groups** (parent → child hierarchy)
- Incoming documents (purchases) — auto-increases stock + recalculates avg cost
- Outgoing documents (sales) — auto-decreases stock, blocks if insufficient
- Contragents — **separate** suppliers and customers
- **Weighted average cost** — auto-updates on incoming
- **Group-level default pricing** (buy price + sell price per group)
- **Customer + group price overrides** — saved inline when doc price differs
- Manual price edit on any document line
- Auto-increment doc numbers (IN-001, OUT-001) — race-condition safe via RPC
- Edit confirmed docs (reverse old stock, re-apply new) — atomic via RPC
- Delete documents (fully removes, reverses stock) — atomic via RPC
- Transaction history per customer AND per product
- Reports: profit by date range, by customer, by group, inventory value
- Home dashboard: stats at top, nav buttons below
- Simple PIN/password to open app
- PWA installable on iPhone home screen
- Data migration from existing SQLite DB (**Main Store only**)

### ❌ Not building
- Multiple stores (single store only)
- Draft/confirm workflow (saves = confirmed immediately)
- Discounts (not used)
- Barcode scanning
- Excel import/export
- Product photos
- Custom fields
- Print to PDF
- Expense tracking
- Minimum stock alerts

---

## Database Schema (Supabase Postgres)

### `app_settings`
```sql
CREATE TABLE app_settings (
    id          SERIAL PRIMARY KEY,
    pin_hash    TEXT,
    next_in_num INTEGER DEFAULT 1,
    next_out_num INTEGER DEFAULT 1
);
```

### `goods_groups`
```sql
CREATE TABLE goods_groups (
    id          SERIAL PRIMARY KEY,
    parent_id   INTEGER REFERENCES goods_groups(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    price_in    NUMERIC(10,2) DEFAULT 0,
    price_out   NUMERIC(10,2) DEFAULT 0
);

-- Current hierarchy from your data:
-- Parent groups (parent_id = NULL): Myle, Fume, Random, Jul, ZVapex, YME
-- Child groups (parent_id set):
--   Myle → Myle Mini, Meta Bar, Meta Box, Meta 9000, Z20K, 18K, 25K, Mini Box, ...
--   Fume → Fume Extra, Fume Ultra, Fume Infinity, Fume Mini, Fume Recharge, ...
--   Random → Puff 1600, Puff 800, Flow, Air Bar Max, Air Bar Box, Elf Bar, ...
```

### `goods`
```sql
CREATE TABLE goods (
    id          SERIAL PRIMARY KEY,
    barcode     TEXT,
    name        TEXT NOT NULL,
    group_id    INTEGER REFERENCES goods_groups(id),
    avg_cost    NUMERIC(10,2) DEFAULT 0,
    quantity    NUMERIC(10,2) DEFAULT 0,
    measure     TEXT
);
```

### `contragents`
```sql
CREATE TABLE contragents (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    phone       TEXT,
    email       TEXT,
    address     TEXT,
    type        INTEGER NOT NULL,       -- 0=supplier, 1=customer
    notes       TEXT
);
```

### `customer_group_prices`
```sql
CREATE TABLE customer_group_prices (
    id              SERIAL PRIMARY KEY,
    contragent_id   INTEGER REFERENCES contragents(id) ON DELETE CASCADE,
    group_id        INTEGER REFERENCES goods_groups(id) ON DELETE CASCADE,
    price_out       NUMERIC(10,2),
    UNIQUE(contragent_id, group_id)
);
```

### `documents`
```sql
CREATE TABLE documents (
    id              SERIAL PRIMARY KEY,
    doc_type        INTEGER NOT NULL,   -- 1=incoming, 2=outgoing
    doc_date        DATE NOT NULL,
    doc_num         TEXT NOT NULL,       -- "IN-001", "OUT-042"
    description     TEXT,
    contragent_id   INTEGER REFERENCES contragents(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### `doc_lines`
```sql
CREATE TABLE doc_lines (
    id              SERIAL PRIMARY KEY,
    doc_id          INTEGER REFERENCES documents(id) ON DELETE CASCADE,
    good_id         INTEGER REFERENCES goods(id),
    quantity        NUMERIC(10,2) NOT NULL,
    price           NUMERIC(10,2) NOT NULL,
    cost_at_time    NUMERIC(10,2)
);
```

**Total: 7 tables**

---

## Postgres RPC Functions (Atomic Transactions)

All document operations run as single Postgres transactions via `supabase.rpc()`.
This prevents race conditions on doc numbers, partial stock updates, and inconsistent avg_cost.

### `rpc_create_document`

```sql
CREATE OR REPLACE FUNCTION rpc_create_document(
    p_doc_type INTEGER,
    p_doc_date DATE,
    p_description TEXT,
    p_contragent_id INTEGER,
    p_lines JSONB  -- [{good_id, quantity, price}, ...]
) RETURNS JSONB AS $$
DECLARE
    v_doc_num TEXT;
    v_doc_id INTEGER;
    v_line JSONB;
    v_good RECORD;
    v_new_avg NUMERIC(10,2);
BEGIN
    -- 1. Get and increment doc number atomically
    IF p_doc_type = 1 THEN
        UPDATE app_settings SET next_in_num = next_in_num + 1
            RETURNING 'IN-' || LPAD((next_in_num - 1)::TEXT, 3, '0') INTO v_doc_num;
    ELSE
        UPDATE app_settings SET next_out_num = next_out_num + 1
            RETURNING 'OUT-' || LPAD((next_out_num - 1)::TEXT, 3, '0') INTO v_doc_num;
    END IF;

    -- 2. Insert document
    INSERT INTO documents (doc_type, doc_date, doc_num, description, contragent_id)
        VALUES (p_doc_type, p_doc_date, v_doc_num, p_description, p_contragent_id)
        RETURNING id INTO v_doc_id;

    -- 3. Process each line
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        -- Get current good state
        SELECT * INTO v_good FROM goods WHERE id = (v_line->>'good_id')::INTEGER FOR UPDATE;

        IF p_doc_type = 2 THEN
            -- OUTGOING: check stock
            IF v_good.quantity < (v_line->>'quantity')::NUMERIC THEN
                RAISE EXCEPTION 'Not enough stock for "%" (available: %, requested: %)',
                    v_good.name, v_good.quantity, (v_line->>'quantity')::NUMERIC;
            END IF;

            -- Insert line with cost snapshot
            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
                VALUES (v_doc_id, v_good.id, (v_line->>'quantity')::NUMERIC,
                        (v_line->>'price')::NUMERIC, v_good.avg_cost);

            -- Decrease stock (avg_cost unchanged)
            UPDATE goods SET quantity = quantity - (v_line->>'quantity')::NUMERIC
                WHERE id = v_good.id;

        ELSIF p_doc_type = 1 THEN
            -- INCOMING: calculate new weighted average cost
            IF (v_good.quantity + (v_line->>'quantity')::NUMERIC) > 0 THEN
                v_new_avg := (v_good.quantity * v_good.avg_cost +
                             (v_line->>'quantity')::NUMERIC * (v_line->>'price')::NUMERIC) /
                             (v_good.quantity + (v_line->>'quantity')::NUMERIC);
            ELSE
                v_new_avg := (v_line->>'price')::NUMERIC;
            END IF;

            -- Insert line
            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
                VALUES (v_doc_id, v_good.id, (v_line->>'quantity')::NUMERIC,
                        (v_line->>'price')::NUMERIC, NULL);

            -- Increase stock + update avg cost
            UPDATE goods SET
                quantity = quantity + (v_line->>'quantity')::NUMERIC,
                avg_cost = v_new_avg
                WHERE id = v_good.id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('doc_id', v_doc_id, 'doc_num', v_doc_num);
END;
$$ LANGUAGE plpgsql;
```

### `rpc_edit_document`

```sql
CREATE OR REPLACE FUNCTION rpc_edit_document(
    p_doc_id INTEGER,
    p_doc_date DATE,
    p_description TEXT,
    p_contragent_id INTEGER,
    p_lines JSONB  -- [{good_id, quantity, price}, ...]
) RETURNS JSONB AS $$
DECLARE
    v_doc RECORD;
    v_old_line RECORD;
    v_line JSONB;
    v_good RECORD;
    v_new_avg NUMERIC(10,2);
BEGIN
    -- Get existing document
    SELECT * INTO v_doc FROM documents WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found', p_doc_id;
    END IF;

    -- STEP 1: Reverse all old lines
    FOR v_old_line IN SELECT * FROM doc_lines WHERE doc_id = p_doc_id
    LOOP
        SELECT * INTO v_good FROM goods WHERE id = v_old_line.good_id FOR UPDATE;

        IF v_doc.doc_type = 2 THEN
            -- Was outgoing: add stock back
            UPDATE goods SET quantity = quantity + v_old_line.quantity
                WHERE id = v_good.id;
        ELSIF v_doc.doc_type = 1 THEN
            -- Was incoming: subtract stock, recalculate avg_cost
            IF (v_good.quantity - v_old_line.quantity) > 0 THEN
                v_new_avg := (v_good.quantity * v_good.avg_cost -
                             v_old_line.quantity * v_old_line.price) /
                             (v_good.quantity - v_old_line.quantity);
            ELSE
                v_new_avg := 0;
            END IF;
            UPDATE goods SET
                quantity = quantity - v_old_line.quantity,
                avg_cost = v_new_avg
                WHERE id = v_good.id;
        END IF;
    END LOOP;

    -- Delete old lines
    DELETE FROM doc_lines WHERE doc_id = p_doc_id;

    -- Update document header
    UPDATE documents SET
        doc_date = p_doc_date,
        description = p_description,
        contragent_id = p_contragent_id
        WHERE id = p_doc_id;

    -- STEP 2: Apply new lines (same logic as create)
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        SELECT * INTO v_good FROM goods WHERE id = (v_line->>'good_id')::INTEGER FOR UPDATE;

        IF v_doc.doc_type = 2 THEN
            IF v_good.quantity < (v_line->>'quantity')::NUMERIC THEN
                RAISE EXCEPTION 'Not enough stock for "%" (available: %, requested: %)',
                    v_good.name, v_good.quantity, (v_line->>'quantity')::NUMERIC;
            END IF;

            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
                VALUES (p_doc_id, v_good.id, (v_line->>'quantity')::NUMERIC,
                        (v_line->>'price')::NUMERIC, v_good.avg_cost);

            UPDATE goods SET quantity = quantity - (v_line->>'quantity')::NUMERIC
                WHERE id = v_good.id;

        ELSIF v_doc.doc_type = 1 THEN
            IF (v_good.quantity + (v_line->>'quantity')::NUMERIC) > 0 THEN
                v_new_avg := (v_good.quantity * v_good.avg_cost +
                             (v_line->>'quantity')::NUMERIC * (v_line->>'price')::NUMERIC) /
                             (v_good.quantity + (v_line->>'quantity')::NUMERIC);
            ELSE
                v_new_avg := (v_line->>'price')::NUMERIC;
            END IF;

            INSERT INTO doc_lines (doc_id, good_id, quantity, price, cost_at_time)
                VALUES (p_doc_id, v_good.id, (v_line->>'quantity')::NUMERIC,
                        (v_line->>'price')::NUMERIC, NULL);

            UPDATE goods SET
                quantity = quantity + (v_line->>'quantity')::NUMERIC,
                avg_cost = v_new_avg
                WHERE id = v_good.id;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('doc_id', p_doc_id, 'doc_num', v_doc.doc_num);
END;
$$ LANGUAGE plpgsql;
```

### `rpc_delete_document`

```sql
CREATE OR REPLACE FUNCTION rpc_delete_document(
    p_doc_id INTEGER
) RETURNS JSONB AS $$
DECLARE
    v_doc RECORD;
    v_line RECORD;
    v_good RECORD;
    v_new_avg NUMERIC(10,2);
BEGIN
    SELECT * INTO v_doc FROM documents WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document % not found', p_doc_id;
    END IF;

    -- Reverse all lines
    FOR v_line IN SELECT * FROM doc_lines WHERE doc_id = p_doc_id
    LOOP
        SELECT * INTO v_good FROM goods WHERE id = v_line.good_id FOR UPDATE;

        IF v_doc.doc_type = 2 THEN
            -- Was outgoing: add stock back
            UPDATE goods SET quantity = quantity + v_line.quantity
                WHERE id = v_good.id;
        ELSIF v_doc.doc_type = 1 THEN
            -- Was incoming: subtract stock, recalculate avg_cost
            IF (v_good.quantity - v_line.quantity) > 0 THEN
                v_new_avg := (v_good.quantity * v_good.avg_cost -
                             v_line.quantity * v_line.price) /
                             (v_good.quantity - v_line.quantity);
            ELSE
                v_new_avg := 0;
            END IF;
            UPDATE goods SET
                quantity = quantity - v_line.quantity,
                avg_cost = v_new_avg
                WHERE id = v_good.id;
        END IF;
    END LOOP;

    -- Delete lines and document (CASCADE handles lines, but explicit for clarity)
    DELETE FROM doc_lines WHERE doc_id = p_doc_id;
    DELETE FROM documents WHERE id = p_doc_id;

    RETURN jsonb_build_object('deleted', p_doc_id);
END;
$$ LANGUAGE plpgsql;
```

### How API routes call RPCs

```javascript
// api/documents.js — POST handler (create)
const { data, error } = await supabase.rpc('rpc_create_document', {
    p_doc_type: body.doc_type,
    p_doc_date: body.doc_date,
    p_description: body.description,
    p_contragent_id: body.contragent_id,
    p_lines: body.lines  // [{good_id, quantity, price}, ...]
});

// api/documents.js — PUT handler (edit)
const { data, error } = await supabase.rpc('rpc_edit_document', {
    p_doc_id: body.doc_id,
    p_doc_date: body.doc_date,
    p_description: body.description,
    p_contragent_id: body.contragent_id,
    p_lines: body.lines
});

// api/documents.js — DELETE handler
const { data, error } = await supabase.rpc('rpc_delete_document', {
    p_doc_id: body.doc_id
});
```

The API route files are thin wrappers — all business logic lives in Postgres.

---

## Group Nesting

### Structure
```
Parent groups (parent_id = NULL):
├── Myle
│   ├── Myle Mini
│   ├── Meta Bar
│   ├── Meta Box
│   ├── Meta 9000
│   ├── Z20K
│   ├── 18K
│   ├── 25K
│   └── Mini Box
├── Fume
│   ├── Fume Extra
│   ├── Fume Ultra
│   ├── Fume Infinity
│   ├── Fume Mini
│   ├── Fume Recharge
│   ├── Fume Unlimited
│   └── We Fume
├── Random
│   ├── Puff 1600
│   ├── Puff 800
│   ├── Flow
│   ├── Air Bar Max
│   ├── Air Bar Box
│   ├── Air Bar Diamond
│   ├── Elf Bar
│   ├── Mega
│   ├── Blanco
│   ├── Whiff
│   ├── Hyde
│   ├── Stig
│   └── Yami
├── Jul
├── ZVapex
│   └── AVapex 7000
└── YME
```

### UI behavior
- **Goods page group filter**: shows parent groups first, tap to expand children
- **Document form "browse by group"**: same expandable hierarchy
- **Pricing**: set on child groups (leaf nodes where products live). Parent groups are organizational only.
- **Reports by group**: can aggregate at parent or child level

### Pricing rule with nesting
```
Products belong to CHILD groups (leaf nodes).
Pricing (price_in, price_out) is set on the CHILD group.
Parent groups are folders — they organize child groups but don't have pricing.
Customer overrides are always on child groups.
```

---

## Pricing Logic

### When creating an OUTGOING document (sale):
```
1. User selects a customer (contragent)
2. User adds a product to the document
3. Product's group_id → child group
4. Price auto-fills:
   ├─ customer_group_prices(contragent_id, group_id) exists?
   │   └─ YES → use override price_out
   └─ NO → use goods_groups.price_out (child group default)
5. User can manually override the price on any line
6. cost_at_time = good.avg_cost (snapshot for profit calc)
```

### When creating an INCOMING document (purchase):
```
1. User adds a product
2. Price auto-fills from goods_groups.price_in (child group default)
3. User can manually override the price on any line
```

### Inline price override saving:
```
On document save, for each line in OUTGOING docs:
  - Compare line price vs child group default price_out
  - If different AND no existing customer_group_price:
    → Prompt: "Save $X as default price for [Customer] + [Group]?"
    → If yes: INSERT into customer_group_prices
  - If different AND existing customer_group_price differs:
    → Prompt: "Update default price for [Customer] + [Group] to $X?"
    → If yes: UPDATE customer_group_prices
```

---

## Weighted Average Cost Logic

Handled atomically inside Postgres RPC functions (see above).

### On INCOMING document save:
```
For each doc_line:
    old_qty   = good.quantity
    old_cost  = good.avg_cost
    new_qty   = doc_line.quantity
    new_price = doc_line.price

    IF (old_qty + new_qty) > 0:
        new_avg_cost = (old_qty * old_cost + new_qty * new_price) / (old_qty + new_qty)
    ELSE:
        new_avg_cost = new_price

    UPDATE good: avg_cost = new_avg_cost, quantity = old_qty + new_qty
```

### On OUTGOING document save:
```
For each doc_line:
    BLOCK if good.quantity < doc_line.quantity
    doc_line.cost_at_time = good.avg_cost (snapshot)
    good.quantity -= doc_line.quantity
    avg_cost does NOT change on sales
```

---

## Stock Validation

```
On outgoing doc save/edit:
  For each line:
    available = good.quantity
    (if editing: available += old_line.quantity for same good — give back old qty first)
    IF line.quantity > available:
        BLOCK with error: "[Product] only has [available] in stock"
```

Enforced inside the Postgres RPC function — impossible to bypass from the client.

---

## Reports

### 1. Profit Report (date range)
```sql
SELECT
    SUM(dl.price * dl.quantity) as revenue,
    SUM(dl.cost_at_time * dl.quantity) as cost,
    SUM((dl.price - dl.cost_at_time) * dl.quantity) as profit,
    ROUND(SUM((dl.price - dl.cost_at_time) * dl.quantity) /
          NULLIF(SUM(dl.price * dl.quantity), 0) * 100, 1) as margin_pct
FROM doc_lines dl
JOIN documents d ON dl.doc_id = d.id
WHERE d.doc_type = 2
  AND d.doc_date BETWEEN :start AND :end
```

### 2. Profit by Customer
```sql
-- Same as above, GROUP BY d.contragent_id
-- Show: customer name, revenue, cost, profit, margin %
```

### 3. Profit by Product Group
```sql
-- Same as above, JOIN goods → goods_groups, GROUP BY group
-- Show: group name, revenue, cost, profit, margin %
```

### 4. Current Inventory Value
```sql
SELECT
    gg.name as group_name,
    SUM(g.quantity) as total_qty,
    SUM(g.avg_cost * g.quantity) as total_value
FROM goods g
JOIN goods_groups gg ON g.group_id = gg.id
WHERE g.quantity > 0
GROUP BY gg.id, gg.name
-- Grand total at bottom
```

---

## App Pages (Mobile-First, iPhone 17 Pro)

### 📱 Home Dashboard (`/index.html`)
```
┌─────────────────────────┐
│    Inventory App    [🔒] │
├─────────────────────────┤
│  Today's Sales    $1,240 │
│  Inventory Value $14,500 │
│  Total Products      319 │
├─────────────────────────┤
│ ┌──────────┐┌──────────┐│
│ │  📦       ││  📋       ││
│ │  Goods    ││  Documents││
│ └──────────┘└──────────┘│
│ ┌──────────┐┌──────────┐│
│ │  📥       ││  📤       ││
│ │  New      ││  New      ││
│ │  Incoming ││  Outgoing ││
│ └──────────┘└──────────┘│
│ ┌──────────┐┌──────────┐│
│ │  👥       ││  📊       ││
│ │Contragents││  Reports  ││
│ └──────────┘└──────────┘│
└─────────────────────────┘
```

### 📱 Goods (`/goods.html`)
```
┌─────────────────────────┐
│ ← Goods                 │
├─────────────────────────┤
│ 🔍 Search products...   │
│ [All Groups ▼]          │ ← expandable: parent → children
├─────────────────────────┤
│ Strawberry Mango Ice    │
│ Myle > Myle Mini · q:24 │
│ avg cost: $6.00         │
├─────────────────────────┤
│ ...                     │
│                    [+ Add] │
└─────────────────────────┘
```
Tap product → detail page with edit form + transaction history

### 📱 Documents (`/documents.html`)
```
┌─────────────────────────┐
│ ← Documents             │
├─────────────────────────┤
│ [All ▼] [Date range 📅] │
├─────────────────────────┤
│ 📤 OUT-042  Jan 15      │
│ Customer: Jul C #1      │
│ Total: $330             │
├─────────────────────────┤
│ 📥 IN-008   Jan 14      │
│ Supplier: Main Supply   │
│ Total: $1,200           │
├─────────────────────────┤
│ ...                     │
└─────────────────────────┘
```
Sorted newest first. Filter by incoming/outgoing.

### 📱 Document Form (`/document-form.html?type=1|2`)
```
┌─────────────────────────┐
│ ← New Outgoing  OUT-043 │
├─────────────────────────┤
│ Date:     [2026-01-16]  │
│ Customer: [Search... ▼] │
├─────────────────────────┤
│ + Add Product            │  ← opens modal: search OR browse group tree
│ ┌───────────────────────┐│
│ │ Strawberry Mango Ice  ││
│ │ Qty: [2]  Price:[$110]││
│ │ Line total: $220  [🗑]││
│ └───────────────────────┘│
│ ┌───────────────────────┐│
│ │ Lychee Ice            ││
│ │ Qty: [1]  Price:[$110]││
│ │ Line total: $110  [🗑]││
│ └───────────────────────┘│
├─────────────────────────┤
│ Document Total:    $330  │
│                          │
│     [ 💾 Save ]          │
└─────────────────────────┘
```

### 📱 Contragents (`/contragents.html`)
```
┌─────────────────────────┐
│ ← Contragents           │
├─────────────────────────┤
│ 🔍 Search...            │
│ [Customers ▼]           │
├─────────────────────────┤
│ Jul C #1                │
│ Customer · 555-0123     │
├─────────────────────────┤
│ ...                     │
│                    [+ Add] │
└─────────────────────────┘
```
Tap → detail page with edit form + price overrides + transaction history

### 📱 Reports (`/reports.html`)
```
┌─────────────────────────┐
│ ← Reports               │
├─────────────────────────┤
│ Date: [Jan 1] → [Jan 31]│
├─────────────────────────┤
│ PROFIT SUMMARY           │
│ Revenue:      $12,400    │
│ Cost:          $7,800    │
│ Profit:        $4,600    │
│ Margin:        37.1%     │
├─────────────────────────┤
│ [By Customer] [By Group] │
│ [Inventory Value]        │
├─────────────────────────┤
│ (detail table below)     │
└─────────────────────────┘
```

---

## API Routes (Vercel Node.js Serverless)

```
POST   /api/auth.js              Verify PIN

GET    /api/goods.js             List/search goods (query: search, group_id)
POST   /api/goods.js             Create good
PUT    /api/goods.js             Update good
DELETE /api/goods.js             Delete good

GET    /api/goods-groups.js      List all groups (returns nested tree)
POST   /api/goods-groups.js      Create group
PUT    /api/goods-groups.js      Update group
DELETE /api/goods-groups.js      Delete group

GET    /api/contragents.js       List/search (query: search, type)
POST   /api/contragents.js       Create
PUT    /api/contragents.js       Update
DELETE /api/contragents.js       Delete

GET    /api/documents.js         List/filter (query: type, date_from, date_to, contragent_id, good_id)
POST   /api/documents.js         Create → calls supabase.rpc('rpc_create_document')
PUT    /api/documents.js         Edit → calls supabase.rpc('rpc_edit_document')
DELETE /api/documents.js         Delete → calls supabase.rpc('rpc_delete_document')

GET    /api/customer-prices.js   Get overrides for a contragent
POST   /api/customer-prices.js   Create/update override

GET    /api/price-lookup.js      Get price for contragent_id + good_id

GET    /api/reports.js           Reports (query: type, date_from, date_to)

GET    /api/dashboard.js         Home screen stats
```

Document create/edit/delete routes are thin wrappers — all logic is in Postgres RPCs.

---

## Project Structure

```
inventory-app/
├── api/
│   ├── _db.js                      # Shared: init Supabase client from env vars
│   ├── auth.js
│   ├── goods.js
│   ├── goods-groups.js
│   ├── contragents.js
│   ├── documents.js                # Thin wrapper → RPCs
│   ├── customer-prices.js
│   ├── price-lookup.js
│   ├── reports.js
│   └── dashboard.js
├── public/
│   ├── index.html
│   ├── goods.html
│   ├── good-form.html
│   ├── documents.html
│   ├── document-form.html
│   ├── contragents.html
│   ├── contragent-form.html
│   ├── reports.html
│   ├── login.html
│   ├── css/
│   │   └── style.css               # iPhone 17 Pro, light theme
│   ├── js/
│   │   ├── app.js                  # Shared: API client, auth check, utilities
│   │   ├── home.js
│   │   ├── goods.js
│   │   ├── good-form.js
│   │   ├── documents.js
│   │   ├── document-form.js
│   │   ├── contragents.js
│   │   ├── contragent-form.js
│   │   └── reports.js
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
│       ├── icon-192.png
│       └── icon-512.png
├── supabase/
│   ├── schema.sql                  # All CREATE TABLE statements
│   └── rpc.sql                     # All RPC functions
├── scripts/
│   └── migrate.js                  # One-time migration (Main Store only)
├── package.json
└── vercel.json
```

---

## Dependencies

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2"
  },
  "devDependencies": {
    "better-sqlite3": "^11"
  }
}
```

Frontend: zero npm packages. Vanilla JS with `fetch()`.

---

## Migration Plan (Main Store Only)

Only data from Main Store (store_id = -2) is migrated. Other stores (Mordechai, Fume Not Orjoy, Monsey) are excluded.

| Source | Destination | Records | Notes |
|--------|-------------|---------|-------|
| tovar_groups | goods_groups | 39 | Preserve hierarchy: `_id_id` → `parent_id` (map -1 to NULL) |
| tovars | goods | 319 | Map group_id, recalculate avg_cost from doc history |
| contragents | contragents | 1,152 | Map cont_type: 1→customer, 0→supplier, -1→decide |
| documents (store_id=-2, type 1,2) | documents | 7,154 | Main Store only, generate IN-/OUT- numbers |
| doc_lines (for migrated docs only) | doc_lines | ~11,330 | Preserve prices, calculate cost_at_time |
| stock (store_id=-2) | goods.quantity | 319 | Main Store stock only |
| — | customer_group_prices | TBD | Extract from historical pricing patterns |
| — | app_settings | 1 | Set initial PIN + next doc numbers |

### Migration script flow:
```
1. Read old SQLite DB (Main Store filter: store_id = -2)
2. Insert goods_groups with parent_id hierarchy
3. Insert goods (barcode, name, group_id, measure)
4. Insert contragents (map type field)
5. Insert documents + doc_lines in chronological order
   → Replay avg_cost calculation as docs are inserted
   → This gives accurate avg_cost on each good
6. Set goods.quantity from stock table (store_id = -2)
7. Set app_settings.next_in_num / next_out_num to max + 1
```

---

## Deployment Steps

1. Create Supabase project (free) → copy URL + service role key
2. Run `supabase/schema.sql` in Supabase SQL editor (creates 7 tables)
3. Run `supabase/rpc.sql` in Supabase SQL editor (creates 3 RPC functions)
4. Clone repo locally, `npm install`
5. Set env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
6. Run `node scripts/migrate.js` to import existing data (Main Store only)
7. Push to GitHub
8. Connect repo to Vercel (free) → set same env vars
9. Auto-deploys on every push
10. Open on iPhone Safari → Share → Add to Home Screen
11. Done — app lives at `https://your-app.vercel.app`

---

## Key Business Rules Summary

| Rule | Detail |
|------|--------|
| **Atomic transactions** | All doc create/edit/delete via Postgres RPC — no partial updates possible |
| **Doc numbers** | Auto-increment inside RPC transaction — no race conditions |
| **Stock on save** | Incoming adds qty + recalculates avg cost. Outgoing subtracts qty. |
| **Block oversell** | Enforced in Postgres RPC — cannot save if any line exceeds stock |
| **Avg cost update** | Only on incoming. Weighted average. Never changes on outgoing. |
| **Cost snapshot** | Each outgoing line saves `cost_at_time` for profit calculation |
| **Price hierarchy** | Customer+Group override → Group default → manual edit always allowed |
| **Price override save** | On outgoing save, if price ≠ default, prompt to save as override |
| **Edit doc** | Atomic: reverse all old stock/cost → apply all new stock/cost |
| **Delete doc** | Atomic: reverse all stock/cost → delete records |
| **Group nesting** | Parent → Child hierarchy. Pricing on child groups only. |
| **Contragent types** | Strict: suppliers (type=0) for incoming, customers (type=1) for outgoing |
| **Auth** | Simple PIN entry on app open. No user accounts. |
| **Migration** | Main Store (store_id=-2) only. Other stores excluded. |
