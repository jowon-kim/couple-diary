/**
 * 설치가 제대로 됐는지 확인합니다.
 *
 *   npm run verify
 *
 * 환경변수와 DB를 하나씩 짚어보고 ✓ / ✗ 로 찍습니다. ✗가 하나라도 있으면
 * 종료 코드 1로 끝나니, 에이전트가 이걸 보고 스스로 고칠 수 있습니다.
 * 알림을 실제로 보내지는 않습니다 — 그건 폰에서 눌러봐야 압니다.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const results = [];
const ok = (what) => results.push({ mark: '✓', what });
const bad = (what, how) => results.push({ mark: '✗', what, how });
const warn = (what, how) => results.push({ mark: '⚠', what, how });

/** `vercel env pull .env.local` 이 만드는 파일을 읽어옵니다. 이미 있는 값은 안 덮습니다. */
export function loadEnvFile(path = '.env.local') {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
}

/* VAPID 키는 P-256 한 쌍입니다. 공개키 87자, 비밀키 43자, 둘 다 base64url. */
const shaped = (v, len) => typeof v === 'string' && v.length === len && /^[A-Za-z0-9_-]+$/.test(v);
const MAKE_KEYS = 'node -e "console.log(require(\'web-push\').generateVAPIDKeys())" 로 한 쌍 만들어 넣으세요';

export async function checkEnv() {
  const password = process.env.DIARY_PASSWORD;
  if (!password) bad('DIARY_PASSWORD', 'vercel env add DIARY_PASSWORD — 둘이 공유할 비밀번호');
  else if (password.length < 12) warn('DIARY_PASSWORD', `${password.length}자입니다. 주소만 알면 누구나 로그인 화면까지 닿으니 길게 잡으세요`);
  else ok('DIARY_PASSWORD');

  if (process.env.DIARY_SECRET) ok('DIARY_SECRET');
  else bad('DIARY_SECRET', 'vercel env add DIARY_SECRET — 아무 긴 문자열');

  for (const [name, len] of [['VAPID_PUBLIC_KEY', 87], ['VAPID_PRIVATE_KEY', 43]]) {
    const value = process.env[name];
    if (shaped(value, len)) ok(name);
    else if (value) bad(name, `모양이 이상합니다 (${len}자 base64url이어야 하는데 ${value.length}자). ${MAKE_KEYS}`);
    else bad(name, MAKE_KEYS);
  }

  try {
    const { subject } = await import('./lib/push.js');
    ok(`알림 연락처 (${subject()})`);
  } catch {
    bad('알림 연락처', 'VAPID_SUBJECT 나 DIARY_URL 에 배포 주소를 넣으세요 (Vercel에 올리면 VERCEL_URL로 저절로 됩니다)');
  }
}

const WANT = ['events', 'settings', 'photos', 'push_subs'];

/** query(문장) -> rows. 테스트에서는 PGlite를 넘깁니다 (lib/db.js의 useClient와 같은 방식). */
export async function checkDb(query) {
  const rows = await query(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  ok('DB 연결');

  const have = new Set(rows.map((r) => r.table_name));
  const missing = WANT.filter((t) => !have.has(t));
  if (missing.length) return bad(`표 (${missing.join(', ')} 없음)`, 'npm run schema');
  ok(`표 ${WANT.length}개`);

  const counted = await query('select count(*)::int as n from settings where id = 1');
  if (counted[0]?.n === 1) ok('설정 한 줄');
  else bad('설정 줄이 없습니다', 'npm run schema');
}

/** 지금까지 쌓인 결과를 찍고 { failed, warned }를 돌려줍니다. */
export function report() {
  for (const r of results) console.log(`${r.mark} ${r.what}${r.how ? `\n    → ${r.how}` : ''}`);
  const failed = results.filter((r) => r.mark === '✗').length;
  const warned = results.filter((r) => r.mark === '⚠').length;
  console.log();
  if (failed) console.log(`${failed}개가 아직 안 맞습니다. 위 화살표대로 고치고 다시 돌려주세요.`);
  else console.log(warned ? `준비됐습니다 (다만 ⚠ ${warned}개는 보고 넘어가세요).` : '준비됐습니다.');
  return { failed, warned };
}

/* 직접 실행했을 때만 진짜 DB에 붙습니다 (import 하면 안 붙습니다). */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile();

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (dbUrl) ok('DATABASE_URL');
  else bad('DATABASE_URL', 'vercel integration add neon 으로 DB를 붙이고 vercel env pull .env.local');

  await checkEnv();

  if (dbUrl) {
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(dbUrl);
      await checkDb((text) => sql.query(text));
    } catch (e) {
      bad('DB 연결', `${e.message} — DATABASE_URL이 맞는지 보세요`);
    }
  }

  if (report().failed) process.exit(1);
}
