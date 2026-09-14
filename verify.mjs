/**
 * Checks that the install is actually wired up.
 *
 *   npm run verify
 *
 * Walks the environment variables and the database and prints ✓ / ✗ for each.
 * One ✗ and it exits 1, so an agent can read the result and fix it on its own.
 * It does not send a notification — only a phone can tell you that worked.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const results = [];
const ok = (what) => results.push({ mark: '✓', what });
const bad = (what, how) => results.push({ mark: '✗', what, how });
const warn = (what, how) => results.push({ mark: '⚠', what, how });

/** Reads what `vercel env pull .env.local` writes. Never overrides what is already set. */
export function loadEnvFile(path = '.env.local') {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
}

/**
 * Vercel will not hand back a value it stored as a Secret. `vercel env pull`
 * writes `[SENSITIVE]` in its place, and reading that as the real thing makes
 * this script say the VAPID keys are the wrong shape — which would send someone
 * off to generate a new pair and kill notifications on every device that has
 * them on. So placeholders get their own answer.
 */
const HIDDEN = '[SENSITIVE]';
const hidden = (v) => v === HIDDEN;
const HIDDEN_HOW =
  'Vercel will not hand Secret values back, so this cannot be checked here ' +
  '(env pull writes [SENSITIVE] instead). Look at the value in the Vercel dashboard — ' +
  'do not generate a new one because of this warning';

/* VAPID keys are a P-256 pair: 87 characters public, 43 private, both base64url. */
const shaped = (v, len) => typeof v === 'string' && v.length === len && /^[A-Za-z0-9_-]+$/.test(v);
const MAKE_KEYS = 'make a pair with node -e "console.log(require(\'web-push\').generateVAPIDKeys())"';

export async function checkEnv() {
  const password = process.env.DIARY_PASSWORD;
  if (!password) bad('DIARY_PASSWORD', 'vercel env add DIARY_PASSWORD — the password the two of you share');
  else if (hidden(password)) warn('DIARY_PASSWORD', HIDDEN_HOW);
  else if (password.length < 12) warn('DIARY_PASSWORD', `only ${password.length} characters. Anyone with the URL reaches the login screen, so make it long`);
  else ok('DIARY_PASSWORD');

  if (hidden(process.env.DIARY_SECRET)) warn('DIARY_SECRET', HIDDEN_HOW);
  else if (process.env.DIARY_SECRET) ok('DIARY_SECRET');
  else bad('DIARY_SECRET', 'vercel env add DIARY_SECRET — any long random string');

  if (hidden(process.env.CRON_SECRET)) warn('CRON_SECRET', HIDDEN_HOW);
  else if (process.env.CRON_SECRET) ok('CRON_SECRET');
  else bad('CRON_SECRET', 'vercel env add CRON_SECRET — the key the outside clock knocks with (see "Reminders on the day" in AGENTS.md)');

  for (const [name, len] of [['VAPID_PUBLIC_KEY', 87], ['VAPID_PRIVATE_KEY', 43]]) {
    const value = process.env[name];
    if (shaped(value, len)) ok(name);
    else if (hidden(value)) warn(name, HIDDEN_HOW);
    else if (value) bad(name, `wrong shape (expected ${len} base64url characters, got ${value.length}). ${MAKE_KEYS}`);
    else bad(name, MAKE_KEYS);
  }

  try {
    const { subject } = await import('./lib/push.js');
    const at = subject();
    if (hidden(at)) warn('push contact address', HIDDEN_HOW);
    else ok(`push contact address (${at})`);
  } catch {
    bad('push contact address', 'put your deployed URL in VAPID_SUBJECT or DIARY_URL (on Vercel, VERCEL_URL covers it)');
  }
}

const WANT = ['events', 'settings', 'photos', 'push_subs', 'reminders_sent'];

/** query(text) -> rows. Tests pass PGlite in (the same trick as useClient in lib/db.js). */
export async function checkDb(query) {
  const rows = await query(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  ok('database connection');

  const have = new Set(rows.map((r) => r.table_name));
  const missing = WANT.filter((t) => !have.has(t));
  if (missing.length) return bad(`tables (${missing.join(', ')} missing)`, 'npm run schema');
  ok(`${WANT.length} tables`);

  const counted = await query('select count(*)::int as n from settings where id = 1');
  if (counted[0]?.n === 1) ok('settings row');
  else bad('the settings row is missing', 'npm run schema');
}

/** Prints what has piled up and returns { failed, warned }. */
export function report() {
  for (const r of results) console.log(`${r.mark} ${r.what}${r.how ? `\n    → ${r.how}` : ''}`);
  const failed = results.filter((r) => r.mark === '✗').length;
  const warned = results.filter((r) => r.mark === '⚠').length;
  console.log();
  if (failed) console.log(`${failed} still not right. Follow the arrows above and run this again.`);
  else console.log(warned ? `Ready (though ${warned} ⚠ worth a look).` : 'Ready.');
  return { failed, warned };
}

/* Only touches a real database when run directly (importing it does not). */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile();

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const reachable = dbUrl && !hidden(dbUrl);
  if (reachable) ok('DATABASE_URL');
  else if (dbUrl) warn('DATABASE_URL', `${HIDDEN_HOW}. To create the tables, paste schema.sql into the Neon SQL Editor instead`);
  else bad('DATABASE_URL', 'attach a database with vercel integration add neon, then vercel env pull .env.local');

  await checkEnv();

  if (reachable) {
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(dbUrl);
      await checkDb((text) => sql.query(text));
    } catch (e) {
      bad('database connection', `${e.message} — check that DATABASE_URL is right`);
    }
  }

  if (report().failed) process.exit(1);
}
