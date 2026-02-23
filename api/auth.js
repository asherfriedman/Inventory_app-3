const {
  ok,
  fail,
  q,
  readJson,
  sha256,
  ensureSettingsRow,
  methodNotAllowed,
  handlerWrapper
} = require("./_db");

module.exports = async function handler(req, res) {
  return handlerWrapper(req, res, async (_req, _res, supabase) => {
    if (req.method === "GET") {
      await ensureSettingsRow(supabase);
      const { data, error } = await supabase
        .from("app_settings")
        .select("id,pin_hash")
        .order("id", { ascending: true })
        .limit(1)
        .single();
      if (error) throw error;
      return ok(res, { configured: Boolean(data?.pin_hash) });
    }

    if (req.method !== "POST") {
      return methodNotAllowed(res, ["GET", "POST"]);
    }

    const body = await readJson(req);
    const pin = String(body.pin || "").trim();
    const setup = Boolean(body.setup);

    if (!pin) return fail(res, 400, "PIN is required");
    if (pin.length < 4) return fail(res, 400, "PIN must be at least 4 digits");

    await ensureSettingsRow(supabase);
    const settingsResult = await supabase
      .from("app_settings")
      .select("id,pin_hash")
      .order("id", { ascending: true })
      .limit(1)
      .single();
    if (settingsResult.error) throw settingsResult.error;
    const settings = settingsResult.data;

    if (!settings.pin_hash) {
      if (!setup) {
        return ok(res, { ok: false, setup_required: true });
      }
      const update = await supabase
        .from("app_settings")
        .update({ pin_hash: sha256(pin) })
        .eq("id", settings.id)
        .select("id")
        .single();
      if (update.error) throw update.error;
      return ok(res, { ok: true, setup_complete: true });
    }

    const isValid = settings.pin_hash === sha256(pin);
    return ok(res, { ok: isValid });
  });
};
