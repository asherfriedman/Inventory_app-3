const {
  ok,
  fail,
  q,
  toInt,
  likeTerm,
  readJson,
  methodNotAllowed,
  handlerWrapper,
  requireSession
} = require("./_db");

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (!(await requireSession(req, res, supabase))) return;
    if (req.method === "GET") {
      const id = toInt(q(req, "id"));
      if (id) {
        const { data, error } = await supabase
          .from("contragents")
          .select("*")
          .eq("id", id)
          .single();
        if (error) throw error;
        return ok(res, { contragent: data });
      }

      const type = q(req, "type");
      const search = q(req, "search");

      let query = supabase
        .from("contragents")
        .select("id,name,phone,email,address,type,notes")
        .order("name", { ascending: true })
        .limit(2000);

      if (type !== null) query = query.eq("type", toInt(type, 0));
      if (search) {
        const asNum = Number(search);
        if (Number.isInteger(asNum) && asNum > 0) {
          query = query.or(`id.eq.${asNum},name.ilike.${likeTerm(search)}`);
        } else {
          query = query.ilike("name", likeTerm(search));
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      return ok(res, { contragents: data || [] });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body.name || !String(body.name).trim()) {
        return fail(res, 400, "Name is required");
      }
      const payload = {
        name: String(body.name).trim(),
        phone: body.phone ? String(body.phone).trim() : null,
        email: body.email ? String(body.email).trim() : null,
        address: body.address ? String(body.address).trim() : null,
        type: toInt(body.type, 1),
        notes: body.notes ? String(body.notes).trim() : null
      };
      const { data, error } = await supabase
        .from("contragents")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw error;
      return ok(res, { contragent: data });
    }

    if (req.method === "PUT") {
      const body = await readJson(req);
      const id = toInt(body.id);
      if (!id) return fail(res, 400, "id is required");
      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.phone !== undefined) patch.phone = body.phone ? String(body.phone).trim() : null;
      if (body.email !== undefined) patch.email = body.email ? String(body.email).trim() : null;
      if (body.address !== undefined) patch.address = body.address ? String(body.address).trim() : null;
      if (body.type !== undefined) patch.type = toInt(body.type, 1);
      if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;

      const { data, error } = await supabase
        .from("contragents")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return ok(res, { contragent: data });
    }

    if (req.method === "DELETE") {
      const body = req.body ? await readJson(req).catch(() => ({})) : {};
      const id = toInt(q(req, "id"), toInt(body.id));
      if (!id) return fail(res, 400, "id is required");

      const docCheck = await supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("contragent_id", id);
      if (docCheck.error) throw docCheck.error;
      if ((docCheck.count || 0) > 0) {
        return fail(res, 400, "Cannot delete contragent with document history");
      }

      const { error } = await supabase.from("contragents").delete().eq("id", id);
      if (error) throw error;
      return ok(res, { deleted: id });
    }

    return methodNotAllowed(res, ["GET", "POST", "PUT", "DELETE"]);
  });
};
