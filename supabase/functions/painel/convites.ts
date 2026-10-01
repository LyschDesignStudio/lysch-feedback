// Convite por email (D-038): gera o código de acesso e manda o email pelo Resend.
// Secrets das Edge Functions: RESEND_API_KEY (obrigatório para enviar) e RESEND_FROM (opcional,
// ex.: "Revisão BX <revisao@bx.studio>" depois de confirmar o domínio no Resend).
// Sem domínio confirmado, o Resend só entrega para o email da própria conta (modo teste).

export function genCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, "0");
}
export async function codeHash(token: string, code: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token + ":" + code));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
export const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]{2,}$/;

function h(s: string) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]); }

export function inviteEmail(o: { name: string; studio: string; site: string; url: string; code: string }) {
  const first = o.name.split(/\s+/)[0];
  const subject = o.studio + " convidou você para revisar " + o.site;
  const text = "Olá, " + first + "!\n\n" + o.studio + " convidou você para revisar o site " + o.site + ".\n\n" +
    "1. Abra o link: " + o.url + "\n2. Digite o código de acesso: " + o.code + "\n\n" +
    "O código é pedido só na primeira vez em cada navegador. O convite é pessoal: os comentários saem com o seu nome, então não encaminhe este email.\n";
  const code = o.code.slice(0, 3) + " " + o.code.slice(3);
  const html = '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f8f7f5">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f5;padding:32px 16px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5dfd6;border-radius:24px;font-family:\'DM Sans\',Helvetica,Arial,sans-serif;color:#2c2821">' +
    '<tr><td style="padding:40px 40px 8px">' +
    '<p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#a49785">' + h(o.studio) + '</p>' +
    '<h1 style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:600">Olá, ' + h(first) + '! Você foi convidado para revisar <span style="white-space:nowrap">' + h(o.site) + '</span></h1>' +
    '<p style="margin:0 0 24px;font-size:16px;line-height:24px;color:#706657">Abra o link e deixe seus comentários direto no site. Na primeira vez, digite o código abaixo.</p>' +
    '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:16px;background:#2c2821">' +
    '<a href="' + h(o.url) + '" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:16px">Abrir a revisão</a></td></tr></table>' +
    '</td></tr><tr><td style="padding:24px 40px 8px">' +
    '<p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#706657">Código de acesso</p>' +
    '<p style="margin:0;padding:16px;background:#f1eee9;border-radius:16px;text-align:center;font-size:32px;line-height:40px;font-weight:600;letter-spacing:6px">' + code + '</p>' +
    '</td></tr><tr><td style="padding:24px 40px 40px">' +
    '<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#8a7e6c">O código é pedido só na primeira vez em cada navegador. Este convite é pessoal: os comentários saem com o seu nome, por isso não encaminhe este email.</p>' +
    '<p style="margin:0;font-size:12px;line-height:18px;color:#a49785;word-break:break-all">Se o botão não abrir, copie o endereço: ' + h(o.url) + '</p>' +
    '</td></tr></table></td></tr></table></body></html>';
  return { subject, text, html };
}

export async function sendEmail(to: string, msg: { subject: string; text: string; html: string }): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "sem_chave_email" };
  const from = Deno.env.get("RESEND_FROM") || "Revisão do site <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (r.ok) { await r.text(); return { ok: true }; }
    const t = (await r.text()).slice(0, 300);
    if (r.status === 401 || (r.status === 403 && /api key/i.test(t))) return { ok: false, error: "chave_email_invalida" };
    // Sem domínio confirmado, o Resend só envia para o email da conta
    if (r.status === 403 || /verify a domain|testing emails|own email/i.test(t)) return { ok: false, error: "dominio_nao_confirmado" };
    if (r.status === 422) return { ok: false, error: "email_recusado" };
    return { ok: false, error: "email_" + r.status };
  } catch (_e) { return { ok: false, error: "sem_conexao" }; }
}
