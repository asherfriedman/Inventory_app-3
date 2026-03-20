/*  local-db.js  —  Offline SQLite backend for Inventory App v3
 *  Replaces Supabase: all /api/* calls are handled locally via sql.js + OPFS.
 */
(function () {
  "use strict";

  let db = null;
  let saveTimer = null;
  const OPFS_FILENAME = "inventory.db";

  // ── helpers ──────────────────────────────────────────────────────────
  function toInt(v, fb) { if (v == null || v === "") return fb ?? null; const n = parseInt(v, 10); return Number.isFinite(n) ? n : (fb ?? null); }
  function toNum(v, fb) { if (v == null || v === "") return fb ?? 0; const n = Number(v); return Number.isFinite(n) ? n : (fb ?? 0); }
  function round2(n) { return Number((Number(n) || 0).toFixed(2)); }

  function query(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function run(sql, params) {
    db.run(sql, params);
  }

  function single(sql, params) {
    const rows = query(sql, params);
    return rows.length ? rows[0] : null;
  }

  function count(sql, params) {
    const row = single(sql, params);
    if (!row) return 0;
    const keys = Object.keys(row);
    return Number(row[keys[0]] || 0);
  }

  function lastId() {
    return single("SELECT last_insert_rowid() as id").id;
  }

  // ── SHA-256 via Web Crypto ───────────────────────────────────────────
  async function sha256(text) {
    const data = new TextEncoder().encode(String(text));
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // ── OPFS persistence ────────────────────────────────────────────────
  async function saveToOPFS() {
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(OPFS_FILENAME, { create: true });
      const writable = await fh.createWritable();
      await writable.write(db.export());
      await writable.close();
    } catch (e) {
      console.error("OPFS save failed:", e);
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveToOPFS(); }, 300);
  }

  async function loadFromOPFS() {
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(OPFS_FILENAME);
      const file = await fh.getFile();
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return null; // file doesn't exist yet
    }
  }

  // ── schema DDL (SQLite) ──────────────────────────────────────────────
  const SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS app_settings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      pin_hash      TEXT,
      next_in_num   INTEGER DEFAULT 1,
      next_out_num  INTEGER DEFAULT 1,
      failed_attempts INTEGER DEFAULT 0,
      lockout_until TEXT
    );

    CREATE TABLE IF NOT EXISTS goods_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id  INTEGER REFERENCES goods_groups(id) ON DELETE SET NULL,
      name       TEXT NOT NULL,
      price_in   REAL DEFAULT 0,
      price_out  REAL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS goods (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode    TEXT,
      name       TEXT NOT NULL,
      group_id   INTEGER REFERENCES goods_groups(id),
      avg_cost   REAL DEFAULT 0,
      quantity   REAL DEFAULT 0,
      measure    TEXT
    );

    CREATE TABLE IF NOT EXISTS contragents (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      phone     TEXT,
      email     TEXT,
      address   TEXT,
      type      INTEGER NOT NULL,
      notes     TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_group_prices (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      contragent_id  INTEGER REFERENCES contragents(id) ON DELETE CASCADE,
      group_id       INTEGER REFERENCES goods_groups(id) ON DELETE CASCADE,
      price_out      REAL,
      UNIQUE (contragent_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type      INTEGER NOT NULL,
      doc_date      TEXT NOT NULL,
      doc_num       TEXT NOT NULL,
      description   TEXT,
      contragent_id INTEGER REFERENCES contragents(id),
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS doc_lines (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id       INTEGER REFERENCES documents(id) ON DELETE CASCADE,
      good_id      INTEGER REFERENCES goods(id),
      quantity     REAL NOT NULL,
      price        REAL NOT NULL,
      cost_at_time REAL
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

    INSERT OR IGNORE INTO app_settings (id, pin_hash, next_in_num, next_out_num, failed_attempts)
    VALUES (1, NULL, 1, 1, 0);
  `;

  // ── init ─────────────────────────────────────────────────────────────
  async function init() {
    const SQL = await initSqlJs({
      locateFile: (file) => `/lib/${file}`
    });

    const existing = await loadFromOPFS();
    if (existing) {
      db = new SQL.Database(existing);
      // ensure any new columns/tables exist
      db.run(SCHEMA_DDL);
    } else {
      db = new SQL.Database();
      db.run(SCHEMA_DDL);
      await saveToOPFS();
    }

    // request persistent storage
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  }

  // ── group helpers ────────────────────────────────────────────────────
  function buildGroupTree(groups) {
    const byId = new Map();
    const roots = [];
    for (const g of groups) byId.set(g.id, { ...g, children: [] });
    for (const g of byId.values()) {
      if (g.parent_id && byId.has(g.parent_id)) byId.get(g.parent_id).children.push(g);
      else roots.push(g);
    }
    const sortFn = (a, b) => String(a.name).localeCompare(String(b.name));
    const sortTree = (nodes) => { nodes.sort(sortFn); nodes.forEach(n => sortTree(n.children)); };
    sortTree(roots);
    return { tree: roots, byId };
  }

  function fetchAllGroups() {
    const rows = query("SELECT id, parent_id, name, price_in, price_out, is_active FROM goods_groups ORDER BY name");
    return rows.map(r => ({ ...r, is_active: Boolean(r.is_active) }));
  }

  function fetchGroupMeta() {
    return buildGroupTree(fetchAllGroups());
  }

  function buildGroupPath(groupId, byId) {
    if (!groupId || !byId.has(groupId)) return "";
    const names = [];
    let cur = byId.get(groupId);
    while (cur) {
      names.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
    }
    return names.join(" > ");
  }

  // ── goods / contragent map helpers ───────────────────────────────────
  function fetchGoodsMap(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return new Map();
    const ph = unique.map(() => "?").join(",");
    const rows = query(`SELECT id,name,group_id,avg_cost,quantity,barcode,measure FROM goods WHERE id IN (${ph})`, unique);
    return new Map(rows.map(r => [r.id, r]));
  }

  function fetchContragentMap(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) return new Map();
    const ph = unique.map(() => "?").join(",");
    const rows = query(`SELECT id,name,type,phone FROM contragents WHERE id IN (${ph})`, unique);
    return new Map(rows.map(r => [r.id, r]));
  }

  function normalizeLines(lines) {
    if (!Array.isArray(lines)) return [];
    return lines
      .map(l => ({ good_id: toInt(l.good_id), quantity: toNum(l.quantity), price: toNum(l.price) }))
      .filter(l => l.good_id && l.quantity > 0);
  }

  function docTotal(lines) {
    return (lines || []).reduce((s, l) => s + toNum(l.quantity) * toNum(l.price), 0);
  }

  // ── RPC: create document ─────────────────────────────────────────────
  function rpcCreateDocument(docType, docDate, description, contragentId, lines) {
    run("BEGIN");
    try {
      if (![1, 2].includes(docType)) throw new Error("Invalid doc_type");
      if (!lines.length) throw new Error("At least one line is required");

      let docNum;
      if (docType === 1) {
        const s = single("SELECT next_in_num FROM app_settings WHERE id=1");
        docNum = "IN-" + String(s.next_in_num).padStart(3, "0");
        run("UPDATE app_settings SET next_in_num = next_in_num + 1 WHERE id=1");
      } else {
        const s = single("SELECT next_out_num FROM app_settings WHERE id=1");
        docNum = "OUT-" + String(s.next_out_num).padStart(3, "0");
        run("UPDATE app_settings SET next_out_num = next_out_num + 1 WHERE id=1");
      }

      run(
        "INSERT INTO documents (doc_type, doc_date, doc_num, description, contragent_id) VALUES (?,?,?,?,?)",
        [docType, docDate, docNum, description || null, contragentId || null]
      );
      const docId = lastId();

      for (const line of lines) {
        const good = single("SELECT * FROM goods WHERE id=?", [line.good_id]);
        if (!good) throw new Error(`Good ${line.good_id} not found`);
        if (line.quantity <= 0) throw new Error("Line quantity must be > 0");

        if (docType === 2) {
          if (good.quantity < line.quantity) {
            throw new Error(`Not enough stock for "${good.name}" (available: ${good.quantity}, requested: ${line.quantity})`);
          }
          run("INSERT INTO doc_lines (doc_id,good_id,quantity,price,cost_at_time) VALUES(?,?,?,?,?)",
            [docId, good.id, line.quantity, line.price, good.avg_cost]);
          run("UPDATE goods SET quantity = quantity - ? WHERE id=?", [line.quantity, good.id]);
        } else {
          const newQty = good.quantity + line.quantity;
          const newAvg = newQty > 0
            ? (good.quantity * good.avg_cost + line.quantity * line.price) / newQty
            : line.price;
          run("INSERT INTO doc_lines (doc_id,good_id,quantity,price,cost_at_time) VALUES(?,?,?,?,NULL)",
            [docId, good.id, line.quantity, line.price]);
          run("UPDATE goods SET quantity = quantity + ?, avg_cost = ? WHERE id=?",
            [line.quantity, round2(newAvg), good.id]);
        }
      }
      run("COMMIT");
      scheduleSave();
      return { doc_id: docId, doc_num: docNum };
    } catch (e) {
      run("ROLLBACK");
      throw e;
    }
  }

  // ── RPC: edit document ───────────────────────────────────────────────
  function rpcEditDocument(docId, docDate, description, contragentId, lines) {
    run("BEGIN");
    try {
      const doc = single("SELECT * FROM documents WHERE id=?", [docId]);
      if (!doc) throw new Error("Document " + docId + " not found");

      // reverse old lines
      const oldLines = query("SELECT * FROM doc_lines WHERE doc_id=? ORDER BY id", [docId]);
      for (const ol of oldLines) {
        const good = single("SELECT * FROM goods WHERE id=?", [ol.good_id]);
        if (!good) continue;
        if (doc.doc_type === 2) {
          run("UPDATE goods SET quantity = quantity + ? WHERE id=?", [ol.quantity, good.id]);
        } else if (doc.doc_type === 1) {
          const remain = good.quantity - ol.quantity;
          const newAvg = remain > 0
            ? (good.quantity * good.avg_cost - ol.quantity * ol.price) / remain
            : 0;
          run("UPDATE goods SET quantity = quantity - ?, avg_cost = ? WHERE id=?",
            [ol.quantity, round2(newAvg), good.id]);
        }
      }

      run("DELETE FROM doc_lines WHERE doc_id=?", [docId]);
      run("UPDATE documents SET doc_date=?, description=?, contragent_id=? WHERE id=?",
        [docDate, description || null, contragentId || null, docId]);

      // apply new lines
      for (const line of lines) {
        const good = single("SELECT * FROM goods WHERE id=?", [line.good_id]);
        if (!good) throw new Error("Good " + line.good_id + " not found");

        if (doc.doc_type === 2) {
          if (good.quantity < line.quantity) {
            throw new Error(`Not enough stock for "${good.name}" (available: ${good.quantity}, requested: ${line.quantity})`);
          }
          run("INSERT INTO doc_lines (doc_id,good_id,quantity,price,cost_at_time) VALUES(?,?,?,?,?)",
            [docId, good.id, line.quantity, line.price, good.avg_cost]);
          run("UPDATE goods SET quantity = quantity - ? WHERE id=?", [line.quantity, good.id]);
        } else if (doc.doc_type === 1) {
          const newQty = good.quantity + line.quantity;
          const newAvg = newQty > 0
            ? (good.quantity * good.avg_cost + line.quantity * line.price) / newQty
            : line.price;
          run("INSERT INTO doc_lines (doc_id,good_id,quantity,price,cost_at_time) VALUES(?,?,?,?,NULL)",
            [docId, good.id, line.quantity, line.price]);
          run("UPDATE goods SET quantity = quantity + ?, avg_cost = ? WHERE id=?",
            [line.quantity, round2(newAvg), good.id]);
        }
      }

      run("COMMIT");
      scheduleSave();
      return { doc_id: docId, doc_num: doc.doc_num };
    } catch (e) {
      run("ROLLBACK");
      throw e;
    }
  }

  // ── RPC: delete document ─────────────────────────────────────────────
  function rpcDeleteDocument(docId) {
    run("BEGIN");
    try {
      const doc = single("SELECT * FROM documents WHERE id=?", [docId]);
      if (!doc) throw new Error("Document " + docId + " not found");

      const lines = query("SELECT * FROM doc_lines WHERE doc_id=? ORDER BY id", [docId]);
      for (const line of lines) {
        const good = single("SELECT * FROM goods WHERE id=?", [line.good_id]);
        if (!good) continue;
        if (doc.doc_type === 2) {
          run("UPDATE goods SET quantity = quantity + ? WHERE id=?", [line.quantity, good.id]);
        } else if (doc.doc_type === 1) {
          const remain = good.quantity - line.quantity;
          const newAvg = remain > 0
            ? (good.quantity * good.avg_cost - line.quantity * line.price) / remain
            : 0;
          run("UPDATE goods SET quantity = quantity - ?, avg_cost = ? WHERE id=?",
            [line.quantity, round2(newAvg), good.id]);
        }
      }

      run("DELETE FROM doc_lines WHERE doc_id=?", [docId]);
      run("DELETE FROM documents WHERE id=?", [docId]);
      run("COMMIT");
      scheduleSave();
      return { deleted: docId };
    } catch (e) {
      run("ROLLBACK");
      throw e;
    }
  }

  // ── document detail loader ───────────────────────────────────────────
  function loadDocumentDetail(docId) {
    const doc = single("SELECT * FROM documents WHERE id=?", [docId]);
    if (!doc) return null;
    const lines = query(
      "SELECT id,doc_id,good_id,quantity,price,cost_at_time FROM doc_lines WHERE doc_id=? ORDER BY id",
      [docId]
    );
    const goodsMap = fetchGoodsMap(lines.map(l => l.good_id));
    const cMap = fetchContragentMap([doc.contragent_id]);
    const enrichedLines = lines.map(l => ({ ...l, good: goodsMap.get(l.good_id) || null }));
    return {
      ...doc,
      contragent: cMap.get(doc.contragent_id) || null,
      lines: enrichedLines,
      total: round2(docTotal(enrichedLines))
    };
  }

  // ── HANDLERS ─────────────────────────────────────────────────────────

  // /api/auth
  async function handleAuth(method, params, body) {
    const MAX_FAILED = 5;
    const LOCKOUT_MIN = 15;

    if (method === "GET") {
      const s = single("SELECT pin_hash FROM app_settings WHERE id=1");
      return { configured: Boolean(s?.pin_hash) };
    }
    if (method === "DELETE") {
      return { ok: true };
    }
    // POST
    const pin = String(body.pin || "").trim();
    const setup = Boolean(body.setup);
    if (!pin) throw new Error("PIN is required");
    if (pin.length < 4) throw new Error("PIN must be at least 4 digits");

    const settings = single("SELECT * FROM app_settings WHERE id=1");
    if (settings.lockout_until && new Date(settings.lockout_until) > new Date()) {
      const mins = Math.ceil((new Date(settings.lockout_until) - new Date()) / 60000);
      throw new Error(`Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
    }

    if (!settings.pin_hash) {
      if (!setup) return { ok: false, setup_required: true };
      const hash = await sha256(pin);
      run("UPDATE app_settings SET pin_hash=?, failed_attempts=0, lockout_until=NULL WHERE id=1", [hash]);
      scheduleSave();
      return { ok: true, setup_complete: true, token: "local", expires_at: null };
    }

    const hash = await sha256(pin);
    if (settings.pin_hash !== hash) {
      const attempts = (settings.failed_attempts || 0) + 1;
      if (attempts >= MAX_FAILED) {
        const until = new Date(Date.now() + LOCKOUT_MIN * 60 * 1000).toISOString();
        run("UPDATE app_settings SET failed_attempts=?, lockout_until=? WHERE id=1", [attempts, until]);
      } else {
        run("UPDATE app_settings SET failed_attempts=? WHERE id=1", [attempts]);
      }
      scheduleSave();
      return { ok: false };
    }

    run("UPDATE app_settings SET failed_attempts=0, lockout_until=NULL WHERE id=1");
    scheduleSave();
    return { ok: true, token: "local", expires_at: null };
  }

  // /api/goods-groups
  function handleGoodsGroups(method, params, body) {
    if (method === "GET") {
      const groups = fetchAllGroups();
      const { tree, byId } = buildGroupTree(groups);
      const flat = Array.from(byId.values()).map(({ children, ...rest }) => rest);
      return { groups: flat, tree };
    }
    if (method === "POST") {
      if (!body.name || !String(body.name).trim()) throw new Error("Group name is required");
      run(
        "INSERT INTO goods_groups (name, parent_id, price_in, price_out, is_active) VALUES(?,?,?,?,?)",
        [String(body.name).trim(), toInt(body.parent_id, null), toNum(body.price_in, 0), toNum(body.price_out, 0),
         body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1]
      );
      const id = lastId();
      scheduleSave();
      return { group: single("SELECT * FROM goods_groups WHERE id=?", [id]) };
    }
    if (method === "PUT") {
      const id = toInt(body.id);
      if (!id) throw new Error("id is required");
      const sets = []; const vals = [];
      if (body.name != null) { sets.push("name=?"); vals.push(String(body.name).trim()); }
      if (body.parent_id !== undefined) { sets.push("parent_id=?"); vals.push(toInt(body.parent_id, null)); }
      if (body.price_in !== undefined) { sets.push("price_in=?"); vals.push(toNum(body.price_in, 0)); }
      if (body.price_out !== undefined) { sets.push("price_out=?"); vals.push(toNum(body.price_out, 0)); }
      if (body.is_active !== undefined) { sets.push("is_active=?"); vals.push(body.is_active ? 1 : 0); }
      if (sets.length) {
        vals.push(id);
        run(`UPDATE goods_groups SET ${sets.join(",")} WHERE id=?`, vals);
        scheduleSave();
      }
      const row = single("SELECT * FROM goods_groups WHERE id=?", [id]);
      return { group: row };
    }
    if (method === "DELETE") {
      const id = toInt(params.id) || toInt(body.id);
      if (!id) throw new Error("id is required");
      if (count("SELECT count(*) FROM goods_groups WHERE parent_id=?", [id]) > 0) {
        throw new Error("Delete child groups first");
      }
      if (count("SELECT count(*) FROM goods WHERE group_id=?", [id]) > 0) {
        throw new Error("Delete or move goods in this group first");
      }
      run("DELETE FROM goods_groups WHERE id=?", [id]);
      scheduleSave();
      return { deleted: id };
    }
  }

  // /api/goods
  function handleGoods(method, params, body) {
    if (method === "GET") {
      const id = toInt(params.id);
      if (id) {
        return { good: single("SELECT * FROM goods WHERE id=?", [id]) };
      }
      const groupId = toInt(params.group_id);
      let sql = "SELECT id,barcode,name,group_id,avg_cost,quantity,measure FROM goods";
      const where = []; const vals = [];
      if (groupId) { where.push("group_id=?"); vals.push(groupId); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY name LIMIT 1000";
      const rows = query(sql, vals);
      const { byId } = fetchGroupMeta();
      const goods = rows.map(item => ({
        ...item,
        group: byId.get(item.group_id) ? (({ children, ...r }) => r)(byId.get(item.group_id)) : null,
        group_path: buildGroupPath(item.group_id, byId)
      }));
      return { goods };
    }
    if (method === "POST") {
      if (!body.name || !String(body.name).trim()) throw new Error("Product name is required");
      run(
        "INSERT INTO goods (barcode,name,group_id,avg_cost,quantity,measure) VALUES(?,?,?,?,?,?)",
        [body.barcode ? String(body.barcode).trim() : null, String(body.name).trim(),
         toInt(body.group_id, null), toNum(body.avg_cost, 0), toNum(body.quantity, 0),
         body.measure ? String(body.measure).trim() : null]
      );
      const id = lastId();
      scheduleSave();
      return { good: single("SELECT * FROM goods WHERE id=?", [id]) };
    }
    if (method === "PUT") {
      const id = toInt(body.id);
      if (!id) throw new Error("id is required");
      const sets = []; const vals = [];
      if (body.barcode !== undefined) { sets.push("barcode=?"); vals.push(body.barcode ? String(body.barcode).trim() : null); }
      if (body.name !== undefined) { sets.push("name=?"); vals.push(String(body.name).trim()); }
      if (body.group_id !== undefined) { sets.push("group_id=?"); vals.push(toInt(body.group_id, null)); }
      if (body.avg_cost !== undefined) { sets.push("avg_cost=?"); vals.push(toNum(body.avg_cost, 0)); }
      if (body.quantity !== undefined) { sets.push("quantity=?"); vals.push(toNum(body.quantity, 0)); }
      if (body.measure !== undefined) { sets.push("measure=?"); vals.push(body.measure ? String(body.measure).trim() : null); }
      if (sets.length) {
        vals.push(id);
        run(`UPDATE goods SET ${sets.join(",")} WHERE id=?`, vals);
        scheduleSave();
      }
      return { good: single("SELECT * FROM goods WHERE id=?", [id]) };
    }
    if (method === "DELETE") {
      const id = toInt(params.id) || toInt(body.id);
      if (!id) throw new Error("id is required");
      if (count("SELECT count(*) FROM doc_lines WHERE good_id=?", [id]) > 0) {
        throw new Error("Cannot delete product with document history");
      }
      run("DELETE FROM goods WHERE id=?", [id]);
      scheduleSave();
      return { deleted: id };
    }
  }

  // /api/contragents
  function handleContragents(method, params, body) {
    if (method === "GET") {
      const id = toInt(params.id);
      if (id) {
        return { contragent: single("SELECT * FROM contragents WHERE id=?", [id]) };
      }
      const type = params.type;
      const search = params.search;
      let sql = "SELECT id,name,phone,email,address,type,notes FROM contragents";
      const where = []; const vals = [];
      if (type !== undefined && type !== null && type !== "") { where.push("type=?"); vals.push(toInt(type, 0)); }
      if (search) { where.push("name LIKE ? COLLATE NOCASE"); vals.push("%" + search.replace(/[%_]/g, "\\$&") + "%"); }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY name LIMIT 2000";
      return { contragents: query(sql, vals) };
    }
    if (method === "POST") {
      if (!body.name || !String(body.name).trim()) throw new Error("Name is required");
      run(
        "INSERT INTO contragents (name,phone,email,address,type,notes) VALUES(?,?,?,?,?,?)",
        [String(body.name).trim(), body.phone ? String(body.phone).trim() : null,
         body.email ? String(body.email).trim() : null, body.address ? String(body.address).trim() : null,
         toInt(body.type, 1), body.notes ? String(body.notes).trim() : null]
      );
      const id = lastId();
      scheduleSave();
      return { contragent: single("SELECT * FROM contragents WHERE id=?", [id]) };
    }
    if (method === "PUT") {
      const id = toInt(body.id);
      if (!id) throw new Error("id is required");
      const sets = []; const vals = [];
      if (body.name !== undefined) { sets.push("name=?"); vals.push(String(body.name).trim()); }
      if (body.phone !== undefined) { sets.push("phone=?"); vals.push(body.phone ? String(body.phone).trim() : null); }
      if (body.email !== undefined) { sets.push("email=?"); vals.push(body.email ? String(body.email).trim() : null); }
      if (body.address !== undefined) { sets.push("address=?"); vals.push(body.address ? String(body.address).trim() : null); }
      if (body.type !== undefined) { sets.push("type=?"); vals.push(toInt(body.type, 1)); }
      if (body.notes !== undefined) { sets.push("notes=?"); vals.push(body.notes ? String(body.notes).trim() : null); }
      if (sets.length) {
        vals.push(id);
        run(`UPDATE contragents SET ${sets.join(",")} WHERE id=?`, vals);
        scheduleSave();
      }
      return { contragent: single("SELECT * FROM contragents WHERE id=?", [id]) };
    }
    if (method === "DELETE") {
      const id = toInt(params.id) || toInt(body.id);
      if (!id) throw new Error("id is required");
      if (count("SELECT count(*) FROM documents WHERE contragent_id=?", [id]) > 0) {
        throw new Error("Cannot delete contragent with document history");
      }
      run("DELETE FROM contragents WHERE id=?", [id]);
      scheduleSave();
      return { deleted: id };
    }
  }

  // /api/documents
  function handleDocuments(method, params, body) {
    if (method === "GET") {
      const docId = toInt(params.id);
      if (docId) {
        const document = loadDocumentDetail(docId);
        if (!document) throw new Error("Document not found");
        return { document };
      }
      // list
      const type = toInt(params.type);
      const dateFrom = params.date_from || null;
      const dateTo = params.date_to || null;
      const contragentId = toInt(params.contragent_id);
      const goodId = toInt(params.good_id);
      const limit = Math.min(Math.max(toInt(params.limit, 200), 1), 1000);

      let allowedDocIds = null;
      if (goodId) {
        const rows = query("SELECT DISTINCT doc_id FROM doc_lines WHERE good_id=?", [goodId]);
        allowedDocIds = rows.map(r => r.doc_id);
        if (!allowedDocIds.length) return { documents: [] };
      }

      let sql = "SELECT id,doc_type,doc_date,doc_num,description,contragent_id,created_at FROM documents";
      const where = []; const vals = [];
      if (type) { where.push("doc_type=?"); vals.push(type); }
      if (dateFrom) { where.push("doc_date>=?"); vals.push(dateFrom); }
      if (dateTo) { where.push("doc_date<=?"); vals.push(dateTo); }
      if (contragentId) { where.push("contragent_id=?"); vals.push(contragentId); }
      if (allowedDocIds) {
        const ph = allowedDocIds.map(() => "?").join(",");
        where.push(`id IN (${ph})`);
        vals.push(...allowedDocIds);
      }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      sql += " ORDER BY doc_date DESC, id DESC LIMIT ?";
      vals.push(limit);

      const docs = query(sql, vals);
      if (!docs.length) return { documents: [] };

      const docIds = docs.map(d => d.id);
      const ph = docIds.map(() => "?").join(",");
      const lines = query(
        `SELECT id,doc_id,good_id,quantity,price,cost_at_time FROM doc_lines WHERE doc_id IN (${ph}) ORDER BY id`,
        docIds
      );
      const gMap = fetchGoodsMap(lines.map(l => l.good_id));
      const cMap = fetchContragentMap(docs.map(d => d.contragent_id));

      const linesByDoc = new Map();
      for (const l of lines) {
        const arr = linesByDoc.get(l.doc_id) || [];
        arr.push({ ...l, good: gMap.get(l.good_id) || null });
        linesByDoc.set(l.doc_id, arr);
      }

      const documents = docs.map(doc => {
        const dLines = linesByDoc.get(doc.id) || [];
        return {
          ...doc,
          contragent: cMap.get(doc.contragent_id) || null,
          line_count: dLines.length,
          total: round2(docTotal(dLines)),
          lines_preview: dLines.slice(0, 4)
        };
      });
      return { documents };
    }

    if (method === "POST") {
      const lines = normalizeLines(body.lines);
      const docType = toInt(body.doc_type);
      if (![1, 2].includes(docType)) throw new Error("doc_type must be 1 or 2");
      if (!body.doc_date) throw new Error("doc_date is required");
      if (!lines.length) throw new Error("At least one line is required");

      const result = rpcCreateDocument(
        docType, body.doc_date,
        body.description ? String(body.description).trim() : null,
        toInt(body.contragent_id, null), lines
      );
      const document = loadDocumentDetail(result.doc_id);
      return { result, document };
    }

    if (method === "PUT") {
      const docId = toInt(body.doc_id || body.id);
      const lines = normalizeLines(body.lines);
      if (!docId) throw new Error("doc_id is required");
      if (!body.doc_date) throw new Error("doc_date is required");
      if (!lines.length) throw new Error("At least one line is required");

      const result = rpcEditDocument(
        docId, body.doc_date,
        body.description ? String(body.description).trim() : null,
        toInt(body.contragent_id, null), lines
      );
      const document = loadDocumentDetail(docId);
      return { result, document };
    }

    if (method === "DELETE") {
      const docId = toInt(params.id) || toInt(body.doc_id || body.id);
      if (!docId) throw new Error("id is required");
      const result = rpcDeleteDocument(docId);
      return { result };
    }
  }

  // /api/dashboard
  function handleDashboard() {
    const today = new Date().toISOString().slice(0, 10);
    const todayDocs = query("SELECT id FROM documents WHERE doc_type=2 AND doc_date=?", [today]);
    const todayDocIds = new Set(todayDocs.map(d => d.id));

    let todaysSales = 0;
    if (todayDocIds.size) {
      const ph = [...todayDocIds].map(() => "?").join(",");
      const lines = query(`SELECT quantity, price FROM doc_lines WHERE doc_id IN (${ph})`, [...todayDocIds]);
      for (const l of lines) todaysSales += toNum(l.quantity) * toNum(l.price);
    }

    const goods = query("SELECT quantity, avg_cost FROM goods");
    let inventoryValue = 0;
    for (const g of goods) inventoryValue += toNum(g.quantity) * toNum(g.avg_cost);

    return {
      today,
      stats: {
        todays_sales: round2(todaysSales),
        inventory_value: round2(inventoryValue),
        total_products: goods.length
      }
    };
  }

  // /api/reports
  function handleReports(params) {
    const type = params.type || "summary";
    const dateFrom = params.date_from || null;
    const dateTo = params.date_to || null;

    function marginPct(revenue, profit) {
      if (!revenue) return 0;
      return Number(((profit / revenue) * 100).toFixed(1));
    }
    function accTotals(lines) {
      let revenue = 0, cost = 0;
      for (const l of lines) {
        const qty = toNum(l.quantity);
        revenue += qty * toNum(l.price);
        cost += qty * toNum(l.cost_at_time);
      }
      const profit = revenue - cost;
      return { revenue: round2(revenue), cost: round2(cost), profit: round2(profit), margin_pct: marginPct(revenue, profit) };
    }

    if (type === "inventory_value") {
      const goods = query("SELECT id,name,group_id,quantity,avg_cost FROM goods WHERE quantity > 0 ORDER BY name LIMIT 10000");
      const { byId } = fetchGroupMeta();
      const rowsByGroup = new Map();
      for (const g of goods) {
        const group = byId.get(g.group_id);
        const key = group ? group.id : 0;
        const row = rowsByGroup.get(key) || { group_id: key || null, group_name: group?.name || "Unassigned", total_qty: 0, total_value: 0 };
        row.total_qty += toNum(g.quantity);
        row.total_value += toNum(g.quantity) * toNum(g.avg_cost);
        rowsByGroup.set(key, row);
      }
      const rows = [...rowsByGroup.values()]
        .map(r => ({ ...r, total_qty: round2(r.total_qty), total_value: round2(r.total_value) }))
        .sort((a, b) => String(a.group_name).localeCompare(String(b.group_name)));
      const grand_total = round2(rows.reduce((s, r) => s + r.total_value, 0));
      return { type, date_from: dateFrom, date_to: dateTo, rows, grand_total };
    }

    // load outgoing docs in range
    let docSql = "SELECT id, doc_type, doc_date, doc_num, contragent_id FROM documents WHERE doc_type=2";
    const docVals = [];
    if (dateFrom) { docSql += " AND doc_date>=?"; docVals.push(dateFrom); }
    if (dateTo) { docSql += " AND doc_date<=?"; docVals.push(dateTo); }
    docSql += " ORDER BY doc_date, id LIMIT 10000";
    const docs = query(docSql, docVals);

    if (!docs.length) {
      const emptySummary = { revenue: 0, cost: 0, profit: 0, margin_pct: 0 };
      return { type, date_from: dateFrom, date_to: dateTo, summary: emptySummary, count_docs: 0, rows: [] };
    }

    const docIds = docs.map(d => d.id);
    const ph = docIds.map(() => "?").join(",");
    const lines = query(`SELECT id,doc_id,good_id,quantity,price,cost_at_time FROM doc_lines WHERE doc_id IN (${ph}) ORDER BY id`, docIds);
    const summary = accTotals(lines);
    const docsById = new Map(docs.map(d => [d.id, d]));

    if (type === "summary") {
      return { type, date_from: dateFrom, date_to: dateTo, summary, count_docs: docs.length };
    }

    if (type === "by_customer") {
      const cMap = fetchContragentMap(docs.map(d => d.contragent_id));
      const buckets = new Map();
      for (const l of lines) {
        const doc = docsById.get(l.doc_id);
        const key = doc?.contragent_id || 0;
        const b = buckets.get(key) || { contragent_id: key || null, contragent_name: cMap.get(key)?.name || "Walk-in / Unknown", lines: [] };
        b.lines.push(l);
        buckets.set(key, b);
      }
      const rows = [...buckets.values()]
        .map(b => { const { lines: _, ...rest } = { ...b, ...accTotals(b.lines) }; return rest; })
        .sort((a, b) => b.profit - a.profit);
      return { type, date_from: dateFrom, date_to: dateTo, summary, rows };
    }

    if (type === "by_group") {
      const gMap = fetchGoodsMap(lines.map(l => l.good_id));
      const { byId } = fetchGroupMeta();
      const buckets = new Map();
      for (const l of lines) {
        const good = gMap.get(l.good_id);
        const groupId = good?.group_id || 0;
        const group = byId.get(groupId);
        const b = buckets.get(groupId) || { group_id: groupId || null, group_name: group?.name || "Unassigned", lines: [] };
        b.lines.push(l);
        buckets.set(groupId, b);
      }
      const rows = [...buckets.values()]
        .map(b => { const { lines: _, ...rest } = { ...b, ...accTotals(b.lines) }; return rest; })
        .sort((a, b) => b.profit - a.profit);
      return { type, date_from: dateFrom, date_to: dateTo, summary, rows };
    }

    return { type: "summary", date_from: dateFrom, date_to: dateTo, summary, rows: [] };
  }

  // /api/customer-recent-goods
  function handleCustomerRecentGoods(params) {
    const contragentId = toInt(params.contragent_id);
    const limit = Math.min(Math.max(toInt(params.limit, 10), 1), 50);
    if (!contragentId) return { items: [] };

    const docs = query(
      "SELECT id, doc_date FROM documents WHERE doc_type=2 AND contragent_id=? ORDER BY doc_date DESC, id DESC LIMIT 50",
      [contragentId]
    );
    if (!docs.length) return { items: [] };

    const docIds = docs.map(d => d.id);
    const docDateById = new Map(docs.map(d => [d.id, d.doc_date || null]));
    const docOrder = new Map(docs.map((d, i) => [d.id, i]));

    const ph = docIds.map(() => "?").join(",");
    const lines = query(
      `SELECT id, doc_id, good_id, quantity, price FROM doc_lines WHERE doc_id IN (${ph}) ORDER BY id DESC`,
      docIds
    );

    const filtered = lines
      .filter(l => l.good_id > 0 && toNum(l.quantity) > 0)
      .sort((a, b) => {
        const oa = docOrder.get(a.doc_id) ?? Number.MAX_SAFE_INTEGER;
        const ob = docOrder.get(b.doc_id) ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        return (b.id || 0) - (a.id || 0);
      });

    const recent = [];
    const seen = new Set();
    for (const l of filtered) {
      if (seen.has(l.good_id)) continue;
      seen.add(l.good_id);
      recent.push(l);
      if (recent.length >= limit) break;
    }
    if (!recent.length) return { items: [] };

    const gMap = fetchGoodsMap(recent.map(l => l.good_id));
    const { byId: groupsById } = fetchGroupMeta();

    const items = recent.map(l => {
      const good = gMap.get(l.good_id) || null;
      const group = good?.group_id ? groupsById.get(good.group_id) : null;
      return {
        good_id: l.good_id,
        good_name: good?.name || `#${l.good_id}`,
        group_name: group?.name || "",
        last_price: toNum(l.price),
        last_qty: toNum(l.quantity),
        last_date: docDateById.get(l.doc_id) || null,
        doc_id: l.doc_id
      };
    });

    return { items };
  }

  // ── router ───────────────────────────────────────────────────────────
  function parseRequest(path, options) {
    const url = new URL(path, "http://localhost");
    const params = Object.fromEntries(url.searchParams.entries());
    const method = (options.method || "GET").toUpperCase();
    let body = options.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    return { pathname: url.pathname, method, params, body };
  }

  async function handleRequest(path, options) {
    const { pathname, method, params, body } = parseRequest(path, options);

    try {
      switch (pathname) {
        case "/api/auth":
          return await handleAuth(method, params, body);
        case "/api/goods-groups":
          return handleGoodsGroups(method, params, body);
        case "/api/goods":
          return handleGoods(method, params, body);
        case "/api/contragents":
          return handleContragents(method, params, body);
        case "/api/documents":
          return handleDocuments(method, params, body);
        case "/api/dashboard":
          return handleDashboard();
        case "/api/reports":
          return handleReports(params);
        case "/api/customer-recent-goods":
          return handleCustomerRecentGoods(params);
        default:
          throw new Error("Unknown API route: " + pathname);
      }
    } catch (e) {
      return { error: e.message || "Unexpected error" };
    }
  }

  // ── export / import ──────────────────────────────────────────────────
  function exportDatabase() {
    const data = db.export();
    const blob = new Blob([data], { type: "application/x-sqlite3" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-backup-${new Date().toISOString().slice(0, 10)}.db`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  async function importDatabase(file) {
    const buf = await file.arrayBuffer();
    const SQL = await initSqlJs({ locateFile: (f) => `/lib/${f}` });
    const testDb = new SQL.Database(new Uint8Array(buf));

    // validate: check for expected tables
    const tables = testDb.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set((tables[0]?.values || []).map(r => r[0]));

    // Check for legacy format (old Android app)
    const isLegacy = tableNames.has("tovars") || tableNames.has("tovar_groups");

    if (isLegacy) {
      // Import legacy format into current db
      await importLegacyDatabase(testDb);
      testDb.close();
    } else {
      // Check it has the right tables
      const required = ["goods", "goods_groups", "contragents", "documents", "doc_lines"];
      const missing = required.filter(t => !tableNames.has(t));
      if (missing.length) {
        testDb.close();
        throw new Error("Invalid database: missing tables: " + missing.join(", "));
      }
      // Replace current db
      if (db) db.close();
      db = testDb;
      // Ensure schema is up to date
      db.run(SCHEMA_DDL);
    }

    await saveToOPFS();
    return { ok: true };
  }

  async function importLegacyDatabase(srcDb) {
    // Reset current db
    run("DELETE FROM doc_lines");
    run("DELETE FROM documents");
    run("DELETE FROM goods");
    run("DELETE FROM goods_groups");
    run("DELETE FROM contragents");
    run("UPDATE app_settings SET next_in_num=1, next_out_num=1 WHERE id=1");

    // Import groups
    const groups = srcDb.exec("SELECT * FROM tovar_groups");
    if (groups.length && groups[0].values.length) {
      const cols = groups[0].columns;
      for (const row of groups[0].values) {
        const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
        run("INSERT INTO goods_groups (id, name, price_in, price_out) VALUES(?,?,?,?)",
          [r.id || r._id, r.name, toNum(r.price_in, 0), toNum(r.price_out, 0)]);
      }
      // second pass for parent_id
      for (const row of groups[0].values) {
        const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
        if (r.parent_id) {
          run("UPDATE goods_groups SET parent_id=? WHERE id=?", [r.parent_id, r.id || r._id]);
        }
      }
    }

    // Import goods/tovars
    const tovars = srcDb.exec("SELECT * FROM tovars");
    if (tovars.length && tovars[0].values.length) {
      const cols = tovars[0].columns;
      for (const row of tovars[0].values) {
        const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
        run("INSERT INTO goods (id, barcode, name, group_id, avg_cost, quantity, measure) VALUES(?,?,?,?,?,?,?)",
          [r.id || r._id, r.barcode || null, r.name, r.group_id || r.tovar_group_id || null,
           toNum(r.avg_cost, 0), 0, r.measure || null]);
      }
    }

    // Import contragents
    try {
      const contragents = srcDb.exec("SELECT * FROM contragents");
      if (contragents.length && contragents[0].values.length) {
        const cols = contragents[0].columns;
        for (const row of contragents[0].values) {
          const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
          run("INSERT INTO contragents (id, name, phone, email, address, type, notes) VALUES(?,?,?,?,?,?,?)",
            [r.id || r._id, r.name, r.phone || null, r.email || null, r.address || null,
             toInt(r.type, 1), r.notes || null]);
        }
      }
    } catch (e) { /* contragents table may not exist in legacy */ }

    // Import documents
    try {
      const docs = srcDb.exec("SELECT * FROM documents WHERE doc_type IN (1,2)");
      if (docs.length && docs[0].values.length) {
        const cols = docs[0].columns;
        let maxIn = 0, maxOut = 0;
        for (const row of docs[0].values) {
          const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
          run("INSERT INTO documents (id, doc_type, doc_date, doc_num, description, contragent_id) VALUES(?,?,?,?,?,?)",
            [r.id || r._id, r.doc_type, r.doc_date, r.doc_num || "", r.description || null, r.contragent_id || null]);
          const num = parseInt(String(r.doc_num || "").replace(/\D/g, ""), 10) || 0;
          if (r.doc_type === 1 && num > maxIn) maxIn = num;
          if (r.doc_type === 2 && num > maxOut) maxOut = num;
        }
        run("UPDATE app_settings SET next_in_num=?, next_out_num=? WHERE id=1", [maxIn + 1, maxOut + 1]);
      }
    } catch (e) { /* documents may not exist */ }

    // Import doc_lines
    try {
      const lines = srcDb.exec("SELECT * FROM doc_lines");
      if (lines.length && lines[0].values.length) {
        const cols = lines[0].columns;
        for (const row of lines[0].values) {
          const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
          if (!r.quantity || toNum(r.quantity) <= 0) continue;
          run("INSERT INTO doc_lines (id, doc_id, good_id, quantity, price, cost_at_time) VALUES(?,?,?,?,?,?)",
            [r.id || r._id, r.doc_id, r.good_id || r.tovar_id, toNum(r.quantity), toNum(r.price), r.cost_at_time != null ? toNum(r.cost_at_time) : null]);
        }
      }
    } catch (e) { /* doc_lines may not exist */ }

    // Apply stock from stock table if exists
    try {
      const stock = srcDb.exec("SELECT * FROM stock WHERE store_id = -2");
      if (stock.length && stock[0].values.length) {
        const cols = stock[0].columns;
        for (const row of stock[0].values) {
          const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
          const goodId = r.tovar_id || r.good_id;
          if (goodId && toNum(r.quantity) > 0) {
            run("UPDATE goods SET quantity=? WHERE id=?", [toNum(r.quantity), goodId]);
          }
        }
      }
    } catch (e) { /* stock table may not exist */ }
  }

  async function checkPersistence() {
    if (navigator.storage && navigator.storage.persisted) {
      return navigator.storage.persisted();
    }
    return false;
  }

  // ── public API ───────────────────────────────────────────────────────
  window.LocalDB = {
    init,
    handleRequest,
    exportDatabase,
    importDatabase,
    checkPersistence,
    isReady: () => db !== null
  };
})();
