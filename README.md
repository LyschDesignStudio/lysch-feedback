# Feedback

Ferramenta de revisão de sites (Webflow, Framer, sites de vibe coding): o cliente comenta direto na página e o estúdio acompanha tudo num painel.

- **Vercel** (este repositório): serve o painel no endereço próprio do projeto e os scripts que o site do cliente carrega. A cada push na `main`, a Vercel publica.
- **Supabase**: banco de dados, prints dos comentários e a API (Edge Functions). A Vercel repassa `/api`, `/painel/api`, `/sugestoes/api` e `/favicon` para o Supabase (veja `vercel.json`).

## Endereços (troque `painel.exemplo.com` pelo domínio do projeto na Vercel)

| O quê | Endereço |
| --- | --- |
| Painel do estúdio | `https://painel.exemplo.com/` |
| Área de sugestões (administrador) | `https://painel.exemplo.com/sugestoes` |
| Snippet para os sites | `<script src="https://painel.exemplo.com/loader.js" data-studio="lysch" defer></script>` |
| Painel dentro de um site com o snippet | `https://site-do-cliente.webflow.io/?painel` |

O snippet vai no Footer code do Webflow (Site settings → Custom code) ou em "End of `<body>` tag" no Framer, e o site precisa ser publicado. Sites em `*.webflow.io`, `*.framer.app` e `*.framer.website` entram sozinhos no estúdio na primeira visita.

## Estrutura

```
src/                      → vira public/ no build (o que a Vercel serve)
  index.html              painel do estúdio
  sugestoes.html          área do administrador
  loader.js               snippet colado nos sites
  overlay.js              tela de revisão (comentários)
  gate.js                 janela do código de acesso / avisos de link
  painel/app.js           painel (também abre em sites com ?painel)
  vendor/modern-screenshot.js
scripts/
  configurar.mjs          liga o repositório a um projeto Supabase
  build.mjs               build da Vercel (troca os marcadores pela config)
feedback.config.json      URL do Supabase + chave publicável (públicas)
vercel.json               build e repasses para o Supabase
supabase/
  schema.sql              banco completo (rodar uma vez num projeto novo)
  config.toml             verify_jwt = false nas 4 funções
  functions/              reviewer, painel (+ convites.ts), sugestoes, favicon
.github/workflows/        opcional: publica as funções a cada push
```

`src/` tem dois marcadores, `__SUPABASE_URL__` e `__SUPABASE_PUBLISHABLE_KEY__`, que o `build.mjs` troca pelos valores de `feedback.config.json`. Não troque à mão.

## Ligar a um projeto Supabase

```bash
node scripts/configurar.mjs <ref do projeto> <chave publicável sb_publishable_...>
git add -A && git commit -m "Configura Supabase" && git push
```

Isso grava `feedback.config.json` e ajusta os endereços em `vercel.json` e em `supabase/schema.sql`.

## Mudanças no dia a dia

- **Painel, tela de revisão ou snippet:** editar em `src/`, testar, push. A Vercel publica em ~1 minuto.
- **API (Edge Functions):** editar em `supabase/functions/` e publicar com `npx supabase functions deploy --project-ref <ref>` (ou deixar o workflow do GitHub fazer, depois de cadastrar os secrets `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF`).
- **Banco:** mudanças novas em SQL, aplicadas no Supabase (SQL Editor ou `supabase db`). Mantenha `supabase/schema.sql` atualizado.
- **Build local:** `node scripts/build.mjs` gera `public/` (não vai para o Git).

## Secrets das funções (Supabase → Edge Functions → Secrets)

| Secret | Para quê |
| --- | --- |
| `RESEND_API_KEY` | Convite por email com código de acesso |
| `RESEND_FROM` | Remetente do convite (precisa de domínio confirmado no Resend) |
| `ANTHROPIC_API_KEY` | Botão "Priorizar com IA" no board (opcional) |

## Senhas

Senhas do painel (por estúdio) e da área de sugestões são guardadas como hash PBKDF2. Para definir uma senha sem saber a atual:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log('pbkdf2\$100000\$'+s+'\$'+c.pbkdf2Sync(process.argv[1],Buffer.from(s,'hex'),100000,32,'sha256').toString('hex'))" 'NOVA-SENHA'
```

```sql
update fb_studios set panel_key_hash = '<hash>' where id = 'lysch';   -- painel do estúdio (mínimo 8 caracteres)
update fb_admin   set admin_key_hash = '<hash>' where id = 1;         -- área de sugestões (mínimo 12)
```
