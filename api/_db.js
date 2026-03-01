const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

let supabaseSingleton = null;

function env(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getSupabase() {
  if (supabaseSingleton) return supabaseSingleton;
  const url = env("SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY fallback)");
  }
  supabaseSingleton = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return supabaseSingleton;
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function ok(res, payload) {
  return json(res, 200, payload);
}

function fail(res, status, message, extra) {
  return json(res, status, { error: message, ...(extra || {}) });
}

function methodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  return fail(res, 405, `Method not allowed. Use: ${methods.join(", ")}`);
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function q(req, key, fallback = null) {
  const value = first((req.query || {})[key]);
  return value == null || value === "" ? fallback : value;
}

function toInt(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNum(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function likeTerm(value) {
  if (!value) return null;
  return `%${String(value).replace(/[%_]/g, "\\$&")}%`;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", resolve);
    req.on("error", reject);
  });

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sanitizeLine(line) {
  return {
    good_id: toInt(line.good_id),
    quantity: toNum(line.quantity),
    price: toNum(line.price)
  };
}

function normalizeLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map(sanitizeLine)
    .filter((line) => line.good_id && line.quantity > 0);
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession(supabase) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  // Clean up expired sessions
  await supabase.from("sessions").delete().lt("expires_at", now.toISOString());

  const { error } = await supabase
    .from("sessions")
    .insert({ token, expires_at: expiresAt.toISOString() });
  if (error) throw error;
  return { token, expires_at: expiresAt.toISOString() };
}

async function validateSession(supabase, token) {
  if (!token) return false;
  const { data, error } = await supabase
    .from("sessions")
    .select("id,expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return false;
  return new Date(data.expires_at) > new Date();
}

function getTokenFromRequest(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

async function requireSession(req, res, supabase) {
  const token = getTokenFromRequest(req);
  if (!token) {
    fail(res, 401, "Authentication required");
    return false;
  }
  const valid = await validateSession(supabase, token);
  if (!valid) {
    fail(res, 401, "Session expired or invalid");
    return false;
  }
  return true;
}

async function ensureSettingsRow(supabase) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("id")
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw error;
  if (data && data.length) return data[0];

  const insert = await supabase
    .from("app_settings")
    .insert({ pin_hash: null, next_in_num: 1, next_out_num: 1 })
    .select("id")
    .single();
  if (insert.error) throw insert.error;
  return insert.data;
}

function buildGroupTree(groups) {
  const byId = new Map();
  const roots = [];
  for (const group of groups) {
    byId.set(group.id, { ...group, children: [] });
  }
  for (const group of byId.values()) {
    if (group.parent_id && byId.has(group.parent_id)) {
      byId.get(group.parent_id).children.push(group);
    } else {
      roots.push(group);
    }
  }

  const sortFn = (a, b) => String(a.name).localeCompare(String(b.name));
  const sortTree = (nodes) => {
    nodes.sort(sortFn);
    nodes.forEach((node) => sortTree(node.children));
  };
  sortTree(roots);

  return { tree: roots, byId };
}

async function fetchGroupMap(supabase) {
  const { data, error } = await supabase
    .from("goods_groups")
    .select("id,parent_id,name,price_in,price_out")
    .order("name", { ascending: true });
  if (error) throw error;
  return buildGroupTree(data || []);
}

async function fetchGoodsMap(supabase, ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("goods")
    .select("id,name,group_id,avg_cost,quantity,barcode,measure")
    .in("id", uniqueIds);
  if (error) throw error;
  return new Map((data || []).map((item) => [item.id, item]));
}

async function fetchContragentMap(supabase, ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const { data, error } = await supabase
    .from("contragents")
    .select("id,name,type,phone")
    .in("id", uniqueIds);
  if (error) throw error;
  return new Map((data || []).map((item) => [item.id, item]));
}

async function handlerWrapper(req, res, fn) {
  try {
    res.setHeader("Cache-Control", "no-store");
    return await fn(req, res, getSupabase());
  } catch (error) {
    const message = error?.message || "Unexpected server error";
    return fail(res, 500, message);
  }
}

module.exports = {
  getSupabase,
  json,
  ok,
  fail,
  q,
  toInt,
  toNum,
  likeTerm,
  readJson,
  normalizeLines,
  sha256,
  ensureSettingsRow,
  buildGroupTree,
  fetchGroupMap,
  fetchGoodsMap,
  fetchContragentMap,
  methodNotAllowed,
  handlerWrapper,
  createSession,
  requireSession
};
