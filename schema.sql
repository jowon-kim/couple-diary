-- 달력 스키마. 앱이 처음 켜질 때 스스로 돌립니다 (lib/setup.js). Neon SQL Editor에 붙여넣어 돌려도 됩니다.

create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  start_date  date not null,
  end_date    date,
  at_time     text,
  end_time    text,
  memo        text not null default '',
  owner       text not null default 'both' check (owner in ('a', 'b', 'both')),
  repeat_rule text not null default 'none' check (repeat_rule in ('none', 'monthly', 'yearly')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 이미 만들어진 테이블에도 안전하게 반영됩니다 (기존 DB에는 이 줄만 다시 실행하면 됩니다).
alter table events add column if not exists end_time text;

create index if not exists events_start_date_idx on events (start_date);

-- 이름과 인사말이 비어 있으면 화면이 그 언어의 기본값을 씁니다 (public/i18n/).
-- 여기에 값을 박아두면 처음 쓴 언어의 이름이 굳어버립니다.
create table if not exists settings (
  id              smallint primary key default 1 check (id = 1),
  title           text not null default '',
  subtitle        text not null default '',
  theme           text not null default 'peach',
  locale          text not null default 'en',
  timezone        text not null default 'UTC',
  region          text not null default 'none',
  name_a          text not null default '',
  name_b          text not null default '',
  since           date,
  show_milestones boolean not null default true
);

-- 이미 만들어진 표에도 안전하게 반영됩니다.
alter table settings add column if not exists title text not null default '';
alter table settings add column if not exists subtitle text not null default '';
alter table settings add column if not exists theme text not null default 'peach';

-- 언어와 공휴일 묶음. 둘 다 두 사람이 같은 것을 봅니다.
alter table settings add column if not exists locale text not null default 'en';
alter table settings add column if not exists region text not null default 'none';

-- 오늘 일정 알림이 쓰는 시간대. "오늘"과 "아침 8시"가 어디 기준인지 정합니다.
alter table settings add column if not exists timezone text not null default 'UTC';

-- 예전 판은 테마를 한국어 이름으로 담았습니다. 쓰던 색을 잃지 않게 id로 옮깁니다.
update settings set theme = case theme
  when '복숭아' then 'peach'
  when '바다'   then 'ocean'
  when '숲'     then 'forest'
  when '살구'   then 'apricot'
  when '밤'     then 'night'
  else theme
end;

insert into settings (id) values (1) on conflict (id) do nothing;

-- 설정에서 올린 달력 사진. 일정 옆과 빈 날에 골고루 나옵니다.
-- 브라우저에서 256px 정사각으로 줄여 올리므로 한 장에 10KB 안팎입니다.
create table if not exists photos (
  id         uuid primary key default gen_random_uuid(),
  mime       text not null,
  data       text not null,
  created_at timestamptz not null default now()
);

-- 휴대폰 알림(웹푸시). 기기마다 한 줄씩 생깁니다 — 폰과 노트북을 둘 다 켜두면 두 줄.
-- endpoint가 곧 그 기기의 주소라서, 같은 기기가 다시 켜면 덮어씁니다.
create table if not exists push_subs (
  owner      text not null check (owner in ('a', 'b')),
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subs_owner_idx on push_subs (owner);

-- 오늘 일정 알림을 이미 보냈는지 적어두는 자리.
-- 바깥 시계가 5분마다 두드리기 때문에, 이 표가 없으면 같은 알림이 세 번 갑니다.
-- key는 '날짜:종류' 또는 '날짜:일정id:종류' — 하루가 지나면 새 key라 다시 옵니다.
create table if not exists reminders_sent (
  key     text primary key,
  sent_at timestamptz not null default now()
);

-- 앱이 처음 켜질 때 스스로 만드는 열쇠들과, 표를 마지막으로 맞춘 schema.sql의 지문.
-- 설치하는 사람이 키를 만들어 붙여넣지 않아도 되게 여기 둡니다 (lib/setup.js).
-- **줄을 지우지 마세요.** vapid_*가 바뀌면 켜둔 알림이 전부 죽고,
-- diary_secret이 바뀌면 둘 다 로그아웃됩니다.
create table if not exists app_meta (
  name  text primary key,
  value text not null
);
