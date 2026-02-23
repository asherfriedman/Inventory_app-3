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
      const { tree, byId } = await fetchGroupMap(supabase);
      return ok(res, {
        groups: Array.from(byId.values()).map(({ children, ...rest }) => rest),
        tree
      });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body.name || !String(body.name).trim()) {
        return fail(res, 400, "Group name is required");
      }
      const payload = {
        name: String(body.name).trim(),
        parent_id: toInt(body.parent_id, null),
        price_in: toNum(body.price_in, 0),
        price_out: toNum(body.price_out, 0)
      };
      const { data, error } = await supabase
        .from("goods_groups")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return ok(res, { group: data });
    }

    if (req.method === "PUT") {
      const body = await readJson(req);
      const id = toInt(body.id);
      if (!id) return fail(res, 400, "id is required");

      const patch = {};
      if (body.name != null) patch.name = String(body.name).trim();
      if (body.parent_id !== undefined) patch.parent_id = toInt(body.parent_id, null);
      if (body.price_in !== undefined) patch.price_in = toNum(body.price_in, 0);
      if (body.price_out !== undefined) patch.price_out = toNum(body.price_out, 0);

      const { data, error } = await supabase
        .from("goods_groups")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return ok(res, { group: data });
    }

    if (req.method === "DELETE") {
      const body = req.body ? await readJson(req).catch(() => ({})) : {};
      const id = toInt(q(req, "id"), toInt(body.id));
      if (!id) return fail(res, 400, "id is required");

      const childCheck = await supabase
        .from("goods_groups")
        .select("id", { count: "exact", head: true })
        .eq("parent_id", id);
      if (childCheck.error) throw childCheck.error;
      if ((childCheck.count || 0) > 0) {
        return fail(res, 400, "Delete child groups first");
      }

      const goodsCheck = await supabase
        .from("goods")
        .select("id", { count: "exact", head: true })
        .eq("group_id", id);
      if (goodsCheck.error) throw goodsCheck.error;
      if ((goodsCheck.count || 0) > 0) {
        return fail(res, 400, "Delete or move goods in this group first");
      }

      const { error } = await supabase.from("goods_groups").delete().eq("id", id);
      if (error) throw error;
      return ok(res, { deleted: id });
    }

    return methodNotAllowed(res, ["GET", "POST", "PUT", "DELETE"]);
  });
};
