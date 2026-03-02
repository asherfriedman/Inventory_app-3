const {
  ok,
  q,
  toInt,
  fetchGroupMap,
  fetchGoodsMap,
  methodNotAllowed,
  handlerWrapper,
  requireSession
} = require("./_db");

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (!(await requireSession(req, res, supabase))) return;
    if (req.method !== "GET") {
      return methodNotAllowed(res, ["GET"]);
    }

    const contragentId = toInt(q(req, "contragent_id"));
    const limit = Math.min(Math.max(toInt(q(req, "limit"), 10), 1), 50);
    if (!contragentId) {
      return ok(res, { items: [] });
    }

    const docsResult = await supabase
      .from("documents")
      .select("id,doc_date")
      .eq("doc_type", 2)
      .eq("contragent_id", contragentId)
      .order("doc_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (docsResult.error) throw docsResult.error;

    const docs = docsResult.data || [];
    if (!docs.length) return ok(res, { items: [] });

    const docIds = docs.map((doc) => Number(doc.id)).filter(Boolean);
    const docDateById = new Map(docs.map((doc) => [Number(doc.id), doc.doc_date || null]));
    const docOrder = new Map(docs.map((doc, index) => [Number(doc.id), index]));

    const linesResult = await supabase
      .from("doc_lines")
      .select("id,doc_id,good_id,quantity,price")
      .in("doc_id", docIds)
      .order("id", { ascending: false });
    if (linesResult.error) throw linesResult.error;

    const lines = (linesResult.data || [])
      .filter((line) => Number(line.good_id) > 0 && Number(line.quantity || 0) > 0)
      .sort((a, b) => {
        const orderA = docOrder.get(Number(a.doc_id)) ?? Number.MAX_SAFE_INTEGER;
        const orderB = docOrder.get(Number(b.doc_id)) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return Number(b.id || 0) - Number(a.id || 0);
      });

    if (!lines.length) return ok(res, { items: [] });

    const recentByGood = [];
    const seen = new Set();
    for (const line of lines) {
      const goodId = Number(line.good_id);
      if (!goodId || seen.has(goodId)) continue;
      seen.add(goodId);
      recentByGood.push(line);
      if (recentByGood.length >= limit) break;
    }

    const goodsMap = await fetchGoodsMap(
      supabase,
      recentByGood.map((line) => Number(line.good_id))
    );
    const { byId: groupsById } = await fetchGroupMap(supabase);

    const items = recentByGood.map((line) => {
      const good = goodsMap.get(Number(line.good_id)) || null;
      const group = good?.group_id ? groupsById.get(Number(good.group_id)) : null;
      return {
        good_id: Number(line.good_id),
        good_name: good?.name || `#${line.good_id}`,
        group_name: group?.name || "",
        last_price: Number(line.price || 0),
        last_qty: Number(line.quantity || 0),
        last_date: docDateById.get(Number(line.doc_id)) || null,
        doc_id: Number(line.doc_id)
      };
    });

    return ok(res, { items });
  });
};
