const {
  ok,
  fail,
  q,
  readJson,
  sha256,
  ensureSettingsRow,
  methodNotAllowed,
  handlerWrapper,
  createSession
} = require("./_db");

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

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

    if (req.method === "DELETE") {
      // Logout: delete session token
      const auth = req.headers.authorization || req.headers.Authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (token) {
        await supabase.from("sessions").delete().eq("token", token);
      }
      return ok(res, { ok: true });
    }

    if (req.method !== "POST") {
      return methodNotAllowed(res, ["GET", "POST", "DELETE"]);
    }

    const body = await readJson(req);
    const pin = String(body.pin || "").trim();
    const setup = Boolean(body.setup);

    if (!pin) return fail(res, 400, "PIN is required");
    if (pin.length < 4) return fail(res, 400, "PIN must be at least 4 digits");

    await ensureSettingsRow(supabase);
    const settingsResult = await supabase
      .from("app_settings")
      .select("id,pin_hash,failed_attempts,lockout_until")
      .order("id", { ascending: true })
      .limit(1)
      .single();
    if (settingsResult.error) throw settingsResult.error;
    const settings = settingsResult.data;

    // Check lockout
    if (settings.lockout_until && new Date(settings.lockout_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(settings.lockout_until) - new Date()) / 60000
      );
      return fail(res, 429, `Too many attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`);
    }

    if (!settings.pin_hash) {
      if (!setup) {
        return ok(res, { ok: false, setup_required: true });
      }
      const update = await supabase
        .from("app_settings")
        .update({ pin_hash: sha256(pin), failed_attempts: 0, lockout_until: null })
        .eq("id", settings.id)
        .select("id")
        .single();
      if (update.error) throw update.error;

      const session = await createSession(supabase);
      return ok(res, { ok: true, setup_complete: true, token: session.token, expires_at: session.expires_at });
    }

    const isValid = settings.pin_hash === sha256(pin);

    if (!isValid) {
      const attempts = (settings.failed_attempts || 0) + 1;
      const patch = { failed_attempts: attempts };
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        patch.lockout_until = new Date(
          Date.now() + LOCKOUT_MINUTES * 60 * 1000
        ).toISOString();
      }
      await supabase
        .from("app_settings")
        .update(patch)
        .eq("id", settings.id);
      return ok(res, { ok: false });
    }

    // Successful login: reset attempts, create session
    await supabase
      .from("app_settings")
      .update({ failed_attempts: 0, lockout_until: null })
      .eq("id", settings.id);

    const session = await createSession(supabase);
    return ok(res, { ok: true, token: session.token, expires_at: session.expires_at });
  });
};
