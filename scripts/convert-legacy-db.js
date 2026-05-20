const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const NEW_SCHEMA = `
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_hash TEXT,
  next_in_num INTEGER DEFAULT 1,
  next_out_num INTEGER DEFAULT 1,
  failed_attempts INTEGER DEFAULT 0,
  lockout_until TEXT
);
CREATE TABLE goods_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES goods_groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price_in REAL DEFAULT 0,
  price_out REAL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE goods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT,
  name TEXT NOT NULL,
  group_id INTEGER REFERENCES goods_groups(id),
  avg_cost REAL DEFAULT 0,
  quantity REAL DEFAULT 0,
  measure TEXT
);
CREATE TABLE contragents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  type INTEGER NOT NULL,
  notes TEXT
);
CREATE TABLE customer_group_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contragent_id INTEGER REFERENCES contragents(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES goods_groups(id) ON DELETE CASCADE,
  price_out REAL,
  UNIQUE (contragent_id, group_id)
);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type INTEGER NOT NULL,
  doc_date TEXT NOT NULL,
  doc_num TEXT NOT NULL,
  description TEXT,
  contragent_id INTEGER REFERENCES contragents(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE doc_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  good_id INTEGER REFERENCES goods(id),
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  cost_at_time REAL
);
CREATE INDEX idx_goods_group_id ON goods(group_id);
CREATE INDEX idx_goods_name ON goods(name);
CREATE INDEX idx_goods_groups_parent_id ON goods_groups(parent_id);
CREATE INDEX idx_contragents_type ON contragents(type);
CREATE INDEX idx_contragents_name ON contragents(name);
CREATE INDEX idx_documents_doc_type ON documents(doc_type);
CREATE INDEX idx_documents_doc_date ON documents(doc_date);
CREATE INDEX idx_documents_contragent_id ON documents(contragent_id);
CREATE INDEX idx_doc_lines_doc_id ON doc_lines(doc_id);
CREATE INDEX idx_doc_lines_good_id ON doc_lines(good_id);
CREATE INDEX idx_customer_group_prices_contragent ON customer_group_prices(contragent_id);
CREATE INDEX idx_customer_group_prices_group ON customer_group_prices(group_id);
`;

function usage() {
  console.log([
    "Usage:",
    "  node scripts/convert-legacy-db.js [source.bp|source.db] [output.db]",
    "",
    "If source is omitted, the newest .bp file in Downloads is used.",
    "If output is omitted, new.db is written next to the source."
  ].join("\n"));
}

function downloadsDir() {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) throw new Error("Could not find user home directory");
  return path.join(home, "Downloads");
}

function newestBackupInDownloads() {
  const dir = downloadsDir();
  const files = fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".bp"))
    .map((name) => {
      const fullPath = path.join(dir, name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!files.length) throw new Error(`No .bp backup files found in ${dir}`);
  return files[0].fullPath;
}

function resolveSourceAndOutput(argv) {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(0);
  }
  const source = path.resolve(args[0] || newestBackupInDownloads());
  const output = path.resolve(args[1] || path.join(path.dirname(source), "new.db"));
  if (source === output) throw new Error("Output path must be different from source path");
  return { source, output };
}

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

function one(db, sql, params = []) {
  return rows(db, sql, params)[0] || null;
}

function count(db, table) {
  return Number(one(db, `SELECT COUNT(*) AS count FROM ${table}`).count || 0);
}

function text(value) {
  const str = String(value ?? "").trim();
  return str || null;
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function integer(value, fallback = null) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Number((number(value) || 0).toFixed(2));
}

function numericDocNum(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function formatDocNum(prefix, value) {
  const n = numericDocNum(value);
  return n ? `${prefix}-${n}` : `${prefix}-0`;
}

function modePrice(values) {
  const counts = new Map();
  for (const raw of values) {
    const value = round2(raw);
    if (value <= 0) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  if (!counts.size) return 0;
  const best = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best[0];
}

function tableNames(db) {
  return new Set(rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((row) => row.name));
}

function assertLegacyDatabase(db) {
  const names = tableNames(db);
  const required = ["tovars", "tovar_groups", "contragents", "documents", "doc_lines"];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Source is missing legacy table(s): ${missing.join(", ")}`);
}

function addNewSchema(db) {
  db.run("PRAGMA foreign_keys=ON");
  db.run(NEW_SCHEMA);
}

function convertGroups(srcDb, outDb) {
  const priceByGroup = new Map();
  for (const item of rows(srcDb, "SELECT group_id, price_in, price_out FROM tovars")) {
    const groupId = integer(item.group_id);
    if (groupId == null) continue;
    if (!priceByGroup.has(groupId)) priceByGroup.set(groupId, { in: [], out: [] });
    priceByGroup.get(groupId).in.push(item.price_in);
    priceByGroup.get(groupId).out.push(item.price_out);
  }

  const groupRows = rows(srcDb, "SELECT _id, _id_id, name FROM tovar_groups ORDER BY _id");
  const validIds = new Set(groupRows.map((group) => Number(group._id)));
  const insert = outDb.prepare(
    "INSERT INTO goods_groups (id,parent_id,name,price_in,price_out,is_active) VALUES (?,?,?,?,?,1)"
  );

  for (const group of groupRows) {
    const id = Number(group._id);
    const prices = priceByGroup.get(id) || { in: [], out: [] };
    insert.run([
      id,
      null,
      text(group.name) || `Group ${id}`,
      modePrice(prices.in),
      modePrice(prices.out)
    ]);
  }
  insert.free();

  const updateParent = outDb.prepare("UPDATE goods_groups SET parent_id=? WHERE id=?");
  for (const group of groupRows) {
    const id = Number(group._id);
    const parentId = Number(group._id_id);
    if (validIds.has(parentId) && parentId !== id) {
      updateParent.run([parentId, id]);
    }
  }
  updateParent.free();
  return validIds;
}

function convertGoods(srcDb, outDb, validGroupIds) {
  const validGoodIds = new Set();
  const insert = outDb.prepare(
    "INSERT INTO goods (id,barcode,name,group_id,avg_cost,quantity,measure) VALUES (?,?,?,?,?,?,?)"
  );
  for (const item of rows(srcDb, "SELECT _id, barcode, name, group_id, price_in, decimal_quantity, measure FROM tovars ORDER BY _id")) {
    const id = Number(item._id);
    const groupId = integer(item.group_id);
    validGoodIds.add(id);
    insert.run([
      id,
      text(item.barcode),
      text(item.name) || `Item ${id}`,
      validGroupIds.has(groupId) ? groupId : null,
      round2(item.price_in),
      round2(item.decimal_quantity),
      text(item.measure)
    ]);
  }
  insert.free();
  return validGoodIds;
}

function convertContragents(srcDb, outDb) {
  const validIds = new Set();
  const insert = outDb.prepare(
    "INSERT INTO contragents (id,name,phone,email,address,type,notes) VALUES (?,?,?,?,?,?,?)"
  );
  for (const row of rows(srcDb, "SELECT _id, cont_name, short_name, cont_phone, cont_email, cont_address, cont_type, cont_remark, hidden FROM contragents ORDER BY _id")) {
    if (Number(row.hidden || 0) === 1) continue;
    const id = Number(row._id);
    const type = [0, 1].includes(Number(row.cont_type)) ? Number(row.cont_type) : 1;
    validIds.add(id);
    insert.run([
      id,
      text(row.cont_name) || text(row.short_name) || `Contact ${id}`,
      text(row.cont_phone),
      text(row.cont_email),
      text(row.cont_address),
      type,
      text(row.cont_remark)
    ]);
  }
  insert.free();
  return validIds;
}

function convertDocuments(srcDb, outDb, validContragentIds) {
  const validDocIds = new Set();
  let maxIn = 0;
  let maxOut = 0;
  const insert = outDb.prepare(
    "INSERT INTO documents (id,doc_type,doc_date,doc_num,description,contragent_id,created_at) VALUES (?,?,?,?,?,?,?)"
  );

  for (const row of rows(srcDb, "SELECT _id, doc_type, add_date, doc_date, doc_num, doc_description, doc_contras_id FROM documents WHERE doc_type IN (1,2) ORDER BY _id")) {
    const id = Number(row._id);
    const docType = Number(row.doc_type);
    const rawNum = row.doc_num;
    const numeric = numericDocNum(rawNum);
    const prefix = docType === 1 ? "IN" : "OUT";
    if (docType === 1) maxIn = Math.max(maxIn, numeric);
    if (docType === 2) maxOut = Math.max(maxOut, numeric);
    const contragentId = integer(row.doc_contras_id);
    validDocIds.add(id);
    insert.run([
      id,
      docType,
      text(row.doc_date) || text(row.add_date) || "1970-01-01",
      formatDocNum(prefix, rawNum),
      text(row.doc_description),
      validContragentIds.has(contragentId) ? contragentId : null,
      text(row.add_date) || text(row.doc_date) || null
    ]);
  }
  insert.free();

  outDb.run(
    "INSERT INTO app_settings (id,pin_hash,next_in_num,next_out_num,failed_attempts,lockout_until) VALUES (1,NULL,?,?,0,NULL)",
    [maxIn + 1, maxOut + 1]
  );
  return { validDocIds, maxIn, maxOut };
}

function convertLines(srcDb, outDb, validDocIds, validGoodIds) {
  let skipped = 0;
  const docTypes = new Map(rows(outDb, "SELECT id, doc_type FROM documents").map((doc) => [Number(doc.id), Number(doc.doc_type)]));
  const insert = outDb.prepare(
    "INSERT INTO doc_lines (id,doc_id,good_id,quantity,price,cost_at_time) VALUES (?,?,?,?,?,?)"
  );

  for (const row of rows(srcDb, "SELECT _id, doc_id, tovar_id, price, price_in, decimal_quantity FROM doc_lines ORDER BY _id")) {
    const docId = integer(row.doc_id);
    const goodId = integer(row.tovar_id);
    const qty = round2(row.decimal_quantity);
    if (!validDocIds.has(docId) || !validGoodIds.has(goodId) || qty <= 0) {
      skipped += 1;
      continue;
    }
    const docType = docTypes.get(docId);
    insert.run([
      Number(row._id),
      docId,
      goodId,
      qty,
      round2(row.price),
      docType === 2 ? round2(row.price_in) : null
    ]);
  }
  insert.free();
  return skipped;
}

function verify(db) {
  const integrity = one(db, "PRAGMA integrity_check").integrity_check;
  const foreignKeyIssues = rows(db, "PRAGMA foreign_key_check").length;
  const summary = {
    goods_groups: count(db, "goods_groups"),
    goods: count(db, "goods"),
    contragents: count(db, "contragents"),
    documents: count(db, "documents"),
    doc_lines: count(db, "doc_lines"),
    customer_group_prices: count(db, "customer_group_prices")
  };
  const latestDocs = rows(db, `
    SELECT d.id,d.doc_type,d.doc_date,d.doc_num,c.name AS customer,COUNT(l.id) AS lines,
           ROUND(COALESCE(SUM(l.quantity*l.price),0),2) AS total
    FROM documents d
    LEFT JOIN contragents c ON c.id=d.contragent_id
    LEFT JOIN doc_lines l ON l.doc_id=d.id
    GROUP BY d.id
    ORDER BY d.doc_date DESC,d.id DESC
    LIMIT 10
  `);
  const rootGroups = rows(db, "SELECT id,name FROM goods_groups WHERE parent_id IS NULL ORDER BY name");
  const childGroups = rows(db, "SELECT id,parent_id,name FROM goods_groups WHERE parent_id IS NOT NULL ORDER BY parent_id,name LIMIT 30");
  const settings = one(db, "SELECT next_in_num,next_out_num FROM app_settings WHERE id=1");
  return { integrity, foreignKeyIssues, summary, latestDocs, rootGroups, childGroups, settings };
}

async function main() {
  const { source, output } = resolveSourceAndOutput(process.argv);
  if (!fs.existsSync(source)) throw new Error(`Source file not found: ${source}`);

  const SQL = await initSqlJs();
  const sourceBytes = fs.readFileSync(source);
  const srcDb = new SQL.Database(sourceBytes);
  assertLegacyDatabase(srcDb);

  const outDb = new SQL.Database();
  addNewSchema(outDb);
  const validGroupIds = convertGroups(srcDb, outDb);
  const validGoodIds = convertGoods(srcDb, outDb, validGroupIds);
  const validContragentIds = convertContragents(srcDb, outDb);
  const { validDocIds } = convertDocuments(srcDb, outDb, validContragentIds);
  const skippedLines = convertLines(srcDb, outDb, validDocIds, validGoodIds);
  const result = verify(outDb);

  const bytes = outDb.export();
  fs.writeFileSync(output, Buffer.from(bytes));
  srcDb.close();
  outDb.close();

  console.log(JSON.stringify({
    source,
    output,
    skippedLines,
    ...result
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
