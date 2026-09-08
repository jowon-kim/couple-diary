import crypto from 'node:crypto';

/* ── 인증 ────────────────────────────────── */

export function tokenFor() {
  const password = process.env.DIARY_PASSWORD;
  const secret = process.env.DIARY_SECRET || 'couple-diary';
  if (!password) throw new Error('DIARY_PASSWORD 환경변수가 없습니다');
  return crypto.createHash('sha256').update(password + '|' + secret).digest('hex');
}

/** 통과하면 true, 아니면 401을 직접 내려보내고 false. */
export function requireAuth(req, res) {
  let expected;
  try {
    expected = tokenFor();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return false;
  }
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const ok =
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) {
    res.status(401).json({ error: '다시 로그인해 주세요' });
    return false;
  }
  return true;
}

/* ── 요청 다루기 ─────────────────────────── */

export function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new Error('JSON 형식이 아닙니다'); }
  }
  return req.body;
}

export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  res.status(405).json({ error: '지원하지 않는 요청이에요' });
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
        error: known ? e.message : '요청을 처리하지 못했어요',
      });
    }
  };
}

/* ── 검증 ────────────────────────────────── */

export class ValidationError extends Error {}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

/**
 * 입력을 DB에 넣을 수 있는 모양으로 다듬습니다.
 * base를 주면 수정, 안 주면 새로 만들기.
 */
export function normalizeEvent(input, base = null) {
  const pick = (key, fallback) => (input[key] !== undefined ? input[key] : fallback);

  const date = isDate(input.date) ? input.date : base?.date;
  if (!date) throw new ValidationError('날짜를 골라주세요');

  const title = clip(pick('title', base?.title), 80).trim();
  if (!title) throw new ValidationError('일정 이름을 적어주세요');

  // 조용히 버리지 않고 왜 안 되는지 알려줍니다
  const endDate = isDate(input.endDate) ? input.endDate : null;
  if (endDate && endDate < date) throw new ValidationError('끝나는 날이 시작하는 날보다 앞이에요');

  const rawOwner = pick('owner', base?.owner);
  const rawRepeat = pick('repeat', base?.repeat);

  const time = isTime(input.time) ? input.time : null;
  const endTime = time && isTime(input.endTime) ? input.endTime : null;
  if (endTime && endTime <= time) throw new ValidationError('끝나는 시간이 시작 시간보다 늦어야 해요');

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
  if ('title' in input) patch.title = clip(input.title, 12).trim() || '우리어리';
  if ('subtitle' in input) patch.subtitle = clip(input.subtitle, 20).trim() || '우리 오늘 뭐하지';
  if ('theme' in input) patch.theme = clip(input.theme, 8).trim() || '복숭아';
  if (input.names) {
    patch.names = {
      a: clip(input.names.a, 12).trim() || '나',
      b: clip(input.names.b, 12).trim() || '너',
    };
  }
  if ('since' in input) patch.since = isDate(input.since) ? input.since : null;
  if ('showMilestones' in input) patch.showMilestones = !!input.showMilestones;
  return patch;
}
