// favicon — devolve (redireciona para) o favicon de um site cadastrado em fb_projects.
// GET /functions/v1/favicon?domain=site-caju.webflow.io  → 302 para o ícone do site, ou 404.
// Só aceita domínios que existem em fb_projects (não é um proxy aberto).
const SB = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cache = new Map<string, { url: string | null; at: number }>();
const TTL = 6 * 3600 * 1000;
const H = { 'Access-Control-Allow-Origin': '*' };

async function known(dom: string) {
  const r = await fetch(`${SB}/rest/v1/fb_projects?select=id&domains=cs.{${encodeURIComponent(dom)}}&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return r.ok && (await r.json()).length > 0;
}

async function find(dom: string): Promise<string | null> {
  try {
    const r = await fetch(`https://${dom}/`, { redirect: 'follow', signal: AbortSignal.timeout(6000) });
    const html = (await r.text()).slice(0, 200000);
    const links = html.match(/<link\b[^>]*>/gi) || [];
    let best: string | null = null;
    for (const l of links) {
      const rel = (l.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase() || '';
      const href = (l.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!href || !/\bicon\b/.test(rel)) continue;
      const abs = new URL(href.replace(/&amp;/g, '&'), r.url).toString();
      if (/apple-touch-icon/.test(rel)) { best = best || abs; continue; }
      return abs; // "icon" / "shortcut icon" tem preferência
    }
    if (best) return best;
    const f = await fetch(`https://${dom}/favicon.ico`, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    return f.ok ? `https://${dom}/favicon.ico` : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: H });
  const dom = (new URL(req.url).searchParams.get('domain') || '').toLowerCase().trim();
  if (!/^[a-z0-9.-]{3,253}$/.test(dom)) return new Response('bad domain', { status: 400, headers: H });
  let c = cache.get(dom);
  if (!c || Date.now() - c.at > TTL) {
    if (!(await known(dom))) return new Response('unknown', { status: 404, headers: H });
    c = { url: await find(dom), at: Date.now() };
    cache.set(dom, c);
  }
  if (!c.url) return new Response('no favicon', { status: 404, headers: { ...H, 'Cache-Control': 'public, max-age=3600' } });
  return new Response(null, { status: 302, headers: { ...H, Location: c.url, 'Cache-Control': 'public, max-age=21600' } });
});
