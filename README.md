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

Para instalar em vários sites de uma vez pelo Claude (conector do Webflow), use o prompt de [`docs/prompt-instalar-script.md`](docs/prompt-instalar-script.md). O snippet vai no Footer code do Webflow (Site settings → Custom code) ou em "End of `<body>` tag" no Framer, e o site precisa ser publicado. Sites em `*.webflow.io`, `*.framer.app` e `*.framer.website` entram sozinhos no estúdio na primeira visita.

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
  migrations/             banco (a primeira migração cria tudo)
  config.toml             as 4 funções, com verify_jwt = false
  functions/              reviewer, painel (+ convites.ts), sugestoes, favicon
```

`src/` tem dois marcadores, `__SUPABASE_URL__` e `__SUPABASE_PUBLISHABLE_KEY__`, que o `build.mjs` troca pelos valores de `feedback.config.json`. Não troque à mão.

## Ligar a um projeto Supabase

```bash
node scripts/configurar.mjs <ref do projeto> <chave publicável sb_publishable_...>
git add -A && git commit -m "Configura Supabase" && git push
```

Isso grava `feedback.config.json` e ajusta os endereços em `vercel.json` e nas migrações. A primeira migração tem uma trava: se for aplicada antes deste passo, ela para com um aviso e não cria nada.

## Mudanças no dia a dia

- **Painel, tela de revisão ou snippet:** editar em `src/`, testar, push. A Vercel publica em ~1 minuto.
- **API (Edge Functions):** editar em `supabase/functions/` e fazer push. Com a integração do GitHub ligada (abaixo), o Supabase publica sozinho. Sem ela: `npx supabase functions deploy --project-ref <ref>`.
- **Banco:** cada mudança vira um arquivo novo em `supabase/migrations/` (`AAAAMMDDHHMMSS_descricao.sql`). Com a integração ligada, o push aplica. Nunca edite uma migração que já foi aplicada.
- **Build local:** `node scripts/build.mjs` gera `public/` (não vai para o Git).

## Supabase pelo GitHub (deploy automático)

No Supabase: **Project Settings → Integrations → GitHub Integration → Authorize GitHub**, escolher `LyschDesignStudio/lysch-feedback`, **Working directory** `.`, **Production branch** `main` e ligar **Deploy to production**. A partir daí, cada push na `main`:

- aplica as migrações novas de `supabase/migrations/`;
- publica as Edge Functions declaradas em `supabase/config.toml`.

Funciona em qualquer plano. O resultado de cada deploy aparece no próprio commit no GitHub (o check do Supabase). Secrets e dados não passam pelo Git.

## Agente: `/resolver-feedback`

No painel, **Resolver com Agente** coloca comentários na coluna **Com o agente**. A skill `/resolver-feedback` pega essa fila, aplica os ajustes no Webflow (sem publicar) e devolve cada card para **Para conferir** com uma nota. Ela sempre pergunta o projeto e mostra a lista de alterações antes de mexer em qualquer coisa.

- **Claude Code:** a skill está em `.claude/skills/resolver-feedback/` e aparece sozinha ao abrir este repositório.
- **App do Claude (claude.ai / desktop):** baixe a pasta `.claude/skills/resolver-feedback` como zip e envie em Configurações → Capabilities → Skills.
- **Precisa de:** conector do Supabase com acesso ao projeto `ipntwqtdbjpbgtlglznc` e conector do Webflow com acesso aos sites.
- Mudou a skill? Edite o `SKILL.md`, faça push e reenvie o zip no app.

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
