// Pushes the server-side variables from .env.local to the linked Vercel project (Production and
// Preview) without printing their values. Run from the project folder:
//   node scripts/push-env-to-vercel.mjs                 (all names)
//   node scripts/push-env-to-vercel.mjs SUPABASE_URL    (only the names listed)
// Requires `vercel login` and `vercel link` to have been done already.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const ALL_NAMES = ['ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'FINNHUB_API_KEY', 'ANTHROPIC_API_KEY', 'SEC_USER_AGENT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FRED_API_KEY', 'LOG_PASSCODE', 'CRON_SECRET'];
const only = process.argv.slice(2);
const NAMES = only.length ? ALL_NAMES.filter((n) => only.includes(n)) : ALL_NAMES;
const text = fs.readFileSync('.env.local', 'utf8');
const vars = {};
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const vercel = process.platform === 'win32' ? 'vercel.cmd' : 'vercel';
for (const name of NAMES) {
  const value = vars[name];
  if (!value) {
    console.log(`${name}: SKIPPED (empty in .env.local)`);
    continue;
  }
  for (const env of ['production', 'preview']) {
    const r = spawnSync(vercel, ['env', 'add', name, env, ...(env === 'preview' ? ['""'] : []), '--force', '--yes'] /* --force overwrites; the empty branch argument means all Preview branches */, { input: value, encoding: 'utf8', shell: true });
    const ok = r.status === 0;
    console.log(`${name} (${env}): ${ok ? 'added' : 'FAILED'}${ok ? '' : ' ' + (r.stderr || r.stdout).trim().split('\n').pop()}`);
  }
}
console.log('Done. Redeploy with: vercel --prod --yes');
