/**
 * 실제 핸들러를 진짜 Postgres(PGlite, 인메모리)에 물려서 돌립니다.
 * Neon 대신 PGlite를 끼워 넣는 것 말고는 배포될 코드와 같은 경로를 탑니다.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { useClient } from './lib/db.js';

process.env.DIARY_PASSWORD = 'testpw';
process.env.DIARY_URL = 'https://diary.test';
process.env.DATABASE_URL = 'postgres://pglite.test'; // 실제로 붙지는 않습니다 — 아래 useClient가 가로챕니다

/* 표를 미리 만들지 않습니다. Deploy 버튼으로 막 만든 DB처럼 텅 빈 채로 시작해서,
   첫 로그인이 표와 열쇠를 만드는지 봅니다. */
const pg = new PGlite();

// 태그드 템플릿 -> $1, $2 ... 로 바꿔서 PGlite에 넘깁니다.
const client = (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return pg.query(text, values).then((r) => r.rows);
};
let statementsRun = 0;
client.query = (text) => { statementsRun++; return pg.query(text).then((r) => r.rows); };
useClient(client);

const { default: login } = await import('./api/login.js');
const { default: state } = await import('./api/state.js');
const { default: settings } = await import('./api/settings.js');
const { default: eventsCreate } = await import('./api/events/index.js');
const { default: eventById } = await import('./api/events/[id].js');

/* 최소한의 가짜 req/res */
function call(handler, { method = 'GET', body, token, query = {} } = {}) {
  const req = { method, body, query, headers: token ? { authorization: 'Bearer ' + token } : {} };
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const out = { status: 200, body: undefined, headers: {} };
  const res = {
    status(code) { out.status = code; return res; },
    setHeader(k, v) { out.headers[k] = v; return res; },
    json(payload) { out.body = payload; resolve(out); return res; },
    end(payload) { if (payload !== undefined) out.body = payload; resolve(out); return res; },
  };
  handler(req, res);
  return done;
}

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

const { keys, forgetKeys } = await import('./lib/setup.js');
const tables = async () =>
  (await pg.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`))
    .rows.map((row) => row.table_name).join();
const meta = async () =>
  Object.fromEntries((await pg.query('select name, value from app_meta order by name')).rows.map((row) => [row.name, row.value]));

/* ── 인증 ── */
let r = await call(login, { method: 'POST', body: { password: 'nope' } });
ok('wrong password rejected', r.status === 401);

r = await call(login, { method: 'POST', body: { password: 'testpw' } });
let token = r.body.token;
ok('login returns token', r.status === 200 && typeof token === 'string' && token.length === 64);

/* ── 처음 켜질 때 — 설치하는 사람이 표도 열쇠도 만들지 않습니다 ── */
ok('the first sign-in creates the tables',
  (await tables()) === 'app_meta,events,photos,push_subs,reminders_sent,settings', await tables());
const first = await meta();
ok('it makes a sign-in secret and a clock key',
  /^[0-9a-f]{48}$/.test(first.diary_secret) && /^[0-9a-f]{48}$/.test(first.cron_secret) && first.diary_secret !== first.cron_secret);
const firstVapid = JSON.parse(first.vapid);
ok('it makes a VAPID pair of the right shape',
  /^[A-Za-z0-9_-]{87}$/.test(firstVapid.publicKey) && /^[A-Za-z0-9_-]{43}$/.test(firstVapid.privateKey));

/* 서버 인스턴스가 새로 떠도 (배포, 콜드 스타트) 같은 열쇠를 써야 합니다 —
   바뀌면 둘 다 로그아웃되고 켜둔 알림이 전부 죽습니다 */
forgetKeys();
statementsRun = 0;
r = await call(login, { method: 'POST', body: { password: 'testpw' } });
ok('a fresh instance keeps the same token', r.body.token === token);
ok('and does not run the schema again', statementsRun === 0, String(statementsRun));
ok('and does not replace any key', JSON.stringify(await meta()) === JSON.stringify(first));

/* schema.sql이 바뀌면(새 컬럼 등) 다음 인스턴스가 다시 돌립니다. 열쇠는 그대로. */
await pg.query(`update app_meta set value = 'old' where name = 'schema'`);
forgetKeys();
r = await call(login, { method: 'POST', body: { password: 'testpw' } });
ok('a changed schema.sql is applied again', statementsRun > 0 && (await meta()).schema !== 'old');
ok('without touching the keys', r.body.token === token && (await meta()).vapid === first.vapid);

/* 두 인스턴스가 동시에 처음 뜨면 둘 다 열쇠를 만들려 합니다. 한쪽 것만 남아야 해요. */
await pg.query(`delete from app_meta where name in ('diary_secret', 'cron_secret', 'vapid')`);
forgetKeys();
const racing = await Promise.all([keys(), (forgetKeys(), keys())]);
ok('two instances racing agree on one set of keys',
  JSON.stringify(racing[0]) === JSON.stringify(racing[1]) && racing[0].vapidPublic === JSON.parse((await meta()).vapid).publicKey);
/* 위에서 열쇠를 갈았으니, 뒤의 테스트가 쓸 토큰을 새로 받습니다 */
r = await call(login, { method: 'POST', body: { password: 'testpw' } });
const oldToken = token;
ok('a replaced secret signs everyone out', r.body.token !== oldToken);
token = r.body.token;

/* Deploy 화면에서 Neon을 건너뛰면 — 무엇이 빠졌는지 말해줍니다 */
{
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  r = await call(login, { method: 'POST', body: { password: 'testpw' } });
  ok('no database says so', r.status === 500 && r.body.error === 'error.noDatabase', JSON.stringify(r.body));
  r = await call(state, { token });
  ok('and so does every other call', r.status === 500 && r.body.error === 'error.noDatabase');
  process.env.DATABASE_URL = saved;
}

r = await call(state);
ok('no token blocked', r.status === 401);

r = await call(state, { token: 'a'.repeat(64) });
ok('wrong token blocked', r.status === 401);

r = await call(login, { method: 'GET' });
ok('wrong method 405', r.status === 405);

/* ── 만들기 ── */
r = await call(eventsCreate, {
  method: 'POST', token,
  body: { title: '영화 보기', date: '2026-08-22', time: '19:30', owner: 'both', memo: '메가박스' },
});
const movie = r.body;
ok('create returns 201', r.status === 201);
ok('date not shifted by timezone', movie.date === '2026-08-22', movie.date);
ok('time round-trips', movie.time === '19:30');
ok('memo round-trips', movie.memo === '메가박스');

r = await call(eventsCreate, {
  method: 'POST', token,
  body: { title: '스터디', date: '2026-08-24', time: '10:00', endTime: '12:30', owner: 'both' },
});
const study = r.body;
ok('endTime round-trips', study.time === '10:00' && study.endTime === '12:30');
await call(eventById, { method: 'DELETE', token, query: { id: study.id } });

r = await call(eventsCreate, {
  method: 'POST', token,
  body: { title: '메모만', date: '2026-08-24', endTime: '12:30', owner: 'both' },
});
ok('endTime ignored without time', r.body.time === null && r.body.endTime === null);
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id } });

r = await call(eventsCreate, {
  method: 'POST', token,
  body: { title: '생일', date: '1995-08-25', owner: 'b', repeat: 'yearly' },
});
ok('yearly repeat stored', r.body.repeat === 'yearly' && r.body.owner === 'b');

r = await call(eventsCreate, {
  method: 'POST', token,
  body: { title: '여행', date: '2026-08-28', endDate: '2026-08-30', owner: 'both' },
});
const trip = r.body;
ok('endDate stored', trip.endDate === '2026-08-30', String(trip.endDate));

/* ── 검증 ── */
r = await call(eventsCreate, { method: 'POST', token, body: { title: '   ', date: '2026-08-22' } });
ok('blank title 400', r.status === 400, r.body?.error);

r = await call(eventsCreate, { method: 'POST', token, body: { title: 'x', date: '22/08/2026' } });
ok('bad date 400', r.status === 400);

r = await call(eventsCreate, { method: 'POST', token, body: { title: '거꾸로', date: '2026-08-10', endDate: '2026-08-01' } });
ok('reversed date range 400', r.status === 400, r.body?.error);

r = await call(eventsCreate, { method: 'POST', token, body: { title: '거꾸로', date: '2026-08-10', time: '18:00', endTime: '09:00' } });
ok('reversed time range 400', r.status === 400, r.body?.error);

r = await call(eventsCreate, { method: 'POST', token, body: { title: 'x', date: '2026-08-10', owner: '해커', repeat: 'drop' } });
ok('bad enums fall back', r.body.owner === 'both' && r.body.repeat === 'none');
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id } });

r = await call(eventsCreate, { method: 'POST', token, body: { title: 'a'.repeat(200), date: '2026-08-10' } });
ok('long title clipped to 80', r.body.title.length === 80);
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id } });

r = await call(eventsCreate, { method: 'POST', token, body: { title: "Bobby'; drop table events;--", date: '2026-08-10' } });
ok('sql injection is just text', r.status === 201 && r.body.title.includes('drop table'));
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id } });
r = await call(state, { token });
ok('events table survived', Array.isArray(r.body.events));

/* ── 고치기 / 지우기 ── */
r = await call(eventById, {
  method: 'PATCH', token, query: { id: movie.id },
  body: { title: '영화 보기 (변경)', date: '2026-08-23' },
});
ok('patch merges base', r.status === 200 && r.body.owner === 'both' && r.body.memo === '메가박스');
ok('patch applies change', r.body.date === '2026-08-23' && r.body.title.includes('변경'));

r = await call(eventById, { method: 'PATCH', token, query: { id: 'not-a-uuid' }, body: { title: 'x' } });
ok('bad id 404 not 500', r.status === 404);

r = await call(eventById, { method: 'DELETE', token, query: { id: '00000000-0000-0000-0000-000000000000' } });
ok('missing id 404', r.status === 404);

r = await call(eventById, { method: 'DELETE', token, query: { id: trip.id } });
ok('delete 204', r.status === 204);

r = await call(eventById, { method: 'DELETE', token, query: { id: trip.id } });
ok('double delete 404', r.status === 404);

/* ── 설정 ── */
r = await call(settings, {
  method: 'PATCH', token,
  body: { names: { a: '나', b: '너' }, since: '2023-05-14', showMilestones: true },
});
ok('settings saved', r.status === 200 && r.body.names.b === '너');
ok('since is a plain string', r.body.since === '2023-05-14', String(r.body.since));

r = await call(settings, { method: 'PATCH', token, body: { names: { a: '', b: '너' } } });
ok('an empty name stays empty for the language pack to fill', r.body.names.a === '', r.body.names.a);
ok('partial patch keeps since', r.body.since === '2023-05-14');

r = await call(settings, { method: 'PATCH', token, body: { since: null } });
ok('since can be cleared', r.body.since === null);

/* 달력 이름 */
r = await call(settings, { method: 'PATCH', token });
ok('a fresh calendar has no name of its own', r.body.title === '', r.body.title);

await call(settings, { method: 'PATCH', token, body: { names: { a: '나', b: '너' }, since: '2023-05-14' } });
r = await call(settings, { method: 'PATCH', token, body: { title: '우리어리' } });
ok('title saved', r.body.title === '우리어리', r.body.title);
ok('naming the calendar keeps the rest',
  r.body.names.a === '나' && r.body.since === '2023-05-14', JSON.stringify(r.body));

r = await call(settings, { method: 'PATCH', token, body: { title: '   ' } });
ok('a blank title stays blank', r.body.title === '', r.body.title);

r = await call(settings, { method: 'PATCH', token, body: { title: '열두글자를넘기면잘립니다정말로' } });
ok('title clipped to 12', r.body.title.length === 12, r.body.title);

/* 인사말도 따로 고칩니다 — 이름에서 만들어 쓰지 않습니다 */
r = await call(settings, { method: 'PATCH', token });
ok('a fresh calendar has no greeting of its own', r.body.subtitle === '', r.body.subtitle);

r = await call(settings, { method: 'PATCH', token, body: { subtitle: '밥 먹었니' } });
ok('greeting saved', r.body.subtitle === '밥 먹었니', r.body.subtitle);
ok('greeting does not touch the name', r.body.title.length === 12, r.body.title);

r = await call(settings, { method: 'PATCH', token, body: { subtitle: '  ' } });
ok('a blank greeting stays blank', r.body.subtitle === '', r.body.subtitle);

r = await call(settings, { method: 'PATCH', token, body: { subtitle: '스무글자를넘기면잘립니다정말로그렇습니다진짜로' } });
ok('greeting clipped to 20', r.body.subtitle.length === 20, r.body.subtitle);

/* 테마는 둘이 같이 쓸 수 있어야 합니다 */
r = await call(settings, { method: 'PATCH', token });
ok('theme has a default', r.body.theme === 'peach', r.body.theme);

r = await call(settings, { method: 'PATCH', token, body: { theme: 'night' } });
ok('shared theme saved', r.body.theme === 'night', r.body.theme);

r = await call(state, { token });
ok('the other side sees the shared theme', r.body.settings.theme === 'night', r.body.settings.theme);

r = await call(settings, { method: 'PATCH', token, body: { theme: '' } });
ok('blank theme falls back', r.body.theme === 'peach', r.body.theme);
await call(settings, { method: 'PATCH', token, body: { subtitle: '우리 오늘 뭐하지' } });

/* 언어와 공휴일 묶음도 둘이 같이 씁니다 */
r = await call(settings, { method: 'PATCH', token });
ok('language starts unpicked, so the screen uses the browser language', r.body.locale === '', r.body.locale);
ok('no holiday set by default', r.body.region === 'none', r.body.region);

r = await call(settings, { method: 'PATCH', token, body: { locale: 'ko', region: 'kr' } });
ok('language saved', r.body.locale === 'ko', r.body.locale);
ok('holiday set saved', r.body.region === 'kr', r.body.region);

r = await call(state, { token });
ok('the other side sees the language', r.body.settings.locale === 'ko', r.body.settings.locale);

r = await call(settings, { method: 'PATCH', token, body: { showMilestones: true } });
ok('changing another setting keeps the language', r.body.locale === 'ko', r.body.locale);

r = await call(settings, { method: 'PATCH', token, body: { locale: '' } });
ok('a blank language falls back to English', r.body.locale === 'en', r.body.locale);

/* 예전 판은 기본값이 'en'이라 한국어 폰도 로그인하자마자 영어가 됐습니다.
   그 DB는 다음 배포 때 한 번만 비워지고, 그 뒤에 고른 영어는 그대로 남아야 합니다. */
{
  const rerunSchema = async () => {
    await pg.query(`update app_meta set value = 'old' where name = 'schema'`);
    forgetKeys();
    await call(login, { method: 'POST', body: { password: 'testpw' } });
  };
  const localeDefault = async () => (await pg.query(
    `select column_default from information_schema.columns where table_name = 'settings' and column_name = 'locale'`,
  )).rows[0].column_default;

  await pg.query(`alter table settings alter column locale set default 'en'`);
  await pg.query(`update settings set locale = 'en'`);
  await rerunSchema();
  r = await call(state, { token });
  ok('an old database forgets the English it never chose', r.body.settings.locale === '', r.body.settings.locale);
  ok('and its default is blank from now on', (await localeDefault()) === "''::text", await localeDefault());

  await call(settings, { method: 'PATCH', token, body: { locale: 'en' } });
  await rerunSchema();
  r = await call(state, { token });
  ok('English picked afterwards survives the next schema change', r.body.settings.locale === 'en', r.body.settings.locale);

  await pg.query(`alter table settings alter column locale set default 'en'`);
  await pg.query(`update settings set locale = 'ko'`);
  await rerunSchema();
  r = await call(state, { token });
  ok('an old database keeps a language someone did pick', r.body.settings.locale === 'ko', r.body.settings.locale);
  await call(settings, { method: 'PATCH', token, body: { locale: 'en' } });
}

r = await call(state, { token });
ok('state carries the title', r.body.settings.title === r.body.settings.title && r.body.settings.title.length === 12);

/* title 컬럼이 없는 DB에서도 달력은 열려야 합니다 (alter를 아직 안 돌린 경우) */
await pg.query('alter table settings drop column subtitle, drop column theme');
r = await call(state, { token });
ok('a missing column does not wipe the ones that exist',
  r.status === 200 && r.body.settings.title.length === 12 && r.body.settings.subtitle === '' && r.body.settings.theme === 'peach',
  JSON.stringify(r.body.settings));
ok('the rest of the settings survive', r.body.settings.names.b === '너');

r = await call(settings, { method: 'PATCH', token, body: { names: { a: '나', b: '두리' }, since: '2024-01-02' } });
ok('settings still save without the title column', r.status === 200, JSON.stringify(r.body));
ok('the saved values come back', r.body.names.b === '두리' && r.body.since === '2024-01-02');
await pg.query("alter table settings add column subtitle text not null default '우리 오늘 뭐하지'");
await pg.query("alter table settings add column theme text not null default '복숭아'");
await call(settings, { method: 'PATCH', token, body: { title: '우리어리' } });
await call(settings, { method: 'PATCH', token, body: { names: { a: '나', b: '너' }, since: '2023-05-14' } });

/* 색을 고르고 곧바로 저장을 누르면 PATCH 둘이 겹칩니다. 예전에는 읽고-합치고-
   덮어쓰기라, 나중에 읽은 쪽이 먼저 쓴 쪽을 통째로 지웠습니다. */
const [themeSave, basicSave] = await Promise.all([
  call(settings, { method: 'PATCH', token, body: { theme: '바다' } }),
  call(settings, { method: 'PATCH', token, body: { title: '겹쳐도', subtitle: '안 지워져요' } }),
]);
ok('both overlapping saves answer with the theme they set',
  themeSave.body.theme === '바다' && basicSave.body.theme === '바다',
  `${themeSave.body.theme} / ${basicSave.body.theme}`);

r = await call(settings, { method: 'PATCH', token });
ok('overlapping saves do not wipe each other',
  r.body.theme === '바다' && r.body.title === '겹쳐도' && r.body.subtitle === '안 지워져요',
  JSON.stringify(r.body));
ok('the columns nobody touched stay put',
  r.body.names.b === '너' && r.body.since === '2023-05-14',
  JSON.stringify(r.body));

await call(settings, { method: 'PATCH', token, body: { title: '우리어리', subtitle: '우리 오늘 뭐하지', theme: '복숭아' } });

/* ── 최종 상태 ── */
r = await call(state, { token });
ok('state shape', r.status === 200 && Array.isArray(r.body.events) && !!r.body.settings);
ok('remaining events', r.body.events.length === 2, `${r.body.events.length}개`);
ok('sorted by date', r.body.events[0].date <= r.body.events[1].date);
ok('client field names intact',
  Object.keys(r.body.events[0]).includes('endDate') && Object.keys(r.body.events[0]).includes('repeat'));

/* ── 달력 사진 ── */
const { default: photosCreate } = await import('./api/photos/index.js');
const { default: photoById } = await import('./api/photos/[id].js');

// 1x1 투명 webp (진짜 바이트라 mime/크기 검사가 실제로 돌아갑니다)
const TINY = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';

r = await call(photosCreate, { method: 'POST', body: { mime: 'image/webp', data: TINY } });
ok('photo upload needs token', r.status === 401);

r = await call(photosCreate, { method: 'POST', token, body: { mime: 'text/html', data: TINY } });
ok('only images accepted', r.status === 400, r.body?.error);

r = await call(photosCreate, { method: 'POST', token, body: { mime: 'image/webp', data: 'not base64!!' } });
ok('junk data rejected', r.status === 400, r.body?.error);

r = await call(photosCreate, {
  method: 'POST', token,
  body: { mime: 'image/webp', data: 'A'.repeat(500_000) },
});
ok('oversized photo rejected', r.status === 400, r.body?.error);

r = await call(photosCreate, { method: 'POST', token, body: { mime: 'image/webp', data: TINY } });
const photoId = r.body?.id;
ok('photo uploaded', r.status === 201 && typeof photoId === 'string');

r = await call(state, { token });
ok('state lists the photo', r.body.photos?.length === 1 && r.body.photos[0] === photoId);

r = await call(photoById, { method: 'GET', query: { id: photoId } });
ok('photo serves the bytes', r.status === 200 && Buffer.isBuffer(r.body));
ok('photo bytes round-trip', r.body?.toString('base64') === TINY);
ok('photo served as webp', r.headers['Content-Type'] === 'image/webp');
ok('photo is cacheable', String(r.headers['Cache-Control']).includes('immutable'), r.headers['Cache-Control']);

r = await call(photoById, { method: 'GET', query: { id: 'not-a-uuid' } });
ok('bad photo id 404', r.status === 404);

r = await call(photoById, { method: 'GET', query: { id: '00000000-0000-0000-0000-000000000000' } });
ok('missing photo 404', r.status === 404);

r = await call(photoById, { method: 'DELETE', query: { id: photoId } });
ok('photo delete needs token', r.status === 401);

r = await call(photoById, { method: 'DELETE', token, query: { id: photoId } });
ok('photo deleted', r.status === 204);

r = await call(photoById, { method: 'DELETE', token, query: { id: photoId } });
ok('double delete 404', r.status === 404);

r = await call(state, { token });
ok('state drops the deleted photo', r.body.photos.length === 0);

/* 30장이 넘으면 안 받습니다 */
for (let i = 0; i < 29; i++) {
  await pg.query("insert into photos (mime, data) values ('image/webp', $1)", [TINY]);
}
r = await call(photosCreate, { method: 'POST', token, body: { mime: 'image/webp', data: TINY } });
ok('30th photo still fits', r.status === 201, r.body?.error);

r = await call(photosCreate, { method: 'POST', token, body: { mime: 'image/webp', data: TINY } });
ok('31st photo rejected', r.status === 400, r.body?.error);

await pg.query('delete from photos');
r = await call(state, { token });
ok('photos cleared for the next test', r.body.photos.length === 0);



/* ── 휴대폰 알림 (웹푸시) ── */
const { default: pushApi } = await import('./api/push/index.js');
const { useSender } = await import('./lib/push.js');

/* 진짜로 보내지 않고, 무엇을 어디로 보냈는지만 적어둡니다 */
const pushed = [];
let pushStatus = 0; // 0이면 성공, 아니면 그 코드로 실패시킵니다
useSender(async (target, payload) => {
  if (pushStatus) {
    const e = new Error('푸시 실패');
    e.statusCode = pushStatus;
    throw e;
  }
  pushed.push({ endpoint: target.endpoint, ...JSON.parse(payload) });
});

const PHONE = 'https://web.push.apple.com/aaa1';
const LAPTOP = 'https://fcm.googleapis.com/fcm/send/bbb2';
const device = (endpoint) => ({ endpoint, keys: { p256dh: 'P256DH', auth: 'AUTH' } });
const subscribe = (owner, endpoint) =>
  call(pushApi, { method: 'POST', token, body: { owner, subscription: device(endpoint) } });
const countSubs = async () => (await pg.query('select count(*)::int as n from push_subs')).rows[0].n;

r = await call(pushApi, { method: 'GET' });
ok('push key needs token', r.status === 401);

r = await call(pushApi, { method: 'PATCH', token });
ok('push wrong method 405', r.status === 405);

r = await call(pushApi, { method: 'GET', token });
ok('push hands out the public key it made', r.body.publicKey === (await keys()).vapidPublic && r.body.publicKey.length === 87);

r = await call(pushApi, { method: 'POST', token, body: { owner: '해커', subscription: device(PHONE) } });
ok('push bad owner 400', r.status === 400, r.body?.error);

r = await call(pushApi, { method: 'POST', token, body: { owner: 'a', subscription: { endpoint: 'http://nope' } } });
ok('push bad subscription 400', r.status === 400, r.body?.error);

r = await subscribe('a', PHONE);
ok('phone subscribed', r.status === 201);

r = await subscribe('a', LAPTOP);
ok('second device subscribed', r.status === 201);

r = await subscribe('a', PHONE);
ok('same device does not pile up', r.status === 201 && (await countSubs()) === 2);

/* b가 일정을 만들면 a의 기기 둘 다 울린다 */
pushed.length = 0;
r = await call(eventsCreate, {
  method: 'POST', token,
  body: { title: '치과', date: '2026-09-12', time: '19:00', actor: 'b' },
});
const visit = r.body;
ok('both devices get a push', r.status === 201 && pushed.length === 2, String(pushed.length));
ok('push says who changed it', pushed[0]?.title === 'New event · 너', JSON.stringify(pushed[0]?.title));
ok('push says what and when', pushed[0]?.body === 'Sat, September 12 19:00\n치과', JSON.stringify(pushed[0]?.body));
ok('push groups by event', pushed[0]?.tag === visit.id);

/* 내가 바꾼 건 나한테 오지 않는다 */
pushed.length = 0;
r = await call(eventsCreate, { method: 'POST', token, body: { title: '혼잣말', date: '2026-09-13', actor: 'a' } });
ok('no push to the one who changed it', pushed.length === 0);
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id, actor: 'a' } });

/* 고치고 지울 때도 알린다 */
pushed.length = 0;
await call(eventById, {
  method: 'PATCH', token, query: { id: visit.id }, body: { title: '치과 (미뤘어요)', actor: 'b' },
});
ok('edit pushes', pushed[0]?.title.includes('Event changed'), JSON.stringify(pushed[0]?.title));

pushed.length = 0;
r = await call(eventById, { method: 'DELETE', token, query: { id: visit.id, actor: 'b' } });
ok('delete pushes with the title', r.status === 204 && pushed[0]?.body.includes('치과'));

/* 푸시가 죽어도 일정은 저장된다 */
pushStatus = 500;
r = await call(eventsCreate, { method: 'POST', token, body: { title: '푸시 먹통', date: '2026-09-14', actor: 'b' } });
ok('event saved even when push fails', r.status === 201 && r.body.title === '푸시 먹통');
ok('a failed push keeps the device', (await countSubs()) === 2);
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id, actor: 'b' } });

/* 410은 앱을 지웠거나 만료된 것 — 그 줄을 치운다 */
pushStatus = 410;
r = await call(eventsCreate, { method: 'POST', token, body: { title: '만료', date: '2026-09-15', actor: 'b' } });
ok('expired devices are cleaned up', (await countSubs()) === 0);
pushStatus = 0;
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id, actor: 'b' } });

/* 한 기기만 꺼도 다른 기기는 그대로 */
await subscribe('a', PHONE);
await subscribe('a', LAPTOP);

r = await call(pushApi, { method: 'DELETE', token });
ok('unsubscribe needs an endpoint', r.status === 400, r.body?.error);

r = await call(pushApi, { method: 'DELETE', token, query: { endpoint: PHONE } });
ok('one device turned off', r.status === 204 && (await countSubs()) === 1);

pushed.length = 0;
r = await call(eventsCreate, { method: 'POST', token, body: { title: '노트북만', date: '2026-09-16', actor: 'b' } });
ok('the other device still gets it',
  pushed.length === 1 && pushed[0].endpoint === LAPTOP, JSON.stringify(pushed));
await call(eventById, { method: 'DELETE', token, query: { id: r.body.id, actor: 'b' } });



/* VAPID 연락처 — DIARY_URL이 없다고 알림이 통째로 죽으면 안 됩니다 (2026-09-07 실제로 그랬음) */
const { subject } = await import('./lib/push.js');
const withEnv = (vars, fn) => {
  const saved = { ...process.env };
  for (const k of ['VAPID_SUBJECT', 'DIARY_URL', 'VERCEL_URL']) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally { process.env = saved; }
};

ok('subject prefers VAPID_SUBJECT',
  withEnv({ VAPID_SUBJECT: 'mailto:a@b.c', DIARY_URL: 'https://x' }, subject) === 'mailto:a@b.c');
ok('subject falls back to DIARY_URL',
  withEnv({ DIARY_URL: 'https://diary.test/' }, subject) === 'https://diary.test');
ok('subject survives without DIARY_URL',
  withEnv({ VERCEL_URL: 'diary.vercel.app' }, subject) === 'https://diary.vercel.app');
ok('subject complains when nothing is set',
  withEnv({}, () => { try { subject(); return false; } catch { return true; } }));


/* ── 오늘 일정 알림 (바깥 시계가 두드립니다) ── */
const { default: cron } = await import('./api/cron.js');

/* 열쇠는 앱이 만들었고, 두 사람은 설정 화면에서 봅니다 */
r = await call(settings, { method: 'GET' });
ok('the clock key needs a token', r.status === 401);
r = await call(settings, { method: 'GET', token });
const CRON = r.body.cronKey;
ok('settings hands the clock key to the two of them', CRON === (await keys()).cronSecret, JSON.stringify(r.body));

const DAY = '2026-10-05';
const knock = (at, key = CRON) => call(cron, { method: 'GET', query: { key, at } });
const tick = (hhmm) => knock(`${DAY}T${hhmm}`);

r = await call(cron, { method: 'GET' });
ok('cron needs the key', r.status === 401);

r = await call(cron, { method: 'GET', query: { key: 'wrong' } });
ok('cron rejects a wrong key', r.status === 401);

r = await call(cron, { method: 'DELETE', query: { key: CRON } });
ok('cron wrong method 405', r.status === 405);

/* 시간대는 설정에 담깁니다 — 아무 값이나 담기면 알림이 엉뚱한 시각에 갑니다 */
r = await call(settings, { method: 'PATCH', token, body: { timezone: 'Asia/Seoul' } });
ok('a time zone is saved', r.body.timezone === 'Asia/Seoul', String(r.body.timezone));

r = await call(settings, { method: 'PATCH', token, body: { timezone: 'Mars/Olympus' } });
ok('an unknown time zone falls back to UTC', r.body.timezone === 'UTC', String(r.body.timezone));

r = await call(settings, { method: 'PATCH', token, body: { locale: 'en', timezone: 'Asia/Seoul' } });
ok('the time zone survives a locale change', r.body.timezone === 'Asia/Seoul');

/* 둘 다 받아야 하는 알림이라 기기를 둘 다 켭니다 */
await subscribe('a', LAPTOP);
await subscribe('b', PHONE);

const plant = async (body) => (await call(eventsCreate, { method: 'POST', token, body })).body;
const dawn = await plant({ title: 'red-eye flight', date: DAY, time: '03:00' });
const airport = await plant({ title: 'leave for airport', date: DAY, time: '06:00', memo: 'passport!' });
await plant({ title: 'overslept', date: DAY, time: '07:00' });
await plant({ title: 'dentist', date: DAY, time: '09:30' });
await plant({ title: 'walk', date: DAY });
await plant({ title: 'rent', date: '2026-04-05', time: '10:00', repeat: 'monthly' });
await plant({ title: 'trip', date: '2026-10-04', endDate: '2026-10-06' });

pushed.length = 0;
r = await tick('03:00');
ok('nothing before the clock starts at 4', r.status === 200 && r.body.sent.length === 0);
ok('the answer says which zone it read', r.body.zone === 'Asia/Seoul', String(r.body.zone));

r = await tick('04:00');
ok('an event before 4am is pulled forward to 4', r.body.sent.join() === `soon: ${dawn.title}`, JSON.stringify(r.body.sent));
ok('both people get it', pushed.length === 2, String(pushed.length));

pushed.length = 0;
r = await tick('04:10');
ok('the same reminder does not go twice', r.body.sent.length === 0 && pushed.length === 0);

r = await tick('05:30');
ok('an early event fires 30 minutes ahead', r.body.sent.join() === 'soon: leave for airport', JSON.stringify(r.body.sent));
ok('the reminder says the time and the memo',
  pushed[0]?.title === 'Starting soon' && pushed[0]?.body === '06:00 leave for airport\npassport!', JSON.stringify(pushed[0]));
ok('the reminder groups apart from the event itself', pushed[0]?.tag === `soon:${airport.id}`);

pushed.length = 0;
r = await tick('06:50');
ok('a reminder more than 15 minutes late is dropped', r.body.sent.length === 0 && pushed.length === 0);

r = await tick('08:00');
ok('the rest come as one digest at 8', r.body.sent.join() === 'today: 3 event(s)', JSON.stringify(r.body.sent));
ok('the digest counts in the title', pushed[0]?.title === '3 events today', JSON.stringify(pushed[0]?.title));
ok('the digest lists all-day first, then by time',
  pushed[0]?.body === 'All day walk\n09:30 dentist\n10:00 rent', JSON.stringify(pushed[0]?.body));
ok('the digest leaves out what already fired', !pushed[0]?.body.includes('airport'));
ok('the digest goes to both too', pushed.length === 2, String(pushed.length));

pushed.length = 0;
r = await tick('08:10');
ok('the digest does not go twice', r.body.sent.length === 0 && pushed.length === 0);

r = await tick('12:00');
ok('nothing after the window closes', r.body.sent.length === 0 && pushed.length === 0);

/* 여러 날 일정은 시작하는 날에만 — 걸친 날마다 아침을 울리지 않습니다 */
r = await knock('2026-10-04T08:00');
ok('a trip is announced on the day it starts', r.body.sent.join() === 'today: 1 event(s)', JSON.stringify(r.body.sent));
ok('one event reads as one in the title', pushed[0]?.title === '1 event today', JSON.stringify(pushed[0]?.title));
ok('the trip is not repeated on the days it spans', pushed[0]?.body === 'All day trip', JSON.stringify(pushed[0]?.body));

/* 알림도 두 사람이 고른 언어로 갑니다 */
pushed.length = 0;
r = await knock('2026-10-03T08:00');
ok('a quiet day stays quiet', r.body.sent.length === 0 && pushed.length === 0);

await call(settings, { method: 'PATCH', token, body: { locale: 'ko' } });
await plant({ title: '치과', date: '2026-10-02', time: '09:30' });
await plant({ title: '산책', date: '2026-10-02' });
pushed.length = 0;
r = await knock('2026-10-02T08:00');
ok('the digest speaks the language they picked',
  pushed[0]?.title === '오늘 일정 2개', JSON.stringify(pushed[0]?.title));
ok('and so does the all-day label',
  pushed[0]?.body === '종일 산책\n09:30 치과', JSON.stringify(pushed[0]?.body));
await call(settings, { method: 'PATCH', token, body: { locale: 'en' } });

/* 규칙 자체 — 시각 계산은 순수 함수라 따로 봅니다 */
const { plan, localNow, awake, resolveZone } = await import('./lib/remind.js');
ok('30 minutes before is the rule', plan([{ time: '06:00' }], 5 * 60 + 30).length === 1);
ok('not a minute earlier', plan([{ time: '06:00' }], 5 * 60 + 25).length === 0);
ok('8am events wait for the digest',
  plan([{ time: '08:10' }], 7 * 60 + 40).length === 0 && plan([{ time: '08:10' }], 8 * 60)[0]?.kind === 'today');
ok('the clock window is 4am to 8:15', !awake(3 * 60 + 59) && awake(4 * 60) && awake(8 * 60) && !awake(8 * 60 + 15));
ok('an unknown zone falls back to UTC', resolveZone('Mars/Olympus') === 'UTC' && resolveZone('Asia/Seoul') === 'Asia/Seoul');
ok('the day turns over where they live, not where the server is',
  localNow('Asia/Seoul', new Date('2026-09-14T22:30:00Z')).date === '2026-09-15'
  && localNow('UTC', new Date('2026-09-14T22:30:00Z')).date === '2026-09-14');
ok('midnight is 0 minutes, not 1440',
  localNow('Asia/Seoul', new Date('2026-09-14T15:00:00Z')).minutes === 0);
ok('zones west of UTC read the earlier day',
  localNow('America/New_York', new Date('2026-09-14T02:00:00Z')).date === '2026-09-13');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
