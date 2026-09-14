/**
 * 오늘 일정 알림의 규칙. 언제 무엇을 보낼지만 정하고, 보내지는 않습니다.
 *
 *   8시 전에 시작하는 일정 → 시작 30분 전에 하나씩 "곧 시작"
 *   그 밖의 일정(8시 이후 / 종일) → 아침 8시에 묶어서 "오늘 일정"
 *
 * 바깥 시계가 새벽 4시부터 5분마다 두드려 줍니다. 하루 종일 두드리면 DB가
 * 잠들 틈이 없어 Neon 무료 한도를 넘기기 때문에, 알림이 필요한 구간에만
 * 깨웁니다. 그래서 4시 이전에 시작하는 일정은 4시로 당겨 보냅니다.
 *
 * "오늘"과 "아침 8시"가 어디 기준인지는 설정의 시간대를 따릅니다. 서버는
 * UTC로 돌기 때문에, 여기서 옮기지 않으면 자정 근처에서 날짜가 밀립니다.
 *
 * 시각 계산이 전부 순수 함수라, 테스트에서 아무 시각이나 넣어볼 수 있습니다.
 */

export const OPEN = 4 * 60;    // 바깥 시계가 도는 첫 시각 (04:00)
export const DIGEST = 8 * 60;  // 오늘 일정을 묶어 보내는 시각 (08:00)
const LEAD = 30;               // 시작 몇 분 전에 알릴지
const GRACE = 15;              // 두드림이 늦어도 이만큼 안이면 보냅니다. 더 지났으면 조용히

/** 'HH:MM' -> 자정부터 흐른 분. */
const toMinutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** 아는 시간대면 그대로, 모르면 UTC. 낯선 값에 알림이 통째로 죽지 않게요. */
export function resolveZone(zone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone || 'UTC' });
    return zone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 그 시간대에서 지금 — 날짜와 자정부터 흐른 분. */
export function localNow(zone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveZone(zone),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', // hour12:false는 런타임에 따라 자정을 24시로 줍니다
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** 알림이 나갈 수 있는 시간대인지. 그 밖이면 DB를 깨우지도 않습니다. */
export const awake = (minutes) => minutes >= OPEN && minutes < DIGEST + GRACE;

/**
 * 지금 보낼 알림들. 보낼 게 없으면 빈 배열입니다.
 *
 * events는 그날 시작하는 일정들(반복은 이미 펼쳐진 상태). 여러 날짜에 걸친
 * 일정은 시작하는 날에만 들어옵니다.
 */
export function plan(events, minutes) {
  const early = events.filter((e) => e.time && toMinutes(e.time) < DIGEST);
  const rest = events.filter((e) => !early.includes(e));
  const due = (target) => minutes >= target && minutes < target + GRACE;

  const out = early
    // 4시 이전 일정은 30분 전이 아직 시계가 안 도는 때라 4시로 당깁니다
    .filter((e) => due(Math.max(toMinutes(e.time) - LEAD, OPEN)))
    .map((event) => ({ kind: 'soon', event }));

  if (rest.length && due(DIGEST)) out.push({ kind: 'today', events: rest });
  return out;
}
