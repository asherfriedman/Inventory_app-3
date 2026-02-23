const {
  ok,
  q,
  toInt,
  fetchGoodsMap,
  fetchContragentMap,
  fetchGroupMap,
  methodNotAllowed,
  handlerWrapper
} = require("./_db");

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function marginPct(revenue, profit) {
  if (!revenue) return 0;
  return Number(((profit / revenue) * 100).toFixed(1));
}

function accumulateTotals(lines) {
  let revenue = 0;
  let cost = 0;
  for (const line of lines) {
    const qty = Number(line.quantity || 0);
    revenue += qty * Number(line.price || 0);
    cost += qty * Number(line.cost_at_time || 0);
  }
  const profit = revenue - cost;
  return {
    revenue: round2(revenue),
    cost: round2(cost),
    profit: round2(profit),
    margin_pct: marginPct(revenue, profit)
  };
}

async function loadOutgoingRange(supabase, dateFrom, dateTo) {
  let docsQuery = supabase
    .from("documents")
    .select("id,doc_type,doc_date,doc_num,contragent_id")
    .eq("doc_type", 2)
    .order("doc_date", { ascending: true })
    .order("id", { ascending: true })
    .limit(10000);
  if (dateFrom) docsQuery = docsQuery.gte("doc_date", dateFrom);
  if (dateTo) docsQuery = docsQuery.lte("doc_date", dateTo);

  const docsResult = await docsQuery;
  if (docsResult.error) throw docsResult.error;
  const docs = docsResult.data || [];
  if (!docs.length) return { docs: [], lines: [], goodsMap: new Map(), groupMeta: { tree: [], byId: new Map() }, contragentMap: new Map() };

  const docIds = docs.map((doc) => doc.id);
  const linesResult = await supabase
    .from("doc_lines")
    .select("id,doc_id,good_id,quantity,price,cost_at_time")
    .in("doc_id", docIds)
    .order("id", { ascending: true });
  if (linesResult.error) throw linesResult.error;
  const lines = linesResult.data || [];

  const [goodsMap, groupMeta, contragentMap] = await Promise.all([
    fetchGoodsMap(supabase, lines.map((line) => line.good_id)),
    fetchGroupMap(supabase),
    fetchContragentMap(supabase, docs.map((doc) => doc.contragent_id))
  ]);

  return { docs, lines, goodsMap, groupMeta, contragentMap };
}

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

    const type = q(req, "type", "summary");
    const dateFrom = q(req, "date_from");
    const dateTo = q(req, "date_to");

    if (type === "inventory_value") {
      const goodsResult = await supabase
        .from("goods")
        .select("id,name,group_id,quantity,avg_cost")
        .gt("quantity", 0)
        .order("name", { ascending: true })
        .limit(10000);
      if (goodsResult.error) throw goodsResult.error;
      const goods = goodsResult.data || [];
      const { byId } = await fetchGroupMap(supabase);

      const rowsByGroup = new Map();
      for (const good of goods) {
        const group = byId.get(good.group_id);
        const key = group?.id || 0;
        const row = rowsByGroup.get(key) || {
          group_id: key || null,
          group_name: group?.name || "Unassigned",
          total_qty: 0,
          total_value: 0
        };
        row.total_qty += Number(good.quantity || 0);
        row.total_value += Number(good.quantity || 0) * Number(good.avg_cost || 0);
        rowsByGroup.set(key, row);
      }

      const rows = [...rowsByGroup.values()]
        .map((row) => ({
          ...row,
          total_qty: round2(row.total_qty),
          total_value: round2(row.total_value)
        }))
        .sort((a, b) => String(a.group_name).localeCompare(String(b.group_name)));

      const grand_total = round2(rows.reduce((sum, row) => sum + row.total_value, 0));
      return ok(res, { type, date_from: dateFrom, date_to: dateTo, rows, grand_total });
    }

    const { docs, lines, goodsMap, groupMeta, contragentMap } = await loadOutgoingRange(
      supabase,
      dateFrom,
      dateTo
    );

    const docsById = new Map(docs.map((doc) => [doc.id, doc]));
    const summary = accumulateTotals(lines);

    if (type === "summary") {
      return ok(res, { type, date_from: dateFrom, date_to: dateTo, summary, count_docs: docs.length });
    }

    if (type === "by_customer") {
      const buckets = new Map();
      for (const line of lines) {
        const doc = docsById.get(line.doc_id);
        const key = doc?.contragent_id || 0;
        const bucket = buckets.get(key) || {
          contragent_id: key || null,
          contragent_name: contragentMap.get(key)?.name || "Walk-in / Unknown",
          lines: []
        };
        bucket.lines.push(line);
        buckets.set(key, bucket);
      }
      const rows = [...buckets.values()]
        .map((bucket) => ({ ...bucket, ...accumulateTotals(bucket.lines) }))
        .map(({ lines: _lines, ...row }) => row)
        .sort((a, b) => b.profit - a.profit);
      return ok(res, { type, date_from: dateFrom, date_to: dateTo, summary, rows });
    }

    if (type === "by_group") {
      const buckets = new Map();
      for (const line of lines) {
        const good = goodsMap.get(line.good_id);
        const groupId = good?.group_id || 0;
        const group = groupMeta.byId.get(groupId);
        const bucket = buckets.get(groupId) || {
          group_id: groupId || null,
          group_name: group?.name || "Unassigned",
          lines: []
        };
        bucket.lines.push(line);
        buckets.set(groupId, bucket);
      }
      const rows = [...buckets.values()]
        .map((bucket) => ({ ...bucket, ...accumulateTotals(bucket.lines) }))
        .map(({ lines: _lines, ...row }) => row)
        .sort((a, b) => b.profit - a.profit);
      return ok(res, { type, date_from: dateFrom, date_to: dateTo, summary, rows });
    }

    if (type === "all") {
      const [byCustomer, byGroup, inventory] = await Promise.all([
        (async () => {
          const fakeReq = { ...req, query: { ...req.query, type: "by_customer" } };
          return fakeReq;
        })(),
        (async () => {
          const fakeReq = { ...req, query: { ...req.query, type: "by_group" } };
          return fakeReq;
        })(),
        (async () => {
          const fakeReq = { ...req, query: { ...req.query, type: "inventory_value" } };
          return fakeReq;
        })()
      ]);
      void byCustomer;
      void byGroup;
      void inventory;
      return ok(res, { type, date_from: dateFrom, date_to: dateTo, summary });
    }

    return ok(res, { type: "summary", date_from: dateFrom, date_to: dateTo, summary, rows: [] });
  });
};
