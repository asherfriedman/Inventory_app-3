const {
  ok,
  fail,
  q,
  toInt,
  readJson,
  normalizeLines,
  fetchGoodsMap,
  fetchContragentMap,
  methodNotAllowed,
  handlerWrapper,
  requireSession
} = require("./_db");

function docTotal(lines) {
  return (lines || []).reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.price || 0),
    0
  );
}

async function loadDocumentDetail(supabase, docId) {
  const docResult = await supabase.from("documents").select("*").eq("id", docId).maybeSingle();
  if (docResult.error) throw docResult.error;
  const doc = docResult.data;
  if (!doc) return null;

  const linesResult = await supabase
    .from("doc_lines")
    .select("id,doc_id,good_id,quantity,price,cost_at_time")
    .eq("doc_id", docId)
    .order("id", { ascending: true });
  if (linesResult.error) throw linesResult.error;
  const lines = linesResult.data || [];

  const goodsMap = await fetchGoodsMap(
    supabase,
    lines.map((line) => line.good_id)
  );
  const contragentMap = await fetchContragentMap(supabase, [doc.contragent_id]);

  const enrichedLines = lines.map((line) => ({
    ...line,
    good: goodsMap.get(line.good_id) || null
  }));

  return {
    ...doc,
    contragent: contragentMap.get(doc.contragent_id) || null,
    lines: enrichedLines,
    total: Number(docTotal(enrichedLines).toFixed(2))
  };
}

async function listDocuments(supabase, req) {
  const type = toInt(q(req, "type"));
  const dateFrom = q(req, "date_from");
  const dateTo = q(req, "date_to");
  const contragentId = toInt(q(req, "contragent_id"));
  const goodId = toInt(q(req, "good_id"));
  const limit = Math.min(Math.max(toInt(q(req, "limit"), 200), 1), 1000);

  let allowedDocIds = null;
  if (goodId) {
    const lineFilter = await supabase.from("doc_lines").select("doc_id").eq("good_id", goodId);
    if (lineFilter.error) throw lineFilter.error;
    allowedDocIds = [...new Set((lineFilter.data || []).map((row) => row.doc_id))];
    if (!allowedDocIds.length) return [];
  }

  let docsQuery = supabase
    .from("documents")
    .select("id,doc_type,doc_date,doc_num,description,contragent_id,created_at")
    .order("doc_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (type) docsQuery = docsQuery.eq("doc_type", type);
  if (dateFrom) docsQuery = docsQuery.gte("doc_date", dateFrom);
  if (dateTo) docsQuery = docsQuery.lte("doc_date", dateTo);
  if (contragentId) docsQuery = docsQuery.eq("contragent_id", contragentId);
  if (allowedDocIds) docsQuery = docsQuery.in("id", allowedDocIds);

  const docsResult = await docsQuery;
  if (docsResult.error) throw docsResult.error;
  const docs = docsResult.data || [];
  if (!docs.length) return [];

  const docIds = docs.map((doc) => doc.id);
  const linesResult = await supabase
    .from("doc_lines")
    .select("id,doc_id,good_id,quantity,price,cost_at_time")
    .in("doc_id", docIds)
    .order("id", { ascending: true });
  if (linesResult.error) throw linesResult.error;
  const lines = linesResult.data || [];

  const goodsMap = await fetchGoodsMap(
    supabase,
    lines.map((line) => line.good_id)
  );
  const contragentMap = await fetchContragentMap(
    supabase,
    docs.map((doc) => doc.contragent_id)
  );

  const linesByDoc = new Map();
  for (const line of lines) {
    const arr = linesByDoc.get(line.doc_id) || [];
    arr.push({ ...line, good: goodsMap.get(line.good_id) || null });
    linesByDoc.set(line.doc_id, arr);
  }

  return docs.map((doc) => {
    const docLines = linesByDoc.get(doc.id) || [];
    return {
      ...doc,
      contragent: contragentMap.get(doc.contragent_id) || null,
      line_count: docLines.length,
      total: Number(docTotal(docLines).toFixed(2)),
      lines_preview: docLines.slice(0, 4)
    };
  });
}

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (!(await requireSession(req, res, supabase))) return;
    if (req.method === "GET") {
      const docId = toInt(q(req, "id"));
      if (docId) {
        const document = await loadDocumentDetail(supabase, docId);
        if (!document) return fail(res, 404, "Document not found");
        return ok(res, { document });
      }

      const documents = await listDocuments(supabase, req);
      return ok(res, { documents });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const lines = normalizeLines(body.lines);
      const docType = toInt(body.doc_type);
      if (![1, 2].includes(docType)) return fail(res, 400, "doc_type must be 1 or 2");
      if (!body.doc_date) return fail(res, 400, "doc_date is required");
      if (!lines.length) return fail(res, 400, "At least one line is required");

      const { data, error } = await supabase.rpc("rpc_create_document", {
        p_doc_type: docType,
        p_doc_date: body.doc_date,
        p_description: body.description ? String(body.description).trim() : null,
        p_contragent_id: toInt(body.contragent_id, null),
        p_lines: lines
      });
      if (error) throw error;

      const docId = toInt(data?.doc_id);
      const document = docId ? await loadDocumentDetail(supabase, docId) : null;
      return ok(res, { result: data, document });
    }

    if (req.method === "PUT") {
      const body = await readJson(req);
      const docId = toInt(body.doc_id || body.id);
      const lines = normalizeLines(body.lines);
      if (!docId) return fail(res, 400, "doc_id is required");
      if (!body.doc_date) return fail(res, 400, "doc_date is required");
      if (!lines.length) return fail(res, 400, "At least one line is required");

      const { data, error } = await supabase.rpc("rpc_edit_document", {
        p_doc_id: docId,
        p_doc_date: body.doc_date,
        p_description: body.description ? String(body.description).trim() : null,
        p_contragent_id: toInt(body.contragent_id, null),
        p_lines: lines
      });
      if (error) throw error;

      const document = await loadDocumentDetail(supabase, docId);
      return ok(res, { result: data, document });
    }

    if (req.method === "DELETE") {
      const body = req.body ? await readJson(req).catch(() => ({})) : {};
      const docId = toInt(q(req, "id"), toInt(body.doc_id || body.id));
      if (!docId) return fail(res, 400, "id is required");

      const { data, error } = await supabase.rpc("rpc_delete_document", { p_doc_id: docId });
      if (error) throw error;
      return ok(res, { result: data });
    }

    return methodNotAllowed(res, ["GET", "POST", "PUT", "DELETE"]);
  });
};
