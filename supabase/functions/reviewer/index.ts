// Edge Function "reviewer": serve o snippet e a API do revisor.
//
//   GET  /reviewer/loader.js          → snippet (colado no site)
//   GET  /reviewer/overlay.js         → interface do revisor
//   GET  /reviewer/gate.js            → janela do código de acesso / avisos (revisão pausada, link inválido)
//   GET  /reviewer/api/activate       → decide se o revisor ativa (?project=… ou ?studio=…; &pass=… para convites)
//   POST /reviewer/api/verify         → { token, code } confere o código do convite → { pass, session }
//   GET  /reviewer/api/comments       → lista comentários (?path=/rota ou ?all=1)
//   POST /reviewer/api/comments       → cria comentário
//   PATCH /reviewer/api/comments/:id  → muda status (open/resolved) ou texto (só o autor)
//   DELETE /reviewer/api/comments/:id → apaga (só o autor)
//   POST /reviewer/api/comments/:id/replies → responde um comentário
//   POST /reviewer/api/comments/:id/screenshot → guarda o print do comentário (Storage fb-shots)
//   GET/POST /reviewer/api/approvals  → aprovações de página (quem aprovou e quando)
//   DELETE /reviewer/api/approvals/:id → desfaz a própria aprovação
//   GET  /reviewer/vendor/modern-screenshot.js → biblioteca de captura (tabela fb_assets)
//
// Deploy com verify_jwt = false (o acesso é controlado aqui dentro).
// loader.js, overlay.js e gate.js ficam na tabela fb_assets (publicados com publish-assets.js).
import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Review-Session, X-Author-Key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
// Cache curto dos arquivos do snippet (lidos da tabela fb_assets)
const assetCache: Record<string, { code: string; v: string; at: number }> = {};
async function assetEntry(name: string) {
  const hit = assetCache[name];
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const { data } = await sb.from("fb_assets").select("content, updated_at").eq("name", name).maybeSingle();
  if (!data) return hit || null;
  const entry = { code: data.content as string, v: String(new Date(data.updated_at).getTime()), at: Date.now() };
  assetCache[name] = entry;
  return entry;
}
async function asset(name: string): Promise<string | null> {
  const e = await assetEntry(name);
  return e ? e.code : null;
}

function js(code: string, maxAge = 60) {
  return new Response(code, {
    headers: { ...CORS, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=" + maxAge },
  });
}

// "*.webflow.io" casa "meusite.webflow.io"; o curinga não atravessa pontos.
function hostMatches(host: string, pattern: string) {
  const esc = pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\-]/g, "\\$&"));
  return new RegExp("^" + esc.join("[a-z0-9-]+") + "$", "i").test(host);
}

function newId(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// hasCode: convite por email (precisa de código ou de um passe do navegador para abrir)
type Who = { name: string; org: string | null; email: string | null; token: string; hasCode: boolean; lockedUntil: string | null } | null;

async function reviewerByToken(token: string | null, projectId?: string): Promise<Who> {
  if (!token) return null;
  let q = sb.from("fb_reviewers").select("token, name, org, email, active, project_id, code_hash, code_locked_until").eq("token", token);
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q.maybeSingle();
  if (!data || !data.active) return null;
  const locked = data.code_locked_until && new Date(data.code_locked_until) > new Date() ? data.code_locked_until : null;
  return { name: data.name, org: data.org, email: data.email, token: data.token, hasCode: !!data.code_hash, lockedUntil: locked };
}
function publicWho(w: Who) { return w ? { name: w.name, org: w.org } : null; }

// Passe do navegador (convite): válido, deste link e dentro do prazo
async function passValid(token: string, pass: string) {
  if (!/^[0-9a-f]{32,64}$/.test(pass)) return false;
  const h = await sha256hex(pass);
  const { data } = await sb.from("fb_reviewer_passes").select("token, expires_at").eq("pass_hash", h).maybeSingle();
  if (!data || data.token !== token || new Date(data.expires_at) < new Date()) return false;
  await sb.from("fb_reviewer_passes").update({ last_used_at: new Date().toISOString() }).eq("pass_hash", h);
  return true;
}

// Autor de um comentário/resposta: link pessoal manda; senão o nome enviado
function authorOf(w: Who, b: any) {
  const author = w ? (w.org ? w.name + " · " + w.org : w.name) : String(b.author || "Convidado").slice(0, 100);
  const email = w ? w.email : (typeof b.authorEmail === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.authorEmail) ? b.authorEmail.slice(0, 200) : null);
  return { author, email };
}
function shapeReplies(list: any[] | null) {
  return (list || []).map((r) => ({ id: r.id, text: r.text, author: r.author, createdAt: r.created_at }))
    .sort((a, b) => a.createdAt < b.createdAt ? -1 : 1);
}

// Dono: hash da chave que o navegador de quem escreveu guarda em cookie (X-Author-Key)
async function authorKeyHash(req: Request): Promise<string | null> {
  const k = req.headers.get("x-author-key") || "";
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(k)) return null;
  return await sha256hex(k);
}
function isOwner(c: any, who: Who, keyHash: string | null) {
  if (who && c.reviewer_token && c.reviewer_token === who.token) return true;
  return !!(keyHash && c.author_key_hash && c.author_key_hash === keyHash);
}

// Sessão → projeto (+ pessoa, quando veio por link pessoal)
async function sessionInfo(req: Request): Promise<{ projectId: string; who: Who } | null> {
  const id = req.headers.get("x-review-session");
  if (!id) return null;
  const { data } = await sb.from("fb_sessions").select("project_id, expires_at, reviewer_token").eq("id", id).maybeSingle();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  return { projectId: data.project_id, who: await reviewerByToken(data.reviewer_token) };
}

// ---------------- Nome do projeto pela <title> da home ----------------
// Projetos criados sozinhos nascem com o domínio como nome; em seguida, sem atrasar
// a ativação, o servidor lê a <title> de https://<host>/ e troca o nome.
// Ex.: "Home | Lysch" → "Lysch". Título vazio ou genérico mantém o domínio.
const GENERIC_TITLES = new Set(["home", "homepage", "home page", "inicio", "início", "pagina inicial", "página inicial",
  "index", "welcome", "bem-vindo", "bem vindo", "untitled", "sem titulo", "sem título", "my framer site", "new page"]);
function decodeEntities(s: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", middot: "·", bull: "•" };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|middot|bull);/g, (_, n) => named[n]);
}
function nameFromTitle(raw: string | null, host: string): string | null {
  if (!raw) return null;
  const t = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!t) return null;
  const h = host.toLowerCase();
  const hostBase = h.split(".")[0];
  const parts = t.split(/\s+[|–—·•]\s+|\s+-\s+|\s*\|\s*|:\s+/).map((s) => s.trim()).filter(Boolean);
  const good = parts.filter((s) => { const k = s.toLowerCase(); return !GENERIC_TITLES.has(k) && k !== h && k !== hostBase; });
  return good.length ? good[0].slice(0, 60) : null;
}
const titleTried = new Map<string, number>(); // host → quando tentou (evita buscar a home a cada visita)
async function nameProjectFromHome(projectId: string, host: string) {
  const last = titleTried.get(host);
  if (last && Date.now() - last < 10 * 60_000) return;
  titleTried.set(host, Date.now());
  try {
    const r = await fetch("https://" + host + "/", {
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FeedbackReviewer/1.0)", Accept: "text/html" },
    });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return;
    const html = (await r.text()).slice(0, 200_000);
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const name = nameFromTitle(m ? m[1] : null, host);
    if (!name) return;
    // só troca se o nome ainda é o domínio (não sobrescreve nome dado à mão)
    await sb.from("fb_projects").update({ name }).eq("id", projectId).eq("name", host);
  } catch (_) { /* sem título: fica o domínio */ }
}
function inBackground(p: Promise<unknown>) {
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
  else p.catch(() => {});
}

// Estúdio → projeto do domínio. Links (pessoal/genérico) valem em qualquer domínio;
// sem link, o domínio precisa estar na lista do estúdio (ex.: *.webflow.io) e o
// projeto é criado na primeira visita.
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48); }
async function resolveStudioProject(studioId: string, host: string, token: string, session: string):
  Promise<{ projectId: string } | { error: string }> {
  const { data: studio } = await sb.from("fb_studios").select("*").eq("id", studioId).maybeSingle();
  if (!studio || !studio.active) return { error: "unknown_studio" };
  if (token) {
    const { data: rv } = await sb.from("fb_reviewers").select("project_id").eq("token", token).eq("active", true).maybeSingle();
    if (rv) return { projectId: rv.project_id };
    const { data: pt } = await sb.from("fb_projects").select("id").eq("studio_id", studioId).contains("review_tokens", [token]).maybeSingle();
    if (pt) return { projectId: pt.id };
  }
  if (session) {
    const { data: se } = await sb.from("fb_sessions").select("project_id").eq("id", session).maybeSingle();
    if (se) {
      const { data: sp } = await sb.from("fb_projects").select("id, studio_id, domains").eq("id", se.project_id).maybeSingle();
      if (sp && sp.studio_id === studioId && (sp.domains as string[]).includes(host)) return { projectId: sp.id };
    }
  }
  if (!host || !(studio.allowed_domains as string[]).some((d) => hostMatches(host, d))) return { error: "domain_not_allowed" };
  const { data: found } = await sb.from("fb_projects").select("id").eq("studio_id", studioId).contains("domains", [host]).maybeSingle();
  if (found) return { projectId: found.id };
  const id = "prj_" + slug(host.replace(/\.(webflow\.io|framer\.app|framer\.website)$/, ""));
  const { error } = await sb.from("fb_projects").insert({
    id, name: host, domains: [host], review_tokens: ["tok_" + newId(9)], studio_id: studioId,
  });
  if (error && !String(error.message).includes("duplicate")) return { error: "create_failed" };
  return { projectId: id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const p = url.pathname;

  if (p.endsWith("/vendor/modern-screenshot.js")) {
    const code = await asset("modern-screenshot.js");
    return code ? js(code, 86400) : json({ error: "asset_missing" }, 503);
  }
  if (p.endsWith("/loader.js") || p.endsWith("/overlay.js") || p.endsWith("/gate.js")) {
    const code = await asset(p.slice(p.lastIndexOf("/") + 1));
    return code ? js(code) : json({ error: "asset_missing" }, 503);
  }

  // ---------------- Código do convite ----------------
  if (p.endsWith("/api/verify") && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const token = String(b.token || "").slice(0, 120);
    const code = String(b.code || "").replace(/\D/g, "");
    const { data: rv } = await sb.from("fb_reviewers")
      .select("token, project_id, active, code_hash, code_fails, code_locked_until, verified_at").eq("token", token).maybeSingle();
    if (!rv || !rv.active || !rv.code_hash) return json({ error: "invalid_link" }, 404);
    const { data: pj } = await sb.from("fb_projects").select("paused").eq("id", rv.project_id).maybeSingle();
    if (!pj) return json({ error: "invalid_link" }, 404);
    if (pj.paused) return json({ error: "paused" }, 403);
    if (rv.code_locked_until && new Date(rv.code_locked_until) > new Date()) return json({ error: "locked", lockedUntil: rv.code_locked_until }, 429);
    const good = code.length === 6 && safeEq(await sha256hex(token + ":" + code), rv.code_hash);
    if (!good) {
      await new Promise((r) => setTimeout(r, 400));
      const fails = (rv.code_fails || 0) + 1;
      if (fails >= 5) { // 5 erros seguidos: trava este link por 15 minutos
        const until = new Date(Date.now() + 15 * 60_000).toISOString();
        await sb.from("fb_reviewers").update({ code_fails: 0, code_locked_until: until }).eq("token", token);
        return json({ error: "locked", lockedUntil: until }, 429);
      }
      await sb.from("fb_reviewers").update({ code_fails: fails }).eq("token", token);
      return json({ error: "wrong_code", left: 5 - fails }, 401);
    }
    const pass = newId(24);
    await sb.from("fb_reviewer_passes").insert({ pass_hash: await sha256hex(pass), token });
    await sb.from("fb_reviewers").update({ code_fails: 0, code_locked_until: null, verified_at: rv.verified_at || new Date().toISOString() }).eq("token", token);
    const session = newId();
    await sb.from("fb_sessions").insert({ id: session, project_id: rv.project_id, via: "person", reviewer_token: token });
    return json({ ok: true, pass, session });
  }

  // ---------------- Regras de ativação ----------------
  if (p.endsWith("/api/activate")) {
    let projectId = url.searchParams.get("project") || "";
    const studioId = url.searchParams.get("studio") || "";
    const host = (url.searchParams.get("host") || "").toLowerCase();
    const token = url.searchParams.get("token") || "";
    const existing = url.searchParams.get("session") || "";
    const pass = url.searchParams.get("pass") || "";
    // Veio por link e não vai abrir: o loader mostra a janela gate.js com o motivo
    const gateV = async () => { if (!token) return ""; const g = await assetEntry("gate.js"); return g ? g.v : ""; };

    // Modo estúdio: descobre (ou cria) o projeto pelo domínio do site
    if (!projectId && studioId) {
      const r = await resolveStudioProject(studioId, host, token, existing);
      if ("error" in r) return json({ active: false, reason: token && r.error === "domain_not_allowed" ? "invalid_link" : r.error, v: await gateV() });
      projectId = r.projectId;
    }

    const { data: project } = await sb.from("fb_projects").select("*").eq("id", projectId).maybeSingle();
    if (!project) return json({ active: false, reason: token ? "invalid_link" : "unknown_project", v: await gateV() });
    if (project.paused) return json({ active: false, reason: project.archived_at ? "archived" : "paused", v: await gateV() });

    // Nome ainda é o domínio → tenta a <title> da home (em segundo plano)
    const nameHost = (project.domains as string[]).find((d) => d === project.name && !d.includes("*"));
    if (nameHost) inBackground(nameProjectFromHome(project.id, nameHost));

    let via: string | null = null;
    let who: Who = null;
    let badToken = false;
    if (token) {
      who = await reviewerByToken(token, projectId);          // link pessoal
      if (who) {
        if (who.hasCode) {
          // Convite por email: precisa do passe deste navegador (ou de uma sessão já confirmada nesta aba)
          let ok = !!pass && await passValid(token, pass);
          if (!ok && existing) {
            const { data: s } = await sb.from("fb_sessions").select("project_id, expires_at, reviewer_token").eq("id", existing).maybeSingle();
            if (s && s.project_id === projectId && s.reviewer_token === token && new Date(s.expires_at) > new Date()) {
              const ov = await assetEntry("overlay.js");
              return json({ active: true, session: existing, via: "person", v: ov ? ov.v : "", who: publicWho(who), project: projectId });
            }
          }
          if (!ok) return json({ active: false, reason: "needs_code", who: publicWho(who), lockedUntil: who.lockedUntil, project: projectId, v: await gateV() });
        }
        via = "person";
      } else if ((project.review_tokens as string[]).includes(token)) via = "token"; // link genérico
      else badToken = true;
    }
    if (!via && existing) {
      const { data: s } = await sb.from("fb_sessions").select("project_id, expires_at, reviewer_token").eq("id", existing).maybeSingle();
      if (s && s.project_id === projectId && new Date(s.expires_at) > new Date()) {
        const ov = await assetEntry("overlay.js");
        const sw = await reviewerByToken(s.reviewer_token);
        return json({ active: true, session: existing, via: "session", v: ov ? ov.v : "", who: publicWho(sw), project: projectId });
      }
    }
    if (!via && (project.domains as string[]).some((d) => hostMatches(host, d))) via = "domain";
    if (!via) return json({ active: false, reason: badToken ? "invalid_link" : "domain_not_allowed", v: await gateV() });

    const session = newId();
    await sb.from("fb_sessions").insert({ id: session, project_id: projectId, via, reviewer_token: who ? who.token : null });
    const ov = await assetEntry("overlay.js");
    return json({ active: true, session, via, v: ov ? ov.v : "", who: publicWho(who), project: projectId });
  }

  // ---------------- Aprovação de página ----------------
  const am = p.match(/\/api\/approvals(?:\/([0-9a-f-]{36}))?$/);
  if (am) {
    const si = await sessionInfo(req);
    if (!si) return json({ error: "no_session" }, 401);
    const kh = await authorKeyHash(req);
    const shape = (a: any) => ({ id: a.id, path: a.path, author: a.author, createdAt: a.created_at, mine: isOwner(a, si.who, kh) });
    if (!am[1] && req.method === "GET") {
      const { data, error } = await sb.from("fb_approvals").select("id, path, author, created_at, reviewer_token, author_key_hash")
        .eq("project_id", si.projectId).order("created_at");
      if (error) return json({ error: error.message }, 500);
      return json((data || []).map(shape));
    }
    if (!am[1] && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const path = String(b.path || "").slice(0, 500);
      if (!path) return json({ error: "invalid" }, 400);
      // uma aprovação por pessoa por página: troca a anterior
      const { data: prev } = await sb.from("fb_approvals").select("id, reviewer_token, author_key_hash").eq("project_id", si.projectId).eq("path", path);
      const mineIds = (prev || []).filter((a: any) => isOwner(a, si.who, kh)).map((a: any) => a.id);
      if (mineIds.length) await sb.from("fb_approvals").delete().in("id", mineIds);
      const a = authorOf(si.who, b);
      const { data, error } = await sb.from("fb_approvals").insert({
        project_id: si.projectId, path, author: a.author, author_email: a.email,
        reviewer_token: si.who ? si.who.token : null, author_key_hash: kh,
      }).select("id, path, author, created_at, reviewer_token, author_key_hash").single();
      if (error) return json({ error: error.message }, 500);
      return json(shape(data), 201);
    }
    if (am[1] && req.method === "DELETE") {
      const { data: a } = await sb.from("fb_approvals").select("id, reviewer_token, author_key_hash").eq("id", am[1]).eq("project_id", si.projectId).maybeSingle();
      if (!a) return json({ error: "not_found" }, 404);
      if (!isOwner(a, si.who, kh)) return json({ error: "not_owner" }, 403);
      await sb.from("fb_approvals").delete().eq("id", a.id);
      return json({ deleted: true });
    }
  }

  // ---------------- Respostas ----------------
  const rm = p.match(/\/api\/comments\/([0-9a-f-]{36})\/replies$/);
  if (rm && req.method === "POST") {
    const si = await sessionInfo(req);
    if (!si) return json({ error: "no_session" }, 401);
    const { data: c } = await sb.from("fb_comments").select("id").eq("id", rm[1]).eq("project_id", si.projectId).maybeSingle();
    if (!c) return json({ error: "not_found" }, 404);
    const b = await req.json().catch(() => ({}));
    const text = String(b.text || "").trim();
    if (!text) return json({ error: "invalid" }, 400);
    const a = authorOf(si.who, b);
    const { data, error } = await sb.from("fb_replies").insert({
      comment_id: c.id, project_id: si.projectId, text: text.slice(0, 5000),
      author: a.author, author_email: a.email, reviewer_token: si.who ? si.who.token : null,
      author_key_hash: await authorKeyHash(req),
    }).select("id, text, author, created_at").single();
    if (error) return json({ error: error.message }, 500);
    return json({ id: data.id, text: data.text, author: data.author, createdAt: data.created_at }, 201);
  }

  // ---------------- Print do comentário ----------------
  const sm = p.match(/\/api\/comments\/([0-9a-f-]{36})\/screenshot$/);
  if (sm && req.method === "POST") {
    const si = await sessionInfo(req);
    if (!si) return json({ error: "no_session" }, 401);
    const { data: c } = await sb.from("fb_comments").select("id").eq("id", sm[1]).eq("project_id", si.projectId).maybeSingle();
    if (!c) return json({ error: "not_found" }, 404);
    const b = await req.json().catch(() => ({}));
    const m2 = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ""));
    if (!m2) return json({ error: "invalid_image" }, 400);
    if (m2[2].length > 2_000_000) return json({ error: "too_large" }, 413);
    const bin = Uint8Array.from(atob(m2[2]), (ch) => ch.charCodeAt(0));
    const ext = m2[1] === "png" ? "png" : "jpg";
    const path = si.projectId + "/" + c.id + "." + ext;
    const up = await sb.storage.from("fb-shots").upload(path, bin, { contentType: "image/" + m2[1], upsert: true });
    if (up.error) return json({ error: up.error.message }, 500);
    const url2 = sb.storage.from("fb-shots").getPublicUrl(path).data.publicUrl + "?t=" + Date.now();
    await sb.from("fb_comments").update({ screenshot_url: url2 }).eq("id", c.id);
    return json({ url: url2 }, 201);
  }

  // ---------------- Status de um comentário ----------------
  const m = p.match(/\/api\/comments\/([0-9a-f-]{36})$/);
  if (m && (req.method === "PATCH" || req.method === "DELETE")) {
    const si0 = await sessionInfo(req);
    if (!si0) return json({ error: "no_session" }, 401);
    const { data: own } = await sb.from("fb_comments").select("id, reviewer_token, author_key_hash").eq("id", m[1]).eq("project_id", si0.projectId).maybeSingle();
    if (!own) return json({ error: "not_found" }, 404);
    const kh = await authorKeyHash(req);
    const b0 = req.method === "PATCH" ? await req.clone().json().catch(() => ({})) : {};
    if (req.method === "DELETE" || typeof b0.text === "string") {
      if (!isOwner(own, si0.who, kh)) return json({ error: "not_owner" }, 403);
      if (req.method === "DELETE") {
        await sb.from("fb_comments").delete().eq("id", own.id);
        await sb.storage.from("fb-shots").remove([si0.projectId + "/" + own.id + ".jpg", si0.projectId + "/" + own.id + ".png"]);
        return json({ deleted: true });
      }
      const text = b0.text.trim();
      if (!text) return json({ error: "invalid" }, 400);
      const { data: ed, error: ee } = await sb.from("fb_comments").update({ text: text.slice(0, 5000), edited_at: new Date().toISOString() })
        .eq("id", own.id).select("id, text, edited_at").single();
      if (ee) return json({ error: ee.message }, 500);
      return json({ id: ed.id, text: ed.text, editedAt: ed.edited_at });
    }
  }
  if (m && req.method === "PATCH") {
    const si = await sessionInfo(req);
    if (!si) return json({ error: "no_session" }, 401);
    const projectId = si.projectId;
    const b = await req.json().catch(() => ({}));
    if (!["open", "resolved"].includes(b.status)) return json({ error: "invalid_status" }, 400);
    const { data, error } = await sb.from("fb_comments")
      .update({ status: b.status })
      .eq("id", m[1]).eq("project_id", projectId) // só comentários do projeto desta sessão
      .select("id, status").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "not_found" }, 404);
    return json(data);
  }

  // ---------------- Comentários ----------------
  if (p.endsWith("/api/comments")) {
    const si = await sessionInfo(req);
    if (!si) return json({ error: "no_session" }, 401);
    const projectId = si.projectId;

    if (req.method === "GET") {
      let q = sb.from("fb_comments")
        .select("id, path, text, author, status, anchor, viewport, device, created_at, edited_at, screenshot_url, reviewer_token, author_key_hash, fb_replies(id, text, author, created_at)")
        .eq("project_id", projectId).order("created_at");
      if (!url.searchParams.get("all")) q = q.eq("path", url.searchParams.get("path") || "/");
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const kh = await authorKeyHash(req);
      return json((data || []).map(({ fb_replies, reviewer_token, author_key_hash, ...c }: any) => ({
        ...c, createdAt: c.created_at, editedAt: c.edited_at || null, screenshot: c.screenshot_url || null,
        mine: isOwner({ reviewer_token, author_key_hash }, si.who, kh), replies: shapeReplies(fb_replies),
      })));
    }

    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (!b.text || !b.anchor || !b.path) return json({ error: "invalid" }, 400);
      // Link pessoal: o nome vem do cadastro, não do navegador
      const w = si.who;
      const { author, email } = authorOf(w, b);
      const { data, error } = await sb.from("fb_comments").insert({
        project_id: projectId,
        path: String(b.path).slice(0, 500),
        text: String(b.text).slice(0, 5000),
        author,
        author_email: email,
        reviewer_token: w ? w.token : null,
        author_key_hash: await authorKeyHash(req),
        anchor: b.anchor,
        viewport: b.viewport ?? null,
        device: b.device ?? null,
        user_agent: String(b.userAgent || "").slice(0, 500),
      }).select("id, path, text, author, status, anchor, viewport, device, created_at").single();
      if (error) return json({ error: error.message }, 500);
      return json({ ...data, createdAt: data.created_at, replies: [], mine: true }, 201);
    }
  }

  return json({ error: "not_found" }, 404);
});
