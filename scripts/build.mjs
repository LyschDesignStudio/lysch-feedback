// Build da Vercel: copia src/ para public/ trocando os marcadores pelos valores de feedback.config.json.
// Rodar local: node scripts/build.mjs  (a Vercel roda sozinha a cada push)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'feedback.config.json'), 'utf8'));
const url = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
const key = String(cfg.publishableKey || '');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !/^(sb_publishable_|eyJ)/.test(key)) {
  console.error('feedback.config.json incompleto: rode  node scripts/configurar.mjs <ref> <chave publicável>');
  process.exit(1);
}
const src = path.join(root, 'src'), out = path.join(root, 'public');
fs.rmSync(out, { recursive: true, force: true });
let n = 0;
(function copy(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, e.name), to = path.join(out, path.relative(src, from));
    if (e.isDirectory()) { copy(from); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    let text = fs.readFileSync(from, 'utf8');
    text = text.split('__SUPABASE_PUBLISHABLE_KEY__').join(key).split('__SUPABASE_URL__').join(url);
    fs.writeFileSync(to, text); n++;
  }
})(src);
console.log('public/ pronto: ' + n + ' arquivos, Supabase ' + url);
