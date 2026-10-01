// Edge Function "sugestoes": sugestões de melhoria da ferramenta.
//
// Estúdios (sessão do painel, header X-Panel-Session):
//   GET  /sugestoes/api/suggestions → sugestões do próprio estúdio (com status e resposta)
//   POST /sugestoes/api/suggestions → { kind: melhoria|problema|ideia, text, author?, context? }
//
// Administrador (Caetano; senha própria em fb_admin.admin_key_hash, header X-Admin-Session):
//   POST   /sugestoes/api/admin/login           → { password } → { session }
//   POST   /sugestoes/api/admin/logout
//   POST   /sugestoes/api/admin/password        → { current, next }
//   GET    /sugestoes/api/admin/suggestions     → todas as sugestões, de todos os estúdios
//   PATCH  /sugestoes/api/admin/suggestions/:id → { status?, reply?, priority?, internal_note? }
//   DELETE /sugestoes/api/admin/suggestions/:id
//
// Deploy com verify_jwt = false (o acesso é controlado pelas sessões acima).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Panel-Session, X-Admin-Session",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function hex(buf: ArrayBuffer | Uint8Array) {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
function newId(bytes = 24) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
async function pbkdf2(password: string, saltHex: string, iter: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
async function hashPassword(pw: string) {
  const salt = newId(16), iter = 100000;
  return "pbkdf2$" + iter + "$" + salt + "$" + (await pbkdf2(pw, salt, iter));
}
async function checkPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [kind, iter, salt, h] = stored.split("$");
  if (kind !== "pbkdf2") return false;
  const got = await pbkdf2(pw, salt, +iter);
  let diff = got.length ^ h.length;
  for (let i = 0; i < Math.min(got.length, h.length); i++) diff |= got.charCodeAt(i) ^ h.charCodeAt(i);
  return diff === 0;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function studioOf(req: Request): Promise<string | null> {
  const id = req.headers.get("x-panel-session");
  if (!id || !/^[0-9a-f]{16,64}$/.test(id)) return null;
  const { data } = await sb.from("fb_panel_sessions").select("studio_id, expires_at").eq("id", id).maybeSingle();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  return data.studio_id;
}
async function isAdmin(req: Request): Promise<boolean> {
  const id = req.headers.get("x-admin-session");
  if (!id || !/^[0-9a-f]{48}$/.test(id)) return false;
  const { data } = await sb.from("fb_admin_sessions").select("expires_at").eq("id", id).maybeSingle();
  return !!data && new Date(data.expires_at) > new Date();
}

const KINDS = ["melhoria", "problema", "ideia"];
const STATUSES = ["recebida", "planejada", "em_andamento", "feita", "nao_vamos_fazer"];
const PRIORITIES = ["alta", "media", "baixa"];
const DAY_LIMIT = 20;              // sugestões por estúdio a cada 24 h
const MAX_FAILS = 8, LOCK_MIN = 15; // login do admin: trava 15 min após 8 erros seguidos
function clean(s: unknown, max: number) { return String(s ?? "").replace(/\u0000/g, "").trim().slice(0, max); }
function out(r: any) {
  return { id: r.id, kind: r.kind, text: r.text, author: r.author, status: r.status, reply: r.reply, createdAt: r.created_at, updatedAt: r.updated_at };
}
function outAdmin(r: any, names: Record<string, string>) {
  return { ...out(r), studio: r.studio_id, studioName: names[r.studio_id] || r.studio_id, priority: r.priority, internalNote: r.internal_note, context: r.context };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const p = new URL(req.url).pathname;

  // ================= administrador =================
  if (p.includes("/api/admin/")) {
    if (p.endsWith("/api/admin/login") && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const { data: ad } = await sb.from("fb_admin").select("admin_key_hash, admin_fail_count, admin_fail_at").eq("id", 1).single();
      const locked = ad.admin_fail_count >= MAX_FAILS && ad.admin_fail_at && Date.now() - new Date(ad.admin_fail_at).getTime() < LOCK_MIN * 60_000;
      if (locked) { await sleep(900); return json({ error: "bloqueado" }, 429); }
      if (!(await checkPassword(String(b.password || ""), ad.admin_key_hash))) {
        const recent = ad.admin_fail_at && Date.now() - new Date(ad.admin_fail_at).getTime() < LOCK_MIN * 60_000;
        await sb.from("fb_admin").update({ admin_fail_count: (recent ? ad.admin_fail_count : 0) + 1, admin_fail_at: new Date().toISOString() }).eq("id", 1);
        await sleep(900);
        return json({ error: "invalid_login" }, 401);
      }
      await sb.from("fb_admin").update({ admin_fail_count: 0, admin_fail_at: null }).eq("id", 1);
      await sb.from("fb_admin_sessions").delete().lt("expires_at", new Date().toISOString());
      const session = newId(24);
      await sb.from("fb_admin_sessions").insert({ id: session });
      return json({ session });
    }

    if (!(await isAdmin(req))) return json({ error: "no_session" }, 401);

    if (p.endsWith("/api/admin/logout") && req.method === "POST") {
      await sb.from("fb_admin_sessions").delete().eq("id", req.headers.get("x-admin-session"));
      return json({ ok: true });
    }
    if (p.endsWith("/api/admin/password") && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const next = String(b.next || "");
      if (next.length < 12) return json({ error: "too_short" }, 400);
      const { data: ad } = await sb.from("fb_admin").select("admin_key_hash").eq("id", 1).single();
      if (!(await checkPassword(String(b.current || ""), ad.admin_key_hash))) { await sleep(900); return json({ error: "wrong_password" }, 403); }
      await sb.from("fb_admin").update({ admin_key_hash: await hashPassword(next) }).eq("id", 1);
      // derruba as outras sessões
      await sb.from("fb_admin_sessions").delete().neq("id", req.headers.get("x-admin-session"));
      return json({ ok: true });
    }
    if (p.endsWith("/api/admin/suggestions") && req.method === "GET") {
      const [{ data }, { data: st }] = await Promise.all([
        sb.from("fb_suggestions").select("*").order("created_at", { ascending: false }).limit(1000),
        sb.from("fb_studios").select("id, name"),
      ]);
      const names: Record<string, string> = {};
      (st || []).forEach((s: any) => { names[s.id] = s.name; });
      return json({ suggestions: (data || []).map((r: any) => outAdmin(r, names)), studios: (st || []).map((s: any) => ({ id: s.id, name: s.name })) });
    }
    const m = p.match(/\/api\/admin\/suggestions\/([0-9a-f-]{36})$/);
    if (m && req.method === "PATCH") {
      const b = await req.json().catch(() => ({}));
      const upd: Record<string, unknown> = {};
      if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return json({ error: "invalid_status" }, 400); upd.status = b.status; }
      if (b.priority !== undefined) { if (b.priority !== null && !PRIORITIES.includes(b.priority)) return json({ error: "invalid_priority" }, 400); upd.priority = b.priority; }
      if (b.reply !== undefined) upd.reply = clean(b.reply, 1000) || null;
      if (b.internal_note !== undefined) upd.internal_note = clean(b.internal_note, 4000) || null;
      if (!Object.keys(upd).length) return json({ error: "invalid" }, 400);
      const { data } = await sb.from("fb_suggestions").update(upd).eq("id", m[1]).select("*").maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      const { data: st } = await sb.from("fb_studios").select("id, name").eq("id", data.studio_id).maybeSingle();
      return json(outAdmin(data, st ? { [st.id]: st.name } : {}));
    }
    if (m && req.method === "DELETE") {
      await sb.from("fb_suggestions").delete().eq("id", m[1]);
      return json({ deleted: true });
    }
    return json({ error: "not_found" }, 404);
  }

  // ================= estúdios =================
  if (!p.endsWith("/api/suggestions")) return json({ error: "not_found" }, 404);
  const studio = await studioOf(req);
  if (!studio) return json({ error: "no_session" }, 401);

  if (req.method === "GET") {
    const { data } = await sb.from("fb_suggestions").select("id, kind, text, author, status, reply, created_at, updated_at")
      .eq("studio_id", studio).order("created_at", { ascending: false }).limit(100);
    return json({ suggestions: (data || []).map(out) });
  }

  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const kind = KINDS.includes(b.kind) ? b.kind : "melhoria";
    const text = clean(b.text, 2000);
    if (text.length < 3) return json({ error: "texto_curto" }, 400);
    const author = clean(b.author, 80) || null;
    const c = b.context && typeof b.context === "object" ? b.context : {};
    const context = {
      project: clean(c.project, 80) || null, tab: clean(c.tab, 20) || null,
      screen: clean(c.screen, 20) || null, ua: clean(req.headers.get("user-agent"), 200) || null,
    };
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await sb.from("fb_suggestions").select("id", { count: "exact", head: true }).eq("studio_id", studio).gt("created_at", since);
    if ((count || 0) >= DAY_LIMIT) return json({ error: "limite_diario" }, 429);
    const { data, error } = await sb.from("fb_suggestions").insert({ studio_id: studio, kind, text, author, context })
      .select("id, kind, text, author, status, reply, created_at, updated_at").single();
    if (error) return json({ error: "erro" }, 500);
    return json(out(data), 201);
  }

  return json({ error: "not_found" }, 404);
});
