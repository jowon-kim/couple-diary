/**
 * 실제 핸들러를 진짜 Postgres(PGlite, 인메모리)에 물려서 돌립니다.
 * Neon 대신 PGlite를 끼워 넣는 것 말고는 배포될 코드와 같은 경로를 탑니다.
 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { useClient } from './lib/db.js';

process.env.DIARY_PASSWORD = 'testpw';
process.env.DIARY_SECRET = 'testsecret';
process.env.DIARY_URL = 'https://diary.test';

const pg = new PGlite();
await pg.exec(fs.readFileSync('./schema.sql', 'utf8'));

// 태그드 템플릿 -> $1, $2 ... 로 바꿔서 PGlite에 넘깁니다.
useClient((strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return pg.query(text, values).then((r) => r.rows);
});

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

/* ── 인증 ── */
let r = await call(login, { method: 'POST', body: { password: 'nope' } });
ok('wrong password rejected', r.status === 401);

r = await call(login, { method: 'POST', body: { password: 'testpw' } });
const token = r.body.token;
ok('login returns token', r.status === 200 && typeof token === 'string' && token.length === 64);

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
ok('empty name falls back', r.body.names.a === '나');
ok('partial patch keeps since', r.body.since === '2023-05-14');

r = await call(settings, { method: 'PATCH', token, body: { since: null } });
ok('since can be cleared', r.body.since === null);

/* 달력 이름 */
r = await call(settings, { method: 'PATCH', token });
ok('title defaults for a fresh calendar', r.body.title === '우리어리', r.body.title);

await call(settings, { method: 'PATCH', token, body: { names: { a: '나', b: '너' }, since: '2023-05-14' } });
r = await call(settings, { method: 'PATCH', token, body: { title: '우리어리' } });
ok('title saved', r.body.title === '우리어리', r.body.title);
ok('naming the calendar keeps the rest',
  r.body.names.a === '나' && r.body.since === '2023-05-14', JSON.stringify(r.body));

r = await call(settings, { method: 'PATCH', token, body: { title: '   ' } });
ok('blank title falls back', r.body.title === '우리어리', r.body.title);

r = await call(settings, { method: 'PATCH', token, body: { title: '열두글자를넘기면잘립니다정말로' } });
ok('title clipped to 12', r.body.title.length === 12, r.body.title);

/* 인사말도 따로 고칩니다 — 이름에서 만들어 쓰지 않습니다 */
r = await call(settings, { method: 'PATCH', token });
ok('greeting has a default', r.body.subtitle === '우리 오늘 뭐하지', r.body.subtitle);

r = await call(settings, { method: 'PATCH', token, body: { subtitle: '밥 먹었니' } });
ok('greeting saved', r.body.subtitle === '밥 먹었니', r.body.subtitle);
ok('greeting does not touch the name', r.body.title.length === 12, r.body.title);

r = await call(settings, { method: 'PATCH', token, body: { subtitle: '  ' } });
ok('blank greeting falls back', r.body.subtitle === '우리 오늘 뭐하지', r.body.subtitle);

r = await call(settings, { method: 'PATCH', token, body: { subtitle: '스무글자를넘기면잘립니다정말로그렇습니다진짜로' } });
ok('greeting clipped to 20', r.body.subtitle.length === 20, r.body.subtitle);

/* 테마는 둘이 같이 쓸 수 있어야 합니다 */
r = await call(settings, { method: 'PATCH', token });
ok('theme has a default', r.body.theme === '복숭아', r.body.theme);

r = await call(settings, { method: 'PATCH', token, body: { theme: '밤' } });
ok('shared theme saved', r.body.theme === '밤', r.body.theme);

r = await call(state, { token });
ok('the other side sees the shared theme', r.body.settings.theme === '밤', r.body.settings.theme);

r = await call(settings, { method: 'PATCH', token, body: { theme: '' } });
ok('blank theme falls back', r.body.theme === '복숭아', r.body.theme);
await call(settings, { method: 'PATCH', token, body: { subtitle: '우리 오늘 뭐하지' } });

r = await call(state, { token });
ok('state carries the title', r.body.settings.title === r.body.settings.title && r.body.settings.title.length === 12);

/* title 컬럼이 없는 DB에서도 달력은 열려야 합니다 (alter를 아직 안 돌린 경우) */
await pg.query('alter table settings drop column subtitle, drop column theme');
r = await call(state, { token });
ok('a missing column does not wipe the ones that exist',
  r.status === 200 && r.body.settings.title.length === 12 && r.body.settings.subtitle === '우리 오늘 뭐하지' && r.body.settings.theme === '복숭아',
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
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';

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
ok('push hands out the public key', r.body.publicKey === 'test-public-key');

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
ok('push says who changed it', pushed[0]?.title === '🍒 새 일정 · 너', JSON.stringify(pushed[0]?.title));
ok('push says what and when', pushed[0]?.body === '9월 12일 (토) 19:00\n치과', JSON.stringify(pushed[0]?.body));
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
ok('edit pushes', pushed[0]?.title.includes('일정 고침'), JSON.stringify(pushed[0]?.title));

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
