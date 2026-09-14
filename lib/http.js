import crypto from 'node:crypto';
import { keys } from './setup.js';
import { hasDatabase } from './db.js';

/* ── 인증 ────────────────────────────────── */

/** 설치가 덜 끝났으면 무엇이 빠졌는지 문구 키로. 다 됐으면 null. */
export function missingSetup() {
  if (!process.env.DIARY_PASSWORD) return 'error.noPassword';
  if (!hasDatabase()) return 'error.noDatabase';
  return null;
}

export async function tokenFor() {
  const password = process.env.DIARY_PASSWORD;
  if (!password) throw new Error('DIARY_PASSWORD is not set');
  const { diarySecret } = await keys();
  return crypto.createHash('sha256').update(password + '|' + diarySecret).digest('hex');
}

/* 길이가 다르면 timingSafeEqual이 예외를 던져서, 먼저 길이를 봅니다. */
const same = (given, expected) =>
  given.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));

const bearer = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
};

/** 통과하면 true, 아니면 401을 직접 내려보내고 false. */
export async function requireAuth(req, res) {
  const missing = missingSetup();
  if (missing) {
    res.status(500).json({ error: missing });
    return false;
  }
  if (!same(bearer(req), await tokenFor())) {
    res.status(401).json({ error: 'error.relogin' });
    return false;
  }
  return true;
}

/**
 * 오늘 일정 알림을 깨우는 바깥 시계의 열쇠. 로그인 토큰과 따로 둡니다 —
 * 이건 사람이 아니라 기계가 들고 있고, 비밀번호를 바꿔도 시계는 그대로여야 해서요.
 * 헤더로도 받고, 주소 뒤 ?key= 로도 받습니다 (시계 서비스마다 되는 게 달라서).
 *
 * 여기 오류 문구만 문구 키가 아니라 영어 그대로입니다. 이 답을 읽는 건 앱이
 * 아니라 시계 서비스의 실행 기록이라, 'error.badKey'가 찍히면 아무 도움이 안 됩니다.
 */
export async function requireCron(req, res) {
  const expected = (await keys()).cronSecret;
  if (!same(bearer(req) || String(req.query?.key || ''), expected)) {
    res.status(401).json({ error: 'wrong key' });
    return false;
  }
  return true;
}

/* ── 요청 다루기 ─────────────────────────── */

export function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new Error('error.badJson'); }
  }
  return req.body;
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  res.status(405).json({ error: 'error.methodNotAllowed' });
}

/** 핸들러를 감싸서 예외를 400/500으로 바꿔줍니다. */
export function guard(handler) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await handler(req, res);
    } catch (e) {
      const known = e instanceof ValidationError;
      if (!known) console.error(e);
      res.status(known ? 400 : 500).json({
        error: known ? e.message : 'error.requestFailed',
      });
    }
  };
}

/* ── 검증 ────────────────────────────────── */

export class ValidationError extends Error {}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 아는 시간대면 그대로, 아니면 UTC. 아는지는 Intl에게 물어봅니다. */
const knownZone = (v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return v;
  } catch {
    return 'UTC';
  }
};
const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

/**
 * 입력을 DB에 넣을 수 있는 모양으로 다듬습니다.
 * base를 주면 수정, 안 주면 새로 만들기.
 */
export function normalizeEvent(input, base = null) {
  const pick = (key, fallback) => (input[key] !== undefined ? input[key] : fallback);

  const date = isDate(input.date) ? input.date : base?.date;
  if (!date) throw new ValidationError('error.needDate');

  const title = clip(pick('title', base?.title), 80).trim();
  if (!title) throw new ValidationError('error.needTitle');

  // 조용히 버리지 않고 왜 안 되는지 알려줍니다
  const endDate = isDate(input.endDate) ? input.endDate : null;
  if (endDate && endDate < date) throw new ValidationError('error.endBeforeStart');

  const rawOwner = pick('owner', base?.owner);
  const rawRepeat = pick('repeat', base?.repeat);

  const time = isTime(input.time) ? input.time : null;
  const endTime = time && isTime(input.endTime) ? input.endTime : null;
  if (endTime && endTime <= time) throw new ValidationError('error.endTimeBeforeStart');

  return {
    title,
    date,
    endDate,
    time,
    endTime,
    memo: clip(pick('memo', base?.memo), 1000),
    owner: ['a', 'b', 'both'].includes(rawOwner) ? rawOwner : 'both',
    repeat: ['none', 'monthly', 'yearly'].includes(rawRepeat) ? rawRepeat : 'none',
  };
}

/**
 * 보내온 칸만 골라 담습니다. 안 보낸 칸은 아예 넣지 않아요 — 예전엔 현재
 * 설정을 통째로 받아 그 위에 덮었는데, 색 고르기와 저장이 겹치면 나중에
 * 읽은 쪽이 먼저 쓴 쪽을 통째로 지웠습니다.
 */
export function normalizeSettings(input) {
  const patch = {};
  // 비우면 기본값으로 되돌립니다 — 이름 없는 달력이 되면 상단이 휑해서요
  /* 비우면 비운 채로 둡니다 — 화면이 그 언어의 기본 이름을 씁니다.
     여기서 채워 넣으면 처음 쓴 언어의 이름이 굳어버립니다. */
  if ('title' in input) patch.title = clip(input.title, 12).trim();
  if ('subtitle' in input) patch.subtitle = clip(input.subtitle, 20).trim();
  if ('theme' in input) patch.theme = clip(input.theme, 12).trim() || 'peach';
  if ('locale' in input) patch.locale = clip(input.locale, 12).trim() || 'en';
  if ('region' in input) patch.region = clip(input.region, 12).trim() || 'none';
  // 낯선 시간대를 담으면 알림이 통째로 엉뚱한 시각에 갑니다 — 여기서 걸러둡니다
  if ('timezone' in input) patch.timezone = knownZone(clip(input.timezone, 64).trim());
  if (input.names) {
    patch.names = {
      a: clip(input.names.a, 12).trim(),
      b: clip(input.names.b, 12).trim(),
    };
  }
  if ('since' in input) patch.since = isDate(input.since) ? input.since : null;
  if ('showMilestones' in input) patch.showMilestones = !!input.showMilestones;
  return patch;
}
