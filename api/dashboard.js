const { ok, handlerWrapper, methodNotAllowed, requireSession } = require("./_db");

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (!(await requireSession(req, res, supabase))) return;
    if (req.method !== "GET") {
      return methodNotAllowed(res, ["GET"]);
    }

    const today = todayISO();
    const [docsResult, goodsResult, linesResult] = await Promise.all([
      supabase
        .from("documents")
        .select("id")
        .eq("doc_type", 2)
        .eq("doc_date", today),
      supabase
        .from("goods")
        .select("id,quantity,avg_cost")
        .order("id", { ascending: true })
        .limit(5000),
      supabase
        .from("doc_lines")
        .select("doc_id,quantity,price")
        .order("id", { ascending: true })
        .limit(50000)
    ]);

    if (docsResult.error) throw docsResult.error;
    if (goodsResult.error) throw goodsResult.error;
    if (linesResult.error) throw linesResult.error;

    const todayDocIds = new Set((docsResult.data || []).map((d) => d.id));
    let todaysSales = 0;
    for (const line of linesResult.data || []) {
      if (todayDocIds.has(line.doc_id)) {
        todaysSales += Number(line.quantity || 0) * Number(line.price || 0);
      }
    }

    let inventoryValue = 0;
    for (const good of goodsResult.data || []) {
      inventoryValue += Number(good.quantity || 0) * Number(good.avg_cost || 0);
    }

    return ok(res, {
      today: todayISO(),
      stats: {
        todays_sales: Number(todaysSales.toFixed(2)),
        inventory_value: Number(inventoryValue.toFixed(2)),
        total_products: (goodsResult.data || []).length
      }
    });
  });
};
