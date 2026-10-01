// Liga este repositório a um projeto Supabase (rodar uma vez, ou de novo para trocar de projeto):
//   node scripts/configurar.mjs <ref do projeto> <chave publicável>
// Grava feedback.config.json e atualiza os endereços do Supabase no vercel.json. Depois: commit + push.
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
const sql = path.join(root, 'supabase', 'schema.sql');
if (fs.existsSync(sql)) fs.writeFileSync(sql, fs.readFileSync(sql, 'utf8').replace(/https:\/\/[A-Za-z0-9_]+\.supabase\.co\/functions/g, url + '/functions'));
console.log('Configurado para ' + url + '. Agora: git add -A && git commit -m "Configura Supabase" && git push');
