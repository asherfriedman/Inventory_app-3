const {
  ok,
  fail,
  q,
  toInt,
  toNum,
  readJson,
  fetchGroupMap,
  methodNotAllowed,
  handlerWrapper,
  requireSession
} = require("./_db");

function buildGroupPath(groupId, groupMap) {
  if (!groupId || !groupMap.has(groupId)) return "";
  const names = [];
  let current = groupMap.get(groupId);
  while (current) {
    names.unshift(current.name);
    current = current.parent_id ? groupMap.get(current.parent_id) : null;
  }
  return names.join(" > ");
}

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (!(await requireSession(req, res, supabase))) return;
    if (req.method === "GET") {
      const id = toInt(q(req, "id"));
      if (id) {
        const { data, error } = await supabase
          .from("goods")
          .select("*")
          .eq("id", id)
          .single();
        if (error) throw error;
        return ok(res, { good: data });
      }

      const groupId = toInt(q(req, "group_id"));

      let query = supabase
        .from("goods")
        .select("id,barcode,name,group_id,avg_cost,quantity,measure")
        .order("name", { ascending: true })
        .limit(1000);

      if (groupId) query = query.eq("group_id", groupId);

      const { data, error } = await query;
      if (error) throw error;

      const { byId } = await fetchGroupMap(supabase);
      const goods = (data || []).map((item) => ({
        ...item,
        group: byId.get(item.group_id) || null,
        group_path: buildGroupPath(item.group_id, byId)
      }));
      return ok(res, { goods });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body.name || !String(body.name).trim()) {
        return fail(res, 400, "Product name is required");
      }
      const payload = {
        barcode: body.barcode ? String(body.barcode).trim() : null,
        name: String(body.name).trim(),
        group_id: toInt(body.group_id, null),
        avg_cost: body.avg_cost !== undefined ? toNum(body.avg_cost, 0) : 0,
        quantity: body.quantity !== undefined ? toNum(body.quantity, 0) : 0,
        measure: body.measure ? String(body.measure).trim() : null
      };
      const { data, error } = await supabase
        .from("goods")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return ok(res, { good: data });
    }

    if (req.method === "PUT") {
      const body = await readJson(req);
      const id = toInt(body.id);
      if (!id) return fail(res, 400, "id is required");

      const patch = {};
      if (body.barcode !== undefined) patch.barcode = body.barcode ? String(body.barcode).trim() : null;
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.group_id !== undefined) patch.group_id = toInt(body.group_id, null);
      if (body.avg_cost !== undefined) patch.avg_cost = toNum(body.avg_cost, 0);
      if (body.quantity !== undefined) patch.quantity = toNum(body.quantity, 0);
      if (body.measure !== undefined) patch.measure = body.measure ? String(body.measure).trim() : null;

      const { data, error } = await supabase
        .from("goods")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return ok(res, { good: data });
    }

    if (req.method === "DELETE") {
      const body = req.body ? await readJson(req).catch(() => ({})) : {};
      const id = toInt(q(req, "id"), toInt(body.id));
      if (!id) return fail(res, 400, "id is required");

      const lineCheck = await supabase
        .from("doc_lines")
        .select("id", { count: "exact", head: true })
        .eq("good_id", id);
      if (lineCheck.error) throw lineCheck.error;
      if ((lineCheck.count || 0) > 0) {
        return fail(res, 400, "Cannot delete product with document history");
      }

      const { error } = await supabase.from("goods").delete().eq("id", id);
      if (error) throw error;
      return ok(res, { deleted: id });
    }

    return methodNotAllowed(res, ["GET", "POST", "PUT", "DELETE"]);
  });
};
