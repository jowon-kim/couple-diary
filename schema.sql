-- 달력 스키마. Neon SQL Editor에 그대로 붙여넣고 실행하세요.

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

create table if not exists settings (
  id              smallint primary key default 1 check (id = 1),
  title           text not null default '우리어리',
  subtitle        text not null default '우리 오늘 뭐하지',
  theme           text not null default '복숭아',
  name_a          text not null default '나',
  name_b          text not null default '너',
  since           date,
  show_milestones boolean not null default true
);

-- 달력 이름과 인사말. 이미 만들어진 테이블에도 안전하게 반영됩니다.
alter table settings add column if not exists title text not null default '우리어리';
alter table settings add column if not exists subtitle text not null default '우리 오늘 뭐하지';
alter table settings add column if not exists theme text not null default '복숭아';

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
