// Edge Function "painel": painel do estúdio (senha por estúdio).
//
//   GET    /painel/app.js                     → interface do painel (tabela fb_assets, "painel.js")
//   POST   /painel/api/login                  → { studio, password } → { session, studio }
//   POST   /painel/api/logout
//   POST   /painel/api/password               → { current, next } troca a senha do estúdio
//   GET    /painel/api/overview               → estúdio + sites com contagens
//   GET    /painel/api/projects/:id           → site: comentários (com respostas), links pessoais, aprovações
//   PATCH  /painel/api/projects/:id           → { paused?, name?, archived? } (archived: encerra/reabre o projeto)
//   POST   /painel/api/projects/:id/reviewers → { name, org?, email? } cria link pessoal; com email, manda convite com código
//   POST   /painel/api/reviewers/:token/invite → { email? } gera um código novo e reenvia o convite
//   PATCH  /painel/api/reviewers/:token       → { active }
//   PATCH  /painel/api/comments/:id           → { status?: open | resolved, agent?: queued | review | null }
//   POST   /painel/api/projects/:id/agent      → { ids } manda comentários em aberto para a fila do agente
//   DELETE /painel/api/comments/:id           → apaga (o estúdio pode apagar qualquer comentário)
//   POST   /painel/api/projects/:id/rounds/close → { carry, slack, nextName? } fecha a rodada atual; a próxima fica aguardando
//   POST   /painel/api/projects/:id/rounds/open  → abre a rodada que está aguardando
//   PATCH  /painel/api/projects/:id/rounds/:rid  → { name } dá nome à rodada (vazio tira o nome)
//   PATCH  /painel/api/projects/:id/slack      → { webhook?, notify? } configura o Slack do site
//   POST   /painel/api/projects/:id/slack/test → mensagem de teste
//   POST   /painel/api/projects/:id/slack/send → { ids, title? , dryRun? } envia comentários como resumo
//   POST   /painel/api/projects/:id/ai/prioritize → { ids? } IA ordena os comentários em aberto por urgência
//   POST   /painel/hook                        → chamado pelo banco (pg_net) para avisar comentário/aprovação novos
//
// Header das rotas (menos login): X-Panel-Session. Deploy com verify_jwt = false.
import { createClient } from "npm:@supabase/supabase-js@2";
import { codeHash, EMAIL_RE, genCode, inviteEmail, sendEmail } from "./convites.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Panel-Session",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function hex(buf: ArrayBuffer | Uint8Array) {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
function newId(bytes = 16) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
function rand(n: number) {
  const abc = "abcdefghijkmnopqrstuvwxyz23456789"; const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (b) => abc[b % abc.length]).join("");
}
function slug(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "pessoa";
}

// Senha: PBKDF2-SHA256, guardada como "pbkdf2$iter$salt$hash"
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

// Arquivo do painel (tabela fb_assets), cache curto
let appCache: { code: string; at: number } | null = null;
async function appCode() {
  if (appCache && Date.now() - appCache.at < 30_000) return appCache.code;
  const { data } = await sb.from("fb_assets").select("content").eq("name", "painel.js").maybeSingle();
  if (!data) return appCache ? appCache.code : null;
  appCache = { code: data.content as string, at: Date.now() };
  return appCache.code;
}

async function studioOf(req: Request): Promise<string | null> {
  const id = req.headers.get("x-panel-session");
  if (!id) return null;
  const { data } = await sb.from("fb_panel_sessions").select("studio_id, expires_at").eq("id", id).maybeSingle();
  if (!data || new Date(data.expires_at) < new Date()) return null;
  return data.studio_id;
}
async function ownProject(studio: string, id: string) {
  const { data } = await sb.from("fb_projects").select("*").eq("id", id).eq("studio_id", studio).maybeSingle();
  return data;
}
async function ownComment(studio: string, id: string) {
  const { data } = await sb.from("fb_comments").select("id, project_id, fb_projects!inner(studio_id)").eq("id", id).maybeSingle();
  return data && (data as any).fb_projects.studio_id === studio ? data : null;
}
function reviewUrl(p: any, token: string) {
  const d = (p.domains as string[] || [])[0];
  return d ? "https://" + d + "/?review=" + encodeURIComponent(token) : null;
}

// ---------------- Convites (links pessoais com código por email) ----------------
const RV_COLS = "token, name, org, email, active, created_at, code_hash, invite_sent_at, invite_error, verified_at";
function shapeReviewer(proj: any, r: any) {
  return {
    token: r.token, name: r.name, org: r.org, email: r.email || null, active: r.active, createdAt: r.created_at,
    url: reviewUrl(proj, r.token), invited: !!r.code_hash, inviteSentAt: r.invite_sent_at || null,
    inviteError: r.invite_error || null, verifiedAt: r.verified_at || null,
  };
}
// Gera um código novo (o anterior deixa de valer) e manda o email. O código volta para o painel
// para o estúdio poder enviar por outro meio se o email falhar.
async function deliverInvite(proj: any, rv: { token: string; name: string; email: string }) {
  const url = reviewUrl(proj, rv.token);
  if (!url) return { sent: false, error: "sem_dominio", code: null, url: null };
  const code = genCode();
  await sb.from("fb_reviewers").update({ code_hash: await codeHash(rv.token, code), code_fails: 0, code_locked_until: null }).eq("token", rv.token);
  const { data: st } = await sb.from("fb_studios").select("name").eq("id", proj.studio_id).maybeSingle();
  const r = await sendEmail(rv.email, inviteEmail({ name: rv.name, studio: (st && st.name) || "O estúdio", site: proj.name, url, code }));
  await sb.from("fb_reviewers").update(r.ok ? { invite_sent_at: new Date().toISOString(), invite_error: null } : { invite_error: r.error || "erro" }).eq("token", rv.token);
  return { sent: r.ok, error: r.ok ? null : (r.error || "erro"), code, url };
}

// ---------------- Slack ----------------
const SLACK_RE = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[A-Za-z0-9_\/-]{10,200}$/;
const DEV: Record<string, string> = { desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };
function mk(s: string) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function pageLabel(p: string) { return p === "/" ? "Página inicial" : p; }
function isGeneral(c: any) { return !!(c && c.anchor && c.anchor.kind === "page"); }
function numbers(all: any[]) {
  const seq: Record<string, number> = {}, map: Record<string, string> = {};
  all.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).forEach((c) => {
    const g = isGeneral(c), k = c.path + "|" + (g ? "geral" : (c.device || "desktop"));
    seq[k] = (seq[k] || 0) + 1; map[c.id] = (g ? "G" : "") + seq[k];
  });
  return map;
}
function siteLink(p: any, path: string) {
  const d = (p.domains || [])[0], t = (p.review_tokens || [])[0];
  return d ? "https://" + d + (path || "/") + (t ? "?review=" + encodeURIComponent(t) : "") : null;
}
function panelLink(p: any) { const d = (p.domains || [])[0]; return d ? "https://" + d + "/?painel" : null; }
function maskHook(u: string | null) { return u ? u.replace(/^(https:\/\/hooks\.slack\.com\/[a-z]+\/[A-Za-z0-9]{0,4}).*([A-Za-z0-9]{4})$/, "$1…$2") : null; }
// Lista em tópicos (rich_text do Slack): Rodada → Página → Breakpoint → Comentário
const BP_ORDER = ["geral", "desktop", "tablet", "mobile"];
const BP_NAME: Record<string, string> = { geral: "Geral (todos os dispositivos)", desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };
// Rodadas do site: id → número, e número → nome (opcional)
type Rounds = { num: Record<string, number>; name: Record<number, string> };
async function roundNumbers(projectId: string): Promise<Rounds> {
  const { data } = await sb.from("fb_rounds").select("id, number, name").eq("project_id", projectId);
  const m: Rounds = { num: {}, name: {} };
  (data || []).forEach((r: any) => { m.num[r.id] = r.number; if (r.name) m.name[r.number] = r.name; });
  return m;
}
function roundLabel(n: number, name?: string | null) { return "Rodada " + n + (name ? " · " + name : ""); }
function group<T>(list: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>(); list.forEach((x) => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k)!.push(x); }); return m;
}
const txt = (text: string, style?: Record<string, boolean>) => (style ? { type: "text", text, style } : { type: "text", text });
const li = (indent: number, items: any[][]) => ({ type: "rich_text_list", style: "bullet", indent, elements: items.map((els) => ({ type: "rich_text_section", elements: els })) });
function nestedList(p: any, items: { c: any; n: string }[], rounds: Rounds, max = 60) {
  const lists: any[] = []; let shown = 0;
  const byRound = [...group(items, (i) => String(rounds.num[i.c.round_id] || 0)).entries()].sort((a, b) => +a[0] - +b[0]);
  for (const [rn, rItems] of byRound) {
    if (shown >= max) break;
    lists.push(li(0, [[txt(+rn ? roundLabel(+rn, rounds.name[+rn]) : "Sem rodada", { bold: true })]]));
    const byPage = [...group(rItems, (i) => i.c.path || "/").entries()].sort((a, b) => (a[0] === "/" ? -1 : b[0] === "/" ? 1 : a[0] < b[0] ? -1 : 1));
    for (const [path, pItems] of byPage) {
      if (shown >= max) break;
      const link = siteLink(p, path);
      const open = pItems.filter((i) => i.c.status !== "resolved").length;
      lists.push(li(1, [[txt(pageLabel(path), { bold: true }), txt("  " + pItems.length + (pItems.length === 1 ? " comentário" : " comentários") + (open !== pItems.length ? " · " + open + " em aberto" : "") + (link ? "  " : "")),
        ...(link ? [{ type: "link", url: link, text: "Abrir página" }] : [])]]));
      const byBp = [...group(pItems, (i) => (isGeneral(i.c) ? "geral" : (i.c.device || "desktop"))).entries()].sort((a, b) => BP_ORDER.indexOf(a[0]) - BP_ORDER.indexOf(b[0]));
      for (const [bp, bItems] of byBp) {
        if (shown >= max) break;
        lists.push(li(2, [[txt(BP_NAME[bp] || bp)]]));
        const sorted = bItems.sort((a, b) => (a.c.status === "resolved" ? 1 : 0) - (b.c.status === "resolved" ? 1 : 0) || (a.c.created_at < b.c.created_at ? -1 : 1));
        const lines: any[][] = [];
        for (const it of sorted) {
          if (shown >= max) break;
          const done = it.c.status === "resolved";
          lines.push([txt((done ? "✅ " : "") + "#" + it.n + " ", { bold: true }), txt(String(it.c.text || "").replace(/\s+/g, " ").slice(0, 500), done ? { strike: true } : undefined)]);
          shown++;
        }
        if (lines.length) lists.push(li(3, lines));
      }
    }
  }
  return { block: lists.length ? { type: "rich_text", elements: lists } : null, shown };
}
function summaryPayload(p: any, title: string, subtitle: string, items: { c: any; n: string }[], rounds: Rounds) {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: title.slice(0, 150), emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: mk(subtitle) + (panelLink(p) ? " · <" + panelLink(p) + "|Abrir painel>" : "") }] },
  ];
  const nl = nestedList(p, items, rounds);
  if (nl.block) blocks.push(nl.block);
  if (nl.shown < items.length) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "…e mais " + (items.length - nl.shown) + " no painel." }] });
  if (!items.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: "_Nenhum comentário para enviar._" } });
  return { text: title + " — " + subtitle, blocks };
}
async function sendSlack(url: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const t = (await r.text()).slice(0, 200);
    if (r.ok) return { ok: true };
    return { ok: false, error: r.status === 404 || /no_service|invalid_token|channel_not_found/.test(t) ? "webhook_invalido" : "slack_" + r.status + ":" + t };
  } catch (_e) { return { ok: false, error: "sem_conexao" }; }
}
// ---------------- IA (Claude) ----------------
const AI_MODELS = ["claude-sonnet-5", "claude-haiku-4-5-20251001"];
async function askClaude(prompt: string): Promise<{ text?: string; error?: string }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return { error: "sem_chave_ia" };
  for (const model of AI_MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    });
    if (r.status === 404 && model !== AI_MODELS[AI_MODELS.length - 1]) { await r.text(); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: r.status === 401 ? "chave_ia_invalida" : r.status === 402 || /credit/i.test(JSON.stringify(j)) ? "sem_credito_ia" : "ia_" + r.status };
    return { text: (j.content || []).map((c: any) => c.text || "").join("") };
  }
  return { error: "ia_modelo" };
}
function prioritizePrompt(site: string, list: { id: string; n: string; c: any }[]) {
  const lines = list.map((x) => JSON.stringify({
    id: x.id, numero: x.n, pagina: pageLabel(x.c.path), dispositivo: isGeneral(x.c) ? "geral" : (x.c.device || "desktop"),
    elemento: x.c.anchor && x.c.anchor.text ? String(x.c.anchor.text).slice(0, 80) : (x.c.anchor && x.c.anchor.tag) || null,
    comentario: String(x.c.text || "").slice(0, 800),
  })).join("\n");
  return "Você ajuda um estúdio de web design a organizar os ajustes pedidos por um cliente na revisão do site \"" + site + "\".\n" +
    "Classifique cada comentário por urgência e ordene do mais urgente para o menos urgente.\n\n" +
    "Critérios:\n- alta: algo quebrado ou errado (link, botão, formulário, layout quebrado, texto/dado incorreto, erro de digitação visível, problema legal), ou algo que impede a aprovação.\n" +
    "- media: ajuste visual ou de conteúdo perceptível (tamanhos, espaçamentos, cores, imagens, hierarquia) sem quebrar nada.\n" +
    "- baixa: preferência, detalhe fino ou sugestão opcional.\nProblemas no mobile e na página inicial pesam um pouco mais.\n\n" +
    "Também aponte comentários que pedem a MESMA coisa (duplicados), mesmo com palavras diferentes.\n\n" +
    "Comentários (um JSON por linha):\n" + lines + "\n\n" +
    "Responda SOMENTE com um JSON neste formato, sem texto antes ou depois:\n" +
    "{\"itens\":[{\"id\":\"...\",\"urgencia\":\"alta|media|baixa\",\"motivo\":\"até 90 caracteres, em português\"}],\"duplicados\":[[\"id\",\"id\"]]}\n" +
    "A lista \"itens\" deve conter todos os ids, já ordenada do mais urgente para o menos urgente.";
}

async function roundOf(projectId: string) {
  const { data } = await sb.from("fb_rounds").select("id, number, name, status, started_at").eq("project_id", projectId).in("status", ["open", "pending"]).order("number", { ascending: false }).limit(1).maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const p = new URL(req.url).pathname;

  if (p.endsWith("/app.js")) {
    const code = await appCode();
    if (!code) return json({ error: "asset_missing" }, 503);
    return new Response(code, { headers: { ...CORS, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=60" } });
  }

  // ---------------- Aviso automático (chamado pelo banco) ----------------
  // Comentários: espera alguns segundos e junta numa mensagem só os comentários novos da mesma página.
  if (p.endsWith("/hook") && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!["comment", "approval"].includes(b.kind) || !/^[0-9a-f-]{36}$/.test(String(b.id || ""))) return json({ error: "invalid" }, 400);
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const task = (async () => {
      if (b.kind === "approval") {
        const { data: row } = await sb.from("fb_approvals").update({ notified_at: new Date().toISOString() })
          .eq("id", b.id).is("notified_at", null).gt("created_at", since).select("*").maybeSingle();
        if (!row) return;
        const { data: proj } = await sb.from("fb_projects").select("*").eq("id", row.project_id).maybeSingle();
        if (!proj || !proj.slack_notify || !proj.slack_webhook) return;
        const link = siteLink(proj, row.path);
        await sendSlack(proj.slack_webhook, {
          text: row.author + " aprovou " + pageLabel(row.path) + " em " + proj.name,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "✅ *" + mk(row.author) + "* aprovou a página *" + mk(pageLabel(row.path)) + "* em " + mk(proj.name) + (link ? "  <" + link + "|Abrir>" : "") } }],
        });
        return;
      }
      const { data: first } = await sb.from("fb_comments").select("id, project_id, path").eq("id", b.id).maybeSingle();
      if (!first) return;
      await new Promise((r) => setTimeout(r, 30_000)); // janela para juntar comentários seguidos
      // "pega" de uma vez todos os não avisados da mesma página (quem chegar depois não acha nada)
      const { data: rows } = await sb.from("fb_comments").update({ notified_at: new Date().toISOString() })
        .eq("project_id", first.project_id).eq("path", first.path).is("notified_at", null).gt("created_at", since).select("*");
      if (!rows || !rows.length) return;
      const { data: proj } = await sb.from("fb_projects").select("*").eq("id", first.project_id).maybeSingle();
      if (!proj || !proj.slack_notify || !proj.slack_webhook) return;
      const { data: all } = await sb.from("fb_comments").select("id, path, device, anchor, created_at").eq("project_id", proj.id);
      const nums = numbers(all || []);
      const items = rows.map((c: any) => ({ c, n: nums[c.id] || "?" }));
      const title = rows.length === 1 ? "💬 *Novo comentário em " + mk(proj.name) + "*" : "💬 *" + rows.length + " comentários novos em " + mk(proj.name) + "*";
      const nl = nestedList(proj, items, await roundNumbers(proj.id));
      await sendSlack(proj.slack_webhook, {
        text: (rows.length === 1 ? "Novo comentário em " : rows.length + " comentários novos em ") + proj.name + " · " + pageLabel(first.path),
        blocks: [{ type: "section", text: { type: "mrkdwn", text: title + (panelLink(proj) ? "  <" + panelLink(proj) + "|Abrir painel>" : "") } }, ...(nl.block ? [nl.block] : [])],
      });
    })();
    // responde logo ao banco e continua o trabalho em segundo plano
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && rt.waitUntil) rt.waitUntil(task); else await task;
    return json({ accepted: true });
  }

  // ---------------- Login ----------------
  if (p.endsWith("/api/login") && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const studioId = String(b.studio || "").trim().toLowerCase();
    const { data: st } = await sb.from("fb_studios").select("id, name, active, panel_key_hash").eq("id", studioId).maybeSingle();
    const ok = st && st.active && await checkPassword(String(b.password || ""), st.panel_key_hash);
    if (!ok) { await new Promise((r) => setTimeout(r, 900)); return json({ error: "invalid_login" }, 401); }
    const session = newId(24);
    await sb.from("fb_panel_sessions").insert({ id: session, studio_id: st.id });
    return json({ session, studio: { id: st.id, name: st.name } });
  }

  const studio = await studioOf(req);
  if (!studio) return json({ error: "no_session" }, 401);

  if (p.endsWith("/api/logout") && req.method === "POST") {
    await sb.from("fb_panel_sessions").delete().eq("id", req.headers.get("x-panel-session"));
    return json({ ok: true });
  }

  if (p.endsWith("/api/password") && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const next = String(b.next || "");
    if (next.length < 8) return json({ error: "too_short" }, 400);
    const { data: st } = await sb.from("fb_studios").select("panel_key_hash").eq("id", studio).single();
    if (!(await checkPassword(String(b.current || ""), st.panel_key_hash))) return json({ error: "wrong_password" }, 403);
    await sb.from("fb_studios").update({ panel_key_hash: await hashPassword(next) }).eq("id", studio);
    return json({ ok: true });
  }

  // ---------------- Visão geral ----------------
  if (p.endsWith("/api/overview") && req.method === "GET") {
    const { data: st } = await sb.from("fb_studios").select("id, name").eq("id", studio).single();
    const { data: projects } = await sb.from("fb_projects").select("id, name, domains, paused, created_at, review_tokens, archived_at").eq("studio_id", studio).order("created_at");
    const ids = (projects || []).map((x: any) => x.id);
    const { data: cs } = ids.length ? await sb.from("fb_comments").select("project_id, status, created_at").in("project_id", ids) : { data: [] };
    const { data: aps } = ids.length ? await sb.from("fb_approvals").select("project_id, path").in("project_id", ids) : { data: [] };
    const { data: rds } = ids.length ? await sb.from("fb_rounds").select("project_id, number, name, status").in("project_id", ids).in("status", ["open", "pending"]) : { data: [] };
    const out = (projects || []).map((x: any) => {
      const mine = (cs || []).filter((c: any) => c.project_id === x.id);
      const last = mine.reduce((m: string | null, c: any) => (!m || c.created_at > m ? c.created_at : m), null);
      const pages = new Set((aps || []).filter((a: any) => a.project_id === x.id).map((a: any) => a.path));
      return {
        id: x.id, name: x.name, domains: x.domains, paused: x.paused, createdAt: x.created_at,
        open: mine.filter((c: any) => c.status !== "resolved").length,
        resolved: mine.filter((c: any) => c.status === "resolved").length,
        approvedPages: pages.size, lastActivity: last,
        round: ((rds || []).filter((r: any) => r.project_id === x.id).sort((a: any, b: any) => b.number - a.number)[0] || { number: 1 }).number,
        roundStatus: ((rds || []).filter((r: any) => r.project_id === x.id).sort((a: any, b: any) => b.number - a.number)[0] || { status: "open" }).status,
        roundName: ((rds || []).filter((r: any) => r.project_id === x.id).sort((a: any, b: any) => b.number - a.number)[0] || { name: null }).name || null,
        archivedAt: x.archived_at,
        reviewUrl: reviewUrl(x, (x.review_tokens || [])[0] || ""),
      };
    });
    return json({ studio: st, projects: out });
  }

  // ---------------- Site ----------------
  const pm = p.match(/\/api\/projects\/([a-z0-9_-]+)(\/reviewers|\/rounds\/close|\/rounds\/open|\/slack|\/slack\/test|\/slack\/send|\/ai\/prioritize|\/agent|\/rounds\/[0-9a-f-]{36})?$/);
  if (pm) {
    const proj = await ownProject(studio, pm[1]);
    if (!proj) return json({ error: "not_found" }, 404);

    // ---- rodadas ----
    if (pm[2] === "/rounds/close" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const before = await roundOf(proj.id);
      let items: { c: any; n: string }[] = [];
      if (b.slack && proj.slack_webhook && before) {
        const { data: all } = await sb.from("fb_comments").select("id, path, text, author, status, anchor, device, created_at, round_id").eq("project_id", proj.id);
        const nums = numbers(all || []);
        items = (all || []).filter((c: any) => c.round_id === before.id).map((c: any) => ({ c, n: nums[c.id] }));
      }
      const rmap = await roundNumbers(proj.id);
      const { data: r, error } = await sb.rpc("fb_close_round", { p_project: proj.id, p_carry: b.carry !== false });
      if (error) return json({ error: /not_open/.test(error.message) ? "not_open" : error.message }, /not_open/.test(error.message) ? 400 : 500);
      const nextName = String(b.nextName || "").trim().slice(0, 60);
      if (nextName) await sb.from("fb_rounds").update({ name: nextName }).eq("project_id", proj.id).eq("number", r.next);
      let slack: unknown = null;
      if (b.slack && proj.slack_webhook) {
        const done = items.filter((i) => i.c.status === "resolved"), open = items.filter((i) => i.c.status !== "resolved");
        const payload = summaryPayload(proj, roundLabel(r.closed, rmap.name[r.closed]) + " fechada · " + proj.name,
          r.total + " pedidos · " + r.resolved + " entregues · " + (b.carry !== false ? r.carried + " levados para a Rodada " + r.next : r.open + " em aberto"),
          open.concat(done), rmap);
        slack = await sendSlack(proj.slack_webhook, payload);
      }
      return json({ ...r, slack });
    }

    // renomear rodada: { name } (vazio = sem nome)
    if (pm[2] && pm[2].startsWith("/rounds/") && /[0-9a-f-]{36}$/.test(pm[2]) && req.method === "PATCH") {
      const b = await req.json().catch(() => ({}));
      if (typeof b.name !== "string" && b.name !== null) return json({ error: "invalid" }, 400);
      const name = String(b.name || "").trim().slice(0, 60) || null;
      const { data } = await sb.from("fb_rounds").update({ name }).eq("id", pm[2].slice(8)).eq("project_id", proj.id).select("id, number, name").maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      return json(data);
    }

    if (pm[2] === "/rounds/open" && req.method === "POST") {
      const { data: r, error } = await sb.rpc("fb_open_round", { p_project: proj.id });
      if (error) return json({ error: /no_pending/.test(error.message) ? "no_pending" : error.message }, 400);
      return json(r);
    }

    // ---- IA: prioridade ----
    if (pm[2] === "/ai/prioritize" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const { data: all } = await sb.from("fb_comments").select("id, path, text, status, anchor, device, created_at, round_id").eq("project_id", proj.id);
      const nums = numbers(all || []);
      const rd = await roundOf(proj.id);
      const want: string[] | null = Array.isArray(b.ids) ? b.ids : null;
      const list = (all || []).filter((c: any) => c.status !== "resolved" && (want ? want.includes(c.id) : (!rd || c.round_id === rd.id)))
        .slice(0, 150).map((c: any) => ({ id: c.id, n: nums[c.id], c }));
      if (!list.length) return json({ error: "sem_comentarios" }, 400);
      const ans = await askClaude(prioritizePrompt(proj.name, list));
      if (ans.error) return json({ error: ans.error }, ans.error === "sem_chave_ia" ? 400 : 502);
      let out: any;
      try { out = JSON.parse(String(ans.text).replace(/^[^{]*/, "").replace(/[^}]*$/, "")); } catch (_e) { return json({ error: "ia_resposta" }, 502); }
      const valid = new Set(list.map((x) => x.id));
      const items = (out.itens || []).filter((i: any) => valid.has(i.id) && ["alta", "media", "baixa"].includes(i.urgencia));
      const groupOf: Record<string, string> = {};
      (out.duplicados || []).forEach((g: any) => {
        const ids = (Array.isArray(g) ? g : []).filter((id: string) => valid.has(id));
        if (ids.length > 1) ids.forEach((id: string) => { groupOf[id] = ids.slice().sort()[0]; });
      });
      const now = new Date().toISOString();
      await Promise.all(items.map((i: any, idx: number) => sb.from("fb_comments").update({
        ai_priority: i.urgencia, ai_rank: idx + 1, ai_reason: String(i.motivo || "").slice(0, 140), ai_group: groupOf[i.id] || null, ai_at: now,
      }).eq("id", i.id)));
      return json({ done: items.length, total: list.length, groups: Object.keys(groupOf).length });
    }

    // ---- Agente: fila ----
    if (pm[2] === "/agent" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const ids = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
      if (!ids.length) return json({ error: "invalid" }, 400);
      const { data } = await sb.from("fb_comments").update({ agent_status: "queued", agent_note: null, agent_at: new Date().toISOString() })
        .eq("project_id", proj.id).in("id", ids).eq("status", "open").select("id");
      return json({ queued: (data || []).length });
    }

    // ---- Slack ----
    if (pm[2] === "/slack" && req.method === "PATCH") {
      const b = await req.json().catch(() => ({}));
      const upd: Record<string, unknown> = {};
      if (b.webhook === null || b.webhook === "") { upd.slack_webhook = null; upd.slack_notify = false; }
      else if (typeof b.webhook === "string") {
        const u = b.webhook.trim();
        if (!SLACK_RE.test(u)) return json({ error: "webhook_invalido" }, 400);
        upd.slack_webhook = u;
      }
      if (typeof b.notify === "boolean") upd.slack_notify = b.notify;
      if (!Object.keys(upd).length) return json({ error: "invalid" }, 400);
      const { data } = await sb.from("fb_projects").update(upd).eq("id", proj.id).select("slack_webhook, slack_notify").single();
      if (data.slack_notify && !data.slack_webhook) await sb.from("fb_projects").update({ slack_notify: false }).eq("id", proj.id);
      return json({ configured: !!data.slack_webhook, masked: maskHook(data.slack_webhook), notify: !!(data.slack_notify && data.slack_webhook) });
    }
    if (pm[2] === "/slack/test" && req.method === "POST") {
      if (!proj.slack_webhook) return json({ error: "sem_webhook" }, 400);
      const r = await sendSlack(proj.slack_webhook, {
        text: "Teste do painel de feedback: " + proj.name,
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "👋 Tudo certo! Este canal vai receber os comentários de *" + mk(proj.name) + "*." + (panelLink(proj) ? "  <" + panelLink(proj) + "|Abrir painel>" : "") } }],
      });
      return json(r, r.ok ? 200 : 502);
    }
    if (pm[2] === "/slack/send" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
      const { data: all } = await sb.from("fb_comments").select("id, path, text, author, status, anchor, device, created_at, round_id").eq("project_id", proj.id);
      const nums = numbers(all || []);
      const items = (all || []).filter((c: any) => ids.includes(c.id))
        .sort((a: any, b2: any) => (a.path < b2.path ? -1 : a.path > b2.path ? 1 : a.created_at < b2.created_at ? -1 : 1))
        .map((c: any) => ({ c, n: nums[c.id] }));
      const rd = await roundOf(proj.id);
      const title = String(b.title || (items.length === 1 ? "Comentário · " + proj.name : items.length + " ajustes · " + proj.name)).slice(0, 150);
      const payload = summaryPayload(proj, title, items.filter((i) => i.c.status !== "resolved").length + " em aberto" + (rd ? " · rodada atual: " + roundLabel(rd.number, rd.name) : ""), items, await roundNumbers(proj.id));
      if (b.dryRun) return json({ payload });
      if (!proj.slack_webhook) return json({ error: "sem_webhook" }, 400);
      const r = await sendSlack(proj.slack_webhook, payload);
      return json({ ...r, sent: items.length }, r.ok ? 200 : 502);
    }

    if (!pm[2] && req.method === "GET") {
      await roundOf(proj.id) || await sb.rpc("fb_current_round", { p_project: proj.id });
      const [{ data: cs }, { data: rv }, { data: ap }, { data: rds }] = await Promise.all([
        sb.from("fb_comments").select("id, path, text, author, status, anchor, viewport, device, created_at, edited_at, screenshot_url, round_id, ai_priority, ai_rank, ai_reason, ai_group, ai_at, agent_status, agent_note, agent_at, fb_replies(id, text, author, created_at)").eq("project_id", proj.id).order("created_at"),
        sb.from("fb_reviewers").select(RV_COLS).eq("project_id", proj.id).order("created_at"),
        sb.from("fb_approvals").select("id, path, author, created_at").eq("project_id", proj.id).order("created_at"),
        sb.from("fb_rounds").select("id, number, name, status, started_at, closed_at, summary").eq("project_id", proj.id).order("number"),
      ]);
      return json({
        ai: !!Deno.env.get("ANTHROPIC_API_KEY"),
        email: !!Deno.env.get("RESEND_API_KEY"),
        project: {
          id: proj.id, name: proj.name, domains: proj.domains, paused: proj.paused, archivedAt: proj.archived_at, agentTarget: proj.agent_target || null, reviewUrl: reviewUrl(proj, (proj.review_tokens || [])[0] || ""),
          slack: { configured: !!proj.slack_webhook, masked: maskHook(proj.slack_webhook), notify: !!(proj.slack_notify && proj.slack_webhook) },
        },
        rounds: (rds || []).map((r: any) => ({ id: r.id, number: r.number, name: r.name || null, status: r.status, startedAt: r.started_at, closedAt: r.closed_at, summary: r.summary })),
        comments: (cs || []).map(({ fb_replies, ...c }: any) => ({
          ...c, createdAt: c.created_at, editedAt: c.edited_at, screenshot: c.screenshot_url,
          replies: (fb_replies || []).map((r: any) => ({ id: r.id, text: r.text, author: r.author, createdAt: r.created_at }))
            .sort((a: any, b: any) => a.createdAt < b.createdAt ? -1 : 1),
        })),
        reviewers: (rv || []).map((r: any) => shapeReviewer(proj, r)),
        approvals: (ap || []).map((a: any) => ({ id: a.id, path: a.path, author: a.author, createdAt: a.created_at })),
      });
    }
    if (!pm[2] && req.method === "PATCH") {
      const b = await req.json().catch(() => ({}));
      const upd: Record<string, unknown> = {};
      if (typeof b.paused === "boolean") upd.paused = b.paused;
      if (typeof b.name === "string" && b.name.trim()) upd.name = b.name.trim().slice(0, 120);
      // encerrar: some da lista e pausa a revisão; reabrir: volta e reativa
      if (b.archived === true) { upd.archived_at = new Date().toISOString(); upd.paused = true; }
      if (b.archived === false) { upd.archived_at = null; upd.paused = false; }
      if (!Object.keys(upd).length) return json({ error: "invalid" }, 400);
      const { data } = await sb.from("fb_projects").update(upd).eq("id", proj.id).select("id, name, paused, archived_at").single();
      return json(data);
    }
    if (pm[2] === "/reviewers" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const name = String(b.name || "").trim().slice(0, 80);
      if (!name) return json({ error: "invalid" }, 400);
      const org = String(b.org || "").trim().slice(0, 80) || null;
      const email = String(b.email || "").trim().toLowerCase().slice(0, 200) || null;
      if (email && !EMAIL_RE.test(email)) return json({ error: "email_invalido" }, 400);
      const token = slug(name) + "-" + slug(proj.id.replace(/^prj_/, "")).slice(0, 16) + "-" + rand(6);
      const { data, error } = await sb.from("fb_reviewers").insert({ token, project_id: proj.id, name, org, email })
        .select(RV_COLS).single();
      if (error) return json({ error: error.message }, 500);
      if (!email) return json(shapeReviewer(proj, data), 201);
      // Convite por email: código de acesso + envio
      const inv = await deliverInvite(proj, { token, name, email });
      const { data: fresh } = await sb.from("fb_reviewers").select(RV_COLS).eq("token", token).single();
      return json({ ...shapeReviewer(proj, fresh), invite: inv }, 201);
    }
  }

  // Reenviar convite (gera um código novo; o anterior deixa de valer)
  const ivm = p.match(/\/api\/reviewers\/([a-z0-9-]+)\/invite$/);
  if (ivm && req.method === "POST") {
    const { data: r } = await sb.from("fb_reviewers").select("token, project_id, name, email, active").eq("token", ivm[1]).maybeSingle();
    const proj = r ? await ownProject(studio, r.project_id) : null;
    if (!r || !proj) return json({ error: "not_found" }, 404);
    const b = await req.json().catch(() => ({}));
    let email = r.email as string | null;
    if (typeof b.email === "string" && b.email.trim()) {
      email = b.email.trim().toLowerCase().slice(0, 200);
      if (!EMAIL_RE.test(email!)) return json({ error: "email_invalido" }, 400);
      await sb.from("fb_reviewers").update({ email }).eq("token", r.token);
    }
    if (!email) return json({ error: "sem_email" }, 400);
    if (!r.active) await sb.from("fb_reviewers").update({ active: true }).eq("token", r.token);
    const inv = await deliverInvite(proj, { token: r.token, name: r.name, email });
    const { data: fresh } = await sb.from("fb_reviewers").select(RV_COLS).eq("token", r.token).single();
    return json({ ...shapeReviewer(proj, fresh), invite: inv });
  }

  const rvm = p.match(/\/api\/reviewers\/([a-z0-9-]+)$/);
  if (rvm && req.method === "PATCH") {
    const { data: r } = await sb.from("fb_reviewers").select("token, project_id").eq("token", rvm[1]).maybeSingle();
    if (!r || !(await ownProject(studio, r.project_id))) return json({ error: "not_found" }, 404);
    const b = await req.json().catch(() => ({}));
    if (typeof b.active !== "boolean") return json({ error: "invalid" }, 400);
    const { data } = await sb.from("fb_reviewers").update({ active: b.active }).eq("token", r.token).select("token, active").single();
    return json(data);
  }

  // ---------------- Comentários (board) ----------------
  const cm = p.match(/\/api\/comments\/([0-9a-f-]{36})$/);
  if (cm) {
    const c = await ownComment(studio, cm[1]);
    if (!c) return json({ error: "not_found" }, 404);
    if (req.method === "PATCH") {
      const b = await req.json().catch(() => ({}));
      const upd: Record<string, unknown> = {};
      if (b.status !== undefined) {
        if (!["open", "resolved"].includes(b.status)) return json({ error: "invalid_status" }, 400);
        upd.status = b.status;
        if (b.status === "resolved") upd.agent_status = null; // resolvido sai das colunas do agente
      }
      if (b.agent !== undefined) {
        if (![null, "queued", "review", "blocked"].includes(b.agent)) return json({ error: "invalid_agent" }, 400);
        upd.agent_status = b.agent; upd.agent_at = new Date().toISOString();
        if (b.agent === "queued" || b.agent === null) upd.agent_note = null;
        if (b.agent) upd.status = "open";
      }
      if (!Object.keys(upd).length) return json({ error: "invalid" }, 400);
      const { data } = await sb.from("fb_comments").update(upd).eq("id", c.id).select("id, status, agent_status").single();
      return json(data);
    }
    if (req.method === "DELETE") {
      await sb.from("fb_comments").delete().eq("id", c.id);
      await sb.storage.from("fb-shots").remove([c.project_id + "/" + c.id + ".jpg", c.project_id + "/" + c.id + ".png"]);
      return json({ deleted: true });
    }
  }

  return json({ error: "not_found" }, 404);
});
