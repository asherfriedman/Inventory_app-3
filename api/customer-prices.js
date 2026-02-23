const {
  ok,
  fail,
  q,
  toInt,
  toNum,
  readJson,
  fetchGroupMap,
  methodNotAllowed,
  handlerWrapper
} = require("./_db");

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (req.method === "GET") {
      const contragentId = toInt(q(req, "contragent_id"));
      if (!contragentId) return fail(res, 400, "contragent_id is required");

      const { data, error } = await supabase
        .from("customer_group_prices")
        .select("id,contragent_id,group_id,price_out")
        .eq("contragent_id", contragentId)
        .order("group_id", { ascending: true });
      if (error) throw error;

      const { byId } = await fetchGroupMap(supabase);
      const overrides = (data || []).map((row) => ({
        ...row,
        group: byId.get(row.group_id) || null
      }));
      return ok(res, { overrides });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const contragentId = toInt(body.contragent_id);
      const groupId = toInt(body.group_id);
      const priceOut = toNum(body.price_out, 0);
      if (!contragentId || !groupId) {
        return fail(res, 400, "contragent_id and group_id are required");
      }

      const { data, error } = await supabase
        .from("customer_group_prices")
        .upsert(
          {
            contragent_id: contragentId,
            group_id: groupId,
            price_out: priceOut
          },
          { onConflict: "contragent_id,group_id" }
        )
        .select("*")
        .single();
      if (error) throw error;
      return ok(res, { override: data });
    }

    if (req.method === "DELETE") {
      const body = req.body ? await readJson(req).catch(() => ({})) : {};
      const id = toInt(q(req, "id"), toInt(body.id));

      if (id) {
        const { error } = await supabase.from("customer_group_prices").delete().eq("id", id);
        if (error) throw error;
        return ok(res, { deleted: id });
      }

      const contragentId = toInt(q(req, "contragent_id"), toInt(body.contragent_id));
      const groupId = toInt(q(req, "group_id"), toInt(body.group_id));
      if (!contragentId || !groupId) {
        return fail(res, 400, "Provide id or contragent_id + group_id");
      }
      const { error } = await supabase
        .from("customer_group_prices")
        .delete()
        .eq("contragent_id", contragentId)
        .eq("group_id", groupId);
      if (error) throw error;
      return ok(res, { deleted: { contragent_id: contragentId, group_id: groupId } });
    }

    return methodNotAllowed(res, ["GET", "POST", "DELETE"]);
  });
};
