/**
 * 오늘 일정 알림. 바깥 시계가 새벽 4시부터 5분마다 두드립니다.
 *
 *   GET /api/cron?key=<열쇠>     열쇠는 로그인한 뒤 설정 화면에 주소째로 나옵니다
 *
 * 무엇을 언제 보낼지는 lib/remind.js가 정합니다. 여기서는 두드린 시각을 보고
 * 그 규칙을 돌린 뒤, 이미 보낸 건 건너뛰고 남은 것만 보냅니다.
 *
 * Vercel의 cron은 안 씁니다 — 무료 구간에서는 하루 한 번, 그것도 ±59분이라
 * "30분 전"이 안 됩니다. 이 주소만 있으면 두드리는 쪽은 아무나 돼요.
 *
 * 답에 담기는 문구는 문구 키가 아니라 영어 그대로입니다. 이 답을 읽는 건 앱이
 * 아니라 시계 서비스의 실행 기록이라서요.
 */
import { guard, methodNotAllowed, requireCron } from '../lib/http.js';
import { getSettings, listEventsOn, claimReminder, purgeReminders } from '../lib/store.js';
import { notifyAll } from '../lib/push.js';
import { describeSoon, describeToday } from '../lib/message.js';
import { localNow, plan, awake } from '../lib/remind.js';

/** 손으로 확인할 때 쓰는 창구 — ?at=2026-10-05T06:30 이면 그 시각인 척합니다. */
function pretend(at) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(at || ''));
  return m ? { date: m[1], minutes: Number(m[2]) * 60 + Number(m[3]) } : null;
}

export default guard(async (req, res) => {
  const allowed = ['GET', 'POST'];
  if (!allowed.includes(req.method)) return methodNotAllowed(res, allowed);
  if (!(await requireCron(req, res))) return;

  /* 시간대가 설정에 있어서, 지금이 몇 시인지 알려면 DB를 한 번 읽어야 합니다.
     앵두어리처럼 시간대를 코드에 박아뒀다면 이 왕복이 없었을 텐데, 쓰는 사람이
     어디 사는지 모르니 어쩔 수 없습니다. 그래서 **시계를 4~8시에만 돌리는 게
     더 중요합니다** — 두드림 한 번이 곧 DB를 깨우는 것이라서요. */
  const settings = await getSettings();
  const now = pretend(req.query?.at) || localNow(settings.timezone);
  const answer = (sent) => res.status(200).json({ at: now, zone: settings.timezone, sent });

  if (!awake(now.minutes)) return answer([]);

  const sent = [];
  for (const job of plan(await listEventsOn(now.date), now.minutes)) {
    // 5분마다 두드리니 같은 알림이 여러 번 걸립니다. 보내기 전에 자리를 잡아요.
    if (job.kind === 'soon') {
      if (!(await claimReminder(`${now.date}:${job.event.id}:soon`))) continue;
      await notifyAll(describeSoon(job.event, settings.locale), `soon:${job.event.id}`);
      sent.push(`soon: ${job.event.title}`);
    } else {
      if (!(await claimReminder(`${now.date}:today`))) continue;
      await notifyAll(describeToday(job.events, settings.locale), `today:${now.date}`);
      sent.push(`today: ${job.events.length} event(s)`);
    }
  }

  if (sent.length) await purgeReminders().catch(() => {});
  answer(sent);
});
