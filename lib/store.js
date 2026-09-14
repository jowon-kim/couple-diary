import { sql } from './db.js';

/* 날짜는 to_char로 문자열로 꺼냅니다. Date 객체로 받으면 시간대 때문에 하루씩 밀립니다. */
export async function listEvents() {
  return sql`
  select
    id,
    title,
    to_char(start_date, 'YYYY-MM-DD') as date,
    to_char(end_date,   'YYYY-MM-DD') as "endDate",
    at_time     as time,
    end_time    as "endTime",
    memo,
    owner,
    repeat_rule as repeat,
    created_at  as "createdAt",
    updated_at  as "updatedAt"
  from events
  order by start_date, at_time nulls first, title
`;
}

export async function findEvent(id) {
  const rows = await sql`
    select
      id,
      title,
      to_char(start_date, 'YYYY-MM-DD') as date,
      to_char(end_date,   'YYYY-MM-DD') as "endDate",
      at_time     as time,
      end_time    as "endTime",
      memo,
      owner,
      repeat_rule as repeat
    from events
    where id = ${id}
  `;
  return rows[0] || null;
}

export async function insertEvent(e) {
  const rows = await sql`
    insert into events (title, start_date, end_date, at_time, end_time, memo, owner, repeat_rule)
    values (${e.title}, ${e.date}, ${e.endDate}, ${e.time}, ${e.endTime}, ${e.memo}, ${e.owner}, ${e.repeat})
    returning
      id,
      title,
      to_char(start_date, 'YYYY-MM-DD') as date,
      to_char(end_date,   'YYYY-MM-DD') as "endDate",
      at_time     as time,
      end_time    as "endTime",
      memo,
      owner,
      repeat_rule as repeat,
      created_at  as "createdAt",
      updated_at  as "updatedAt"
  `;
  return rows[0];
}

export async function updateEvent(id, e) {
  const rows = await sql`
    update events set
      title       = ${e.title},
      start_date  = ${e.date},
      end_date    = ${e.endDate},
      at_time     = ${e.time},
      end_time    = ${e.endTime},
      memo        = ${e.memo},
      owner       = ${e.owner},
      repeat_rule = ${e.repeat},
      updated_at  = now()
    where id = ${id}
    returning
      id,
      title,
      to_char(start_date, 'YYYY-MM-DD') as date,
      to_char(end_date,   'YYYY-MM-DD') as "endDate",
      at_time     as time,
      end_time    as "endTime",
      memo,
      owner,
      repeat_rule as repeat,
      created_at  as "createdAt",
      updated_at  as "updatedAt"
  `;
  return rows[0] || null;
}

/** 지운 일정을 돌려줍니다 — 알림에 제목·날짜가 필요해서요. 없으면 null. */
export async function removeEvent(id) {
  const rows = await sql`
    delete from events
    where id = ${id}
    returning
      id,
      title,
      to_char(start_date, 'YYYY-MM-DD') as date,
      to_char(end_date,   'YYYY-MM-DD') as "endDate",
      at_time  as time,
      end_time as "endTime",
      memo
  `;
  return rows[0] || null;
}

const FALLBACK = {
  title: '',        // 비워두면 화면이 그 언어의 기본 이름을 씁니다
  subtitle: '',
  theme: 'peach',
  locale: 'en',
  region: 'none',   // 공휴일 묶음 (public/holidays/)
  timezone: 'UTC',  // 오늘 일정 알림이 "오늘"과 "아침 8시"를 재는 기준
  names: { a: '', b: '' },
  since: null,
  showMilestones: true,
};

/* 아직 없는 컬럼은 조회에서 빠지므로, 온 것만 얹고 나머지는 기본값을 씁니다. */
const shapeSettings = (row) => ({
  ...FALLBACK,
  ...(row.title !== undefined ? { title: row.title } : {}),
  ...(row.subtitle !== undefined ? { subtitle: row.subtitle } : {}),
  ...(row.theme !== undefined ? { theme: row.theme } : {}),
  ...(row.locale !== undefined ? { locale: row.locale } : {}),
  ...(row.region !== undefined ? { region: row.region } : {}),
  ...(row.timezone !== undefined ? { timezone: row.timezone } : {}),
  names: { a: row.name_a, b: row.name_b },
  since: row.since,
  showMilestones: row.show_milestones,
});

/**
 * 컬럼을 새로 붙이고 Neon에 alter를 돌리기 전 사이가 있습니다. 그때도 달력은
 * 열려야 하고, **있는 값은 살아남아야** 합니다 — 예전에 subtitle을 붙였다가
 * 달력 이름까지 기본값으로 돌아가버린 적이 있어서요.
 *
 * 그래서 넓은 것부터 좁은 것 순으로 읽습니다. alter를 돌리고 나면 첫 줄에서
 * 끝나고, 아래 갈래는 다시 타지 않습니다.
 */
export async function getSettings() {
  const tries = [
    () => sql`select title, subtitle, theme, locale, region, timezone, name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones from settings where id = 1`,
    () => sql`select title, subtitle, theme, locale, region, name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones from settings where id = 1`,
    () => sql`select title, subtitle, theme,                 name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones from settings where id = 1`,
    () => sql`select title, subtitle,        name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones from settings where id = 1`,
    () => sql`select title,                  name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones from settings where id = 1`,
    () => sql`select                         name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones from settings where id = 1`,
  ];

  for (let i = 0; i < tries.length; i++) {
    try {
      const rows = await tries[i]();
      const row = rows[0];
      if (!row) return { ...FALLBACK };
      if (i > 0) console.error('settings is missing a column — run the alter statements in schema.sql');
      return shapeSettings(row);
    } catch (e) {
      if (i === tries.length - 1) throw e;
    }
  }
}


/**
 * 보내온 칸만 바꾸고, 바뀐 줄을 그 자리에서 돌려줍니다.
 *
 * 예전에는 읽고(select) → JS에서 합치고 → 줄 전체를 쓰고(upsert) → 다시
 * 읽었습니다(select). 왕복이 세 번이라 느렸고, 무엇보다 **두 PATCH가 겹치면
 * 나중에 읽은 쪽이 먼저 쓴 쪽을 통째로 지웠습니다** — 색을 고르고 곧바로
 * 저장을 누르면 색이 없던 일이 됐어요.
 *
 * 이제 한 문장이라 겹쳐도 서로 건드리지 않습니다. 안 보낸 칸은 case-when이
 * 원래 값을 그대로 두거든요. (since는 null이 진짜 값이라 coalesce를 못 씁니다.)
 */
export async function patchSettings(p) {
  const has = (k) => k in p;
  let rows;
  try {
    rows = await sql`
      insert into settings (id, title, subtitle, theme, locale, region, timezone, name_a, name_b, since, show_milestones)
      values (
        1,
        coalesce(${p.title ?? null}::text, ''),
        coalesce(${p.subtitle ?? null}::text, ''),
        coalesce(${p.theme ?? null}::text, 'peach'),
        coalesce(${p.locale ?? null}::text, 'en'),
        coalesce(${p.region ?? null}::text, 'none'),
        coalesce(${p.timezone ?? null}::text, 'UTC'),
        coalesce(${p.names?.a ?? null}::text, ''),
        coalesce(${p.names?.b ?? null}::text, ''),
        ${p.since ?? null}::date,
        coalesce(${p.showMilestones ?? null}::boolean, true)
      )
      on conflict (id) do update set
        title           = case when ${has('title')}::boolean then excluded.title else settings.title end,
        subtitle        = case when ${has('subtitle')}::boolean then excluded.subtitle else settings.subtitle end,
        theme           = case when ${has('theme')}::boolean then excluded.theme else settings.theme end,
        locale          = case when ${has('locale')}::boolean then excluded.locale else settings.locale end,
        region          = case when ${has('region')}::boolean then excluded.region else settings.region end,
        timezone        = case when ${has('timezone')}::boolean then excluded.timezone else settings.timezone end,
        name_a          = case when ${has('names')}::boolean then excluded.name_a else settings.name_a end,
        name_b          = case when ${has('names')}::boolean then excluded.name_b else settings.name_b end,
        since           = case when ${has('since')}::boolean then excluded.since else settings.since end,
        show_milestones = case when ${has('showMilestones')}::boolean then excluded.show_milestones else settings.show_milestones end
      returning title, subtitle, theme, locale, region, timezone, name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones
    `;
  } catch (e) {
    console.error('settings is missing a column — run the alter statements in schema.sql', e.message);
    rows = await sql`
      insert into settings (id, name_a, name_b, since, show_milestones)
      values (
        1,
        coalesce(${p.names?.a ?? null}::text, ''),
        coalesce(${p.names?.b ?? null}::text, ''),
        ${p.since ?? null}::date,
        coalesce(${p.showMilestones ?? null}::boolean, true)
      )
      on conflict (id) do update set
        name_a          = case when ${has('names')}::boolean then excluded.name_a else settings.name_a end,
        name_b          = case when ${has('names')}::boolean then excluded.name_b else settings.name_b end,
        since           = case when ${has('since')}::boolean then excluded.since else settings.since end,
        show_milestones = case when ${has('showMilestones')}::boolean then excluded.show_milestones else settings.show_milestones end
      returning name_a, name_b, to_char(since,'YYYY-MM-DD') as since, show_milestones
    `;
  }
  return shapeSettings(rows[0]);
}

/* ── 달력 사진 ───────────────────────────── */

/**
 * 올린 순서대로 id만. 사진 자체는 /api/photos/{id}로 따로 받아갑니다.
 * (2분마다 도는 /api/state에 사진을 실으면 너무 무겁습니다.)
 * 테이블이 아직 없으면 기본 6장만 쓰도록 빈 목록을 돌려줍니다.
 */
export async function listPhotoIds() {
  try {
    const rows = await sql`select id from photos order by created_at, id`;
    return rows.map((r) => r.id);
  } catch (e) {
    console.error('could not read photos (does the table exist?)', e.message);
    return [];
  }
}

export async function countPhotos() {
  const rows = await sql`select count(*)::int as n from photos`;
  return rows[0].n;
}

export async function findPhoto(id) {
  const rows = await sql`select mime, data from photos where id = ${id}`;
  return rows[0] || null;
}

export async function insertPhoto(mime, data) {
  const rows = await sql`
    insert into photos (mime, data) values (${mime}, ${data}) returning id
  `;
  return rows[0].id;
}

export async function removePhoto(id) {
  const rows = await sql`delete from photos where id = ${id} returning id`;
  return rows.length > 0;
}

/* ── 휴대폰 알림 ─────────────────────────── */

/**
 * 알림을 켜둔 기기들. 한 사람이 폰과 노트북을 켜두면 두 줄이 나옵니다.
 * 테이블이 아직 없으면 아무도 없는 걸로 둡니다 — 알림만 안 갈 뿐 달력은 굴러갑니다.
 */
export async function listPushSubs() {
  try {
    return await sql`
      select owner, endpoint, p256dh, auth
      from push_subs
      order by created_at
    `;
  } catch (e) {
    console.error('could not read push_subs (does the table exist?)', e.message);
    return [];
  }
}

/** endpoint가 그 기기의 주소라, 같은 기기가 다시 켜면 덮어씁니다. */
export async function savePushSub(owner, s) {
  await sql`
    insert into push_subs (owner, endpoint, p256dh, auth)
    values (${owner}, ${s.endpoint}, ${s.p256dh}, ${s.auth})
    on conflict (endpoint) do update set
      owner  = excluded.owner,
      p256dh = excluded.p256dh,
      auth   = excluded.auth
  `;
}

export async function removePushSub(endpoint) {
  const rows = await sql`delete from push_subs where endpoint = ${endpoint} returning endpoint`;
  return rows.length > 0;
}

/* ── 오늘 일정 알림 ──────────────────────── */

/**
 * 그날 시작하는 일정. 반복(매달/매년)은 여기서 펼칩니다 — 달력은 public/app.js의
 * expand()가 펼치지만, 서버는 하루치만 있으면 되니 SQL로 끝냅니다.
 *
 * 여러 날에 걸친 일정은 시작하는 날에만 나옵니다 (중간 날마다 알리지 않아요).
 * 매달 31일 같은 건 그 달에 31일이 없으면 저절로 빠집니다 — 달력과 같은 규칙입니다.
 */
export async function listEventsOn(date) {
  return sql`
    select id, title, at_time as time, memo
    from events
    where start_date = ${date}::date
       or (repeat_rule = 'yearly' and start_date <= ${date}::date
           and to_char(start_date, 'MM-DD') = to_char(${date}::date, 'MM-DD'))
       or (repeat_rule = 'monthly' and start_date <= ${date}::date
           and extract(day from start_date) = extract(day from ${date}::date))
    order by at_time nulls first, title
  `;
}

/**
 * 이 알림을 보낼 자리를 잡습니다. 처음이면 true, 이미 보냈으면 false.
 *
 * 바깥 시계가 5분마다 두드리니 같은 알림이 여러 번 걸립니다. 보내기 **전에**
 * 자리를 잡아서, 겹쳐 들어와도 한 번만 나가게 합니다.
 */
export async function claimReminder(key) {
  const rows = await sql`
    insert into reminders_sent (key) values (${key})
    on conflict (key) do nothing
    returning key
  `;
  return rows.length > 0;
}

/** 지난 기록은 치웁니다. 하루 지나면 key가 달라져서 다시는 쓰이지 않아요. */
export async function purgeReminders() {
  await sql`delete from reminders_sent where sent_at < now() - interval '7 days'`;
}
