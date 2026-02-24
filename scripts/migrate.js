/* eslint-disable no-console */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const { createClient } = require("@supabase/supabase-js");

const BATCH_SIZE = 100;
const MAIN_STORE_ID = Number(process.env.MAIN_STORE_ID || -2);
const SOURCE_DB_PATH = process.env.SOURCE_DB_PATH || path.join(process.cwd(), "old_data.db");
const WIPE_FIRST = process.env.WIPE_FIRST === "1";
const APP_PIN = process.env.APP_PIN || "";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function createSupabase() {
  return createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function n(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function firstNonZero(values, fallback = 0) {
  for (const value of values) {
    const num = n(value, NaN);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sb(supabase, promiseOrFn, label, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const result = typeof promiseOrFn === "function" ? await promiseOrFn() : await promiseOrFn;
    if (!result.error) return result;
    const msg = result.error.message || String(result.error);
    const isRetryable = /502|503|504|bad gateway|timeout|fetch/i.test(msg);
    if (isRetryable && attempt < retries) {
      const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
      console.log(`  Retry ${attempt}/${retries} for ${label} (waiting ${delay}ms)...`);
      await sleep(delay);
      continue;
    }
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}${msg}`);
  }
}

async function batchInsert(supabase, table, rows, label) {
  const allResults = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await sb(
      supabase,
      () => supabase.from(table).insert(batch).select("id"),
      `${label} batch ${i}-${i + batch.length}`
    );
    allResults.push(...result.data);
    if (i > 0 && i % 500 === 0) {
      console.log(`  ${label}: ${i}/${rows.length}...`);
    }
    await sleep(200);
  }
  return allResults;
}

async function openSourceDb() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(SOURCE_DB_PATH);
  return new SQL.Database(buffer);
}

function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function loadSourceData(db) {
  const groups = queryAll(db, "SELECT * FROM tovar_groups ORDER BY _id");
  const goods = queryAll(db, "SELECT * FROM tovars ORDER BY _id");
  const contragents = queryAll(db, "SELECT * FROM contragents ORDER BY _id");
  const docs = queryAll(
    db,
    `SELECT *
     FROM documents
     WHERE doc_store_id = ? AND doc_type IN (1, 2)
     ORDER BY COALESCE(doc_date, add_date), _id`,
    [MAIN_STORE_ID]
  );
  const lines = queryAll(
    db,
    `SELECT *
     FROM doc_lines
     WHERE doc_id IN (
       SELECT _id FROM documents WHERE doc_store_id = ? AND doc_type IN (1, 2)
     )
     ORDER BY doc_id, _id`,
    [MAIN_STORE_ID]
  );
  const stock = queryAll(db, "SELECT * FROM stock WHERE store_id = ? ORDER BY tovar_id", [MAIN_STORE_ID]);

  return { groups, goods, contragents, docs, lines, stock };
}

function inferGroupDefaults(goods) {
  const byGroup = new Map();
  for (const g of goods) {
    const groupId = Number(g.group_id || 0);
    if (!groupId) continue;
    const bucket = byGroup.get(groupId) || { inVals: [], outVals: [] };
    if (n(g.price_in) > 0) bucket.inVals.push(n(g.price_in));
    if (n(g.price_out) > 0) bucket.outVals.push(n(g.price_out));
    byGroup.set(groupId, bucket);
  }

  const avg = (arr) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : 0);
  const out = new Map();
  for (const [groupId, bucket] of byGroup.entries()) {
    out.set(groupId, {
      price_in: avg(bucket.inVals),
      price_out: avg(bucket.outVals)
    });
  }
  return out;
}

async function ensureSettings(supabase) {
  const current = await sb(
    supabase,
    supabase.from("app_settings").select("id").order("id", { ascending: true }).limit(1),
    "read app_settings"
  );
  if (current.data?.length) return current.data[0].id;
  const inserted = await sb(
    supabase,
    supabase
      .from("app_settings")
      .insert({ pin_hash: null, next_in_num: 1, next_out_num: 1 })
      .select("id")
      .single(),
    "insert app_settings"
  );
  return inserted.data.id;
}

async function wipeDestination(supabase) {
  console.log("Wiping destination tables...");
  await sb(supabase, supabase.from("doc_lines").delete().gte("id", 0), "wipe doc_lines");
  await sb(supabase, supabase.from("documents").delete().gte("id", 0), "wipe documents");
  await sb(supabase, supabase.from("goods").delete().gte("id", 0), "wipe goods");
  await sb(supabase, supabase.from("contragents").delete().gte("id", 0), "wipe contragents");
  await sb(supabase, supabase.from("goods_groups").delete().gte("id", 0), "wipe goods_groups");
  await ensureSettings(supabase);
  const settingsPatch = { next_in_num: 1, next_out_num: 1 };
  if (APP_PIN) settingsPatch.pin_hash = sha256(APP_PIN);
  await sb(
    supabase,
    supabase.from("app_settings").update(settingsPatch).eq("id", 1),
    "reset app_settings"
  );
}

async function importGroups(supabase, sourceGroups, sourceGoods) {
  console.log(`Importing groups (${sourceGroups.length})...`);
  const pricingByGroup = inferGroupDefaults(sourceGoods);
  const sourceToDest = new Map();

  // Insert groups without parent_id first
  const groupRows = sourceGroups.map((row) => {
    const pricing = pricingByGroup.get(Number(row._id)) || { price_in: 0, price_out: 0 };
    return {
      name: String(row.name || "").trim() || `Group ${row._id}`,
      parent_id: null,
      price_in: pricing.price_in,
      price_out: pricing.price_out
    };
  });

  const inserted = await batchInsert(supabase, "goods_groups", groupRows, "groups");
  for (let i = 0; i < sourceGroups.length; i++) {
    sourceToDest.set(Number(sourceGroups[i]._id), inserted[i].id);
  }

  // Now set parent_id relationships
  for (const row of sourceGroups) {
    const parentSourceId = Number(row._id_id || 0);
    const destId = sourceToDest.get(Number(row._id));
    const parentDestId = sourceToDest.get(parentSourceId) || null;
    if (!destId || !parentDestId || parentSourceId <= 0) continue;
    await sb(
      supabase,
      supabase.from("goods_groups").update({ parent_id: parentDestId }).eq("id", destId),
      `set group parent ${row._id}`
    );
  }

  return sourceToDest;
}

async function importGoods(supabase, sourceGoods, groupMap) {
  console.log(`Importing goods (${sourceGoods.length})...`);
  const sourceToDest = new Map();

  const goodRows = sourceGoods.map((row) => ({
    barcode: row.barcode ? String(row.barcode).trim() : null,
    name: String(row.name || "").trim() || `Item ${row._id}`,
    group_id: groupMap.get(Number(row.group_id || 0)) || null,
    avg_cost: n(row.price_in, 0),
    quantity: 0,
    measure: row.measure ? String(row.measure).trim() : null
  }));

  const inserted = await batchInsert(supabase, "goods", goodRows, "goods");
  for (let i = 0; i < sourceGoods.length; i++) {
    sourceToDest.set(Number(sourceGoods[i]._id), inserted[i].id);
  }

  return sourceToDest;
}

function mapContragentType(sourceType) {
  const t = Number(sourceType);
  if (t === 0) return 0;
  if (t === 1) return 1;
  return 1;
}

async function importContragents(supabase, sourceContragents) {
  console.log(`Importing contragents (${sourceContragents.length})...`);
  const sourceToDest = new Map();

  const contragentRows = sourceContragents.map((row) => ({
    name: String(row.cont_name || "").trim() || `Contragent ${row._id}`,
    phone: row.cont_phone ? String(row.cont_phone).trim() : null,
    email: row.cont_email ? String(row.cont_email).trim() : null,
    address: row.cont_address ? String(row.cont_address).trim() : null,
    type: mapContragentType(row.cont_type),
    notes: row.cont_remark ? String(row.cont_remark).trim() : null
  }));

  const inserted = await batchInsert(supabase, "contragents", contragentRows, "contragents");
  for (let i = 0; i < sourceContragents.length; i++) {
    sourceToDest.set(Number(sourceContragents[i]._id), inserted[i].id);
  }

  return sourceToDest;
}

function buildLinesByDoc(sourceLines) {
  const map = new Map();
  for (const line of sourceLines) {
    const docId = Number(line.doc_id);
    const arr = map.get(docId) || [];
    arr.push(line);
    map.set(docId, arr);
  }
  return map;
}

function chooseLinePrice(sourceLine, docType, sourceGood) {
  return firstNonZero(
    [
      sourceLine.price,
      docType === 1 ? sourceLine.price_in : sourceLine.price_out,
      docType === 1 ? sourceGood?.price_in : sourceGood?.price_out,
      sourceGood?.price,
      sourceGood?.price_out,
      sourceGood?.price_in
    ],
    0
  );
}

async function importDocumentsDirect(supabase, sourceDocs, sourceLines, goodMap, contragentMap, sourceGoodsById) {
  console.log(`Importing documents (${sourceDocs.length})...`);
  const linesByDoc = buildLinesByDoc(sourceLines);

  let inCount = 0;
  let outCount = 0;

  // Prepare all document rows and their associated lines
  const docRows = [];
  const docLineGroups = []; // parallel array: lines for each doc

  for (const doc of sourceDocs) {
    const docType = Number(doc.doc_type);
    const sourceDocLines = linesByDoc.get(Number(doc._id)) || [];
    const lines = sourceDocLines
      .map((line) => {
        const sourceGoodId = Number(line.tovar_id);
        const destGoodId = goodMap.get(sourceGoodId);
        if (!destGoodId) return null;
        const qty = n(line.decimal_quantity, 0);
        if (qty <= 0) return null;
        const sourceGood = sourceGoodsById.get(sourceGoodId);
        return {
          good_id: destGoodId,
          quantity: Number(qty.toFixed(2)),
          price: Number(chooseLinePrice(line, docType, sourceGood).toFixed(2)),
          cost_at_time: n(line.price_in, 0) > 0 ? Number(n(line.price_in, 0).toFixed(2)) : null
        };
      })
      .filter(Boolean);

    if (!lines.length) continue;

    const docDate = doc.doc_date || doc.add_date;
    if (!docDate) continue;

    if (docType === 1) inCount += 1;
    else outCount += 1;
    const docNum = docType === 1
      ? `IN-${String(inCount).padStart(3, "0")}`
      : `OUT-${String(outCount).padStart(3, "0")}`;

    const contragentId = contragentMap.get(Number(doc.doc_contras_id || 0)) || null;

    docRows.push({
      doc_type: docType,
      doc_date: docDate,
      doc_num: docNum,
      description: doc.doc_description ? String(doc.doc_description).trim() : null,
      contragent_id: contragentId
    });
    docLineGroups.push(lines);
  }

  // Batch insert documents
  console.log(`  Inserting ${docRows.length} document headers...`);
  const insertedDocs = await batchInsert(supabase, "documents", docRows, "documents");

  // Build all doc_lines with the returned doc IDs
  const allDocLines = [];
  for (let i = 0; i < insertedDocs.length; i++) {
    const docId = insertedDocs[i].id;
    for (const line of docLineGroups[i]) {
      allDocLines.push({
        doc_id: docId,
        good_id: line.good_id,
        quantity: line.quantity,
        price: line.price,
        cost_at_time: line.cost_at_time
      });
    }
  }

  // Batch insert all doc_lines
  console.log(`  Inserting ${allDocLines.length} doc lines...`);
  await batchInsert(supabase, "doc_lines", allDocLines, "doc_lines");

  console.log(`Imported docs complete. Incoming: ${inCount}, outgoing: ${outCount}`);
  return { inCount, outCount, processed: insertedDocs.length };
}

async function applyStockSnapshot(supabase, sourceStock, goodMap) {
  console.log(`Applying stock snapshot (${sourceStock.length} rows)...`);
  let updated = 0;
  for (const row of sourceStock) {
    const destGoodId = goodMap.get(Number(row.tovar_id));
    if (!destGoodId) continue;
    await sb(
      supabase,
      () => supabase.from("goods").update({ quantity: Number(n(row.decimal_quantity, 0).toFixed(2)) }).eq("id", destGoodId),
      `set stock good ${row.tovar_id}`
    );
    updated += 1;
  }
  console.log(`Applied stock quantities to ${updated} goods.`);
}

async function syncAppSettingsCounters(supabase) {
  const docsRes = await sb(
    supabase,
    supabase.from("documents").select("doc_num").order("id", { ascending: true }).limit(50000),
    "read documents for counter sync"
  );
  let maxIn = 0;
  let maxOut = 0;
  for (const row of docsRes.data || []) {
    const docNum = String(row.doc_num || "");
    const m = docNum.match(/^(IN|OUT)-(\d+)$/i);
    if (!m) continue;
    const num = Number(m[2] || 0);
    if (/^IN$/i.test(m[1])) maxIn = Math.max(maxIn, num);
    if (/^OUT$/i.test(m[1])) maxOut = Math.max(maxOut, num);
  }
  const patch = { next_in_num: maxIn + 1, next_out_num: maxOut + 1 };
  if (APP_PIN) patch.pin_hash = sha256(APP_PIN);
  await sb(supabase, supabase.from("app_settings").update(patch).eq("id", 1), "sync app_settings");
  console.log(`Updated app_settings counters -> next_in_num=${patch.next_in_num}, next_out_num=${patch.next_out_num}`);
}

async function main() {
  console.log("Inventory migration starting...");
  console.log(`Source DB: ${SOURCE_DB_PATH}`);
  console.log(`Main Store filter: ${MAIN_STORE_ID}`);

  const supabase = createSupabase();
  const db = await openSourceDb();
  const source = loadSourceData(db);
  db.close();

  console.log(
    `Source counts -> groups:${source.groups.length}, goods:${source.goods.length}, contragents:${source.contragents.length}, docs:${source.docs.length}, lines:${source.lines.length}, stock:${source.stock.length}`
  );

  await ensureSettings(supabase);

  if (WIPE_FIRST) {
    await wipeDestination(supabase);
  } else {
    const goodsCount = (await sb(supabase, supabase.from("goods").select("id", { count: "exact", head: true }).gte("id", 0), "count goods")).count || 0;
    const docsCount = (await sb(supabase, supabase.from("documents").select("id", { count: "exact", head: true }).gte("id", 0), "count documents")).count || 0;
    if (goodsCount > 0 || docsCount > 0) {
      throw new Error(
        `Destination is not empty (goods=${goodsCount}, documents=${docsCount}). Set WIPE_FIRST=1 to clear and rerun.`
      );
    }
  }

  const sourceGoodsById = new Map(source.goods.map((g) => [Number(g._id), g]));

  const groupMap = await importGroups(supabase, source.groups, source.goods);
  const goodMap = await importGoods(supabase, source.goods, groupMap);
  const contragentMap = await importContragents(supabase, source.contragents);

  await importDocumentsDirect(supabase, source.docs, source.lines, goodMap, contragentMap, sourceGoodsById);
  await applyStockSnapshot(supabase, source.stock, goodMap);
  await syncAppSettingsCounters(supabase);

  console.log("Migration complete!");
}

main().catch((err) => {
  console.error("Migration failed:", err.message || err);
  process.exitCode = 1;
});
