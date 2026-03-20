/* export-supabase.js — Pull all data from Supabase and save as a local .db file
 *
 * Usage:
 *   SUPABASE_URL=https://shcirsxtqwbjpmjxieqj.supabase.co \
 *   SUPABASE_SERVICE_KEY=<key from api.txt> \
 *   node scripts/export-supabase.js
 *
 * Produces: supabase_export_<timestamp>.db
 */
const fs = require("fs");
const initSqlJs = require("sql.js");
const { createClient } = require("@supabase/supabase-js");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function fetchAll(supabase, table, orderBy = "id") {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  ${table}: ${all.length} rows`);
  return all;
}

async function main() {
  const supabase = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  console.log("Fetching data from Supabase...");
  const settings = await fetchAll(supabase, "app_settings");
  const groups = await fetchAll(supabase, "goods_groups");
  const goods = await fetchAll(supabase, "goods");
  const contragents = await fetchAll(supabase, "contragents");
  const documents = await fetchAll(supabase, "documents");
  const docLines = await fetchAll(supabase, "doc_lines");

  let customerGroupPrices = [];
  try {
    customerGroupPrices = await fetchAll(supabase, "customer_group_prices");
  } catch (e) { /* table may not exist */ }

  console.log("\nBuilding SQLite database...");
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Create tables matching local-db.js schema
  db.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pin_hash TEXT,
      next_in_num INTEGER DEFAULT 1,
      next_out_num INTEGER DEFAULT 1,
      failed_attempts INTEGER DEFAULT 0,
      lockout_until TEXT
    );
    CREATE TABLE IF NOT EXISTS goods_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER,
      name TEXT NOT NULL,
      price_in REAL DEFAULT 0,
      price_out REAL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS goods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT,
      name TEXT NOT NULL,
      group_id INTEGER,
      avg_cost REAL DEFAULT 0,
      quantity REAL DEFAULT 0,
      measure TEXT
    );
    CREATE TABLE IF NOT EXISTS contragents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      type INTEGER NOT NULL DEFAULT 1,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS customer_group_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contragent_id INTEGER,
      group_id INTEGER,
      price_out REAL,
      UNIQUE (contragent_id, group_id)
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type INTEGER NOT NULL,
      doc_date TEXT NOT NULL,
      doc_num TEXT NOT NULL,
      description TEXT,
      contragent_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS doc_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER,
      good_id INTEGER,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      cost_at_time REAL
    );
  `);

  // Insert data
  db.run("BEGIN");

  for (const s of settings) {
    db.run("INSERT INTO app_settings (id, pin_hash, next_in_num, next_out_num, failed_attempts, lockout_until) VALUES(?,?,?,?,?,?)",
      [s.id, null, s.next_in_num || 1, s.next_out_num || 1, 0, null]); // don't copy pin_hash — user sets new PIN
  }

  for (const g of groups) {
    db.run("INSERT INTO goods_groups (id, parent_id, name, price_in, price_out, is_active) VALUES(?,?,?,?,?,?)",
      [g.id, g.parent_id, g.name, g.price_in || 0, g.price_out || 0, g.is_active ? 1 : 0]);
  }

  for (const g of goods) {
    db.run("INSERT INTO goods (id, barcode, name, group_id, avg_cost, quantity, measure) VALUES(?,?,?,?,?,?,?)",
      [g.id, g.barcode, g.name, g.group_id, g.avg_cost || 0, g.quantity || 0, g.measure]);
  }

  for (const c of contragents) {
    db.run("INSERT INTO contragents (id, name, phone, email, address, type, notes) VALUES(?,?,?,?,?,?,?)",
      [c.id, c.name, c.phone, c.email, c.address, c.type, c.notes]);
  }

  for (const cgp of customerGroupPrices) {
    db.run("INSERT INTO customer_group_prices (id, contragent_id, group_id, price_out) VALUES(?,?,?,?)",
      [cgp.id, cgp.contragent_id, cgp.group_id, cgp.price_out]);
  }

  for (const d of documents) {
    db.run("INSERT INTO documents (id, doc_type, doc_date, doc_num, description, contragent_id, created_at) VALUES(?,?,?,?,?,?,?)",
      [d.id, d.doc_type, d.doc_date, d.doc_num, d.description, d.contragent_id, d.created_at]);
  }

  for (const l of docLines) {
    db.run("INSERT INTO doc_lines (id, doc_id, good_id, quantity, price, cost_at_time) VALUES(?,?,?,?,?,?)",
      [l.id, l.doc_id, l.good_id, l.quantity, l.price, l.cost_at_time]);
  }

  db.run("COMMIT");

  // Validate — try reading back from every table to make sure it's clean
  console.log("\nValidating...");
  const checks = [
    ["app_settings", "id, pin_hash, next_in_num, next_out_num, failed_attempts, lockout_until"],
    ["goods_groups", "id, parent_id, name, price_in, price_out, is_active"],
    ["goods", "id, barcode, name, group_id, avg_cost, quantity, measure"],
    ["contragents", "id, name, phone, email, address, type, notes"],
    ["documents", "id, doc_type, doc_date, doc_num, description, contragent_id, created_at"],
    ["doc_lines", "id, doc_id, good_id, quantity, price, cost_at_time"],
    ["customer_group_prices", "id, contragent_id, group_id, price_out"],
  ];
  for (const [table, cols] of checks) {
    const res = db.exec(`SELECT ${cols} FROM ${table} LIMIT 1`);
    const cnt = db.exec(`SELECT COUNT(*) FROM ${table}`);
    const n = cnt[0]?.values[0][0] || 0;
    console.log(`  ✓ ${table}: ${n} rows, all columns OK`);
  }

  // Export to file
  const data = db.export();
  const filename = `supabase_export_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.db`;
  fs.writeFileSync(filename, Buffer.from(data));
  db.close();

  console.log(`\nDone! Saved to: ${filename}`);
  console.log("Send this file to your iPhone and import it in the app under Data → Choose File & Import.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
