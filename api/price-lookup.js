const { ok, fail, q, toInt, methodNotAllowed, handlerWrapper } = require("./_db");

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (req.method !== "GET") {
      return methodNotAllowed(res, ["GET"]);
    }

    const contragentId = toInt(q(req, "contragent_id"));
    const goodId = toInt(q(req, "good_id"));
    const docType = toInt(q(req, "doc_type"), 2);
    if (!goodId) return fail(res, 400, "good_id is required");

    const goodResult = await supabase
      .from("goods")
      .select("id,name,group_id")
      .eq("id", goodId)
      .single();
    if (goodResult.error) throw goodResult.error;
    const good = goodResult.data;
    if (!good) return fail(res, 404, "Product not found");

    const groupResult = await supabase
      .from("goods_groups")
      .select("id,name,price_in,price_out")
      .eq("id", good.group_id)
      .single();
    if (groupResult.error) throw groupResult.error;
    const group = groupResult.data;

    let override = null;
    if (docType === 2 && contragentId) {
      const overrideResult = await supabase
        .from("customer_group_prices")
        .select("id,price_out")
        .eq("contragent_id", contragentId)
        .eq("group_id", good.group_id)
        .maybeSingle();
      if (overrideResult.error) throw overrideResult.error;
      override = overrideResult.data || null;
    }

    const price =
      docType === 1
        ? Number(group?.price_in || 0)
        : Number(override?.price_out ?? group?.price_out ?? 0);

    return ok(res, {
      good_id: good.id,
      group_id: good.group_id,
      group_default_price_in: Number(group?.price_in || 0),
      group_default_price_out: Number(group?.price_out || 0),
      override_price_out: override ? Number(override.price_out || 0) : null,
      price
    });
  });
};
