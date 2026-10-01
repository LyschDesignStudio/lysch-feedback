// Liga este repositório a um projeto Supabase (rodar uma vez, ou de novo para trocar de projeto):
//   node scripts/configurar.mjs <ref do projeto> <chave publicável>
// Grava feedback.config.json e atualiza os endereços do Supabase no vercel.json e nas migrações. Depois: commit + push.
// (A chave publicável é pública por natureza: ela já vai no JavaScript que o navegador baixa.)
import fs from 'node:fs';
import path from 'node:path';

const [ref, key] = process.argv.slice(2);
if (!/^[a-z0-9]{10,40}$/.test(ref || '') || !/^(sb_publishable_|eyJ)/.test(key || '')) {
  console.error('Uso: node scripts/configurar.mjs <ref> <chave publicável sb_publishable_...>');
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const url = 'https://' + ref + '.supabase.co';
fs.writeFileSync(path.join(root, 'feedback.config.json'), JSON.stringify({ supabaseUrl: url, publishableKey: key }, null, 2) + '\n');
const vp = path.join(root, 'vercel.json');
const v = fs.readFileSync(vp, 'utf8').replace(/https:\/\/[A-Za-z0-9_]+\.supabase\.co/g, url);
fs.writeFileSync(vp, v);
// endereço da função "painel" no aviso do Slack (migrações do banco)
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
for (const f of walk(path.join(root, 'supabase')).filter((f) => f.endsWith('.sql'))) {
  const t = fs.readFileSync(f, 'utf8'), u = t.replace(/https:\/\/[A-Za-z0-9_]+\.supabase\.co\/functions/g, url + '/functions');
  if (u !== t) fs.writeFileSync(f, u);
}
console.log('Configurado para ' + url + '. Agora: git add -A && git commit -m "Configura Supabase" && git push');
