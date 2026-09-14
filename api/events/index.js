import { requireAuth, body, guard, methodNotAllowed, normalizeEvent } from '../../lib/http.js';
import { insertEvent } from '../../lib/store.js';
import { notify } from '../../lib/push.js';

export default guard(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!(await requireAuth(req, res))) return;

  const input = body(req);
  const event = await insertEvent(normalizeEvent(input));
  // 응답을 보낸 뒤에 보내면 함수가 먼저 죽어서 요청이 잘립니다 — 여기서 기다립니다
  await notify('push.newEvent', event, input.actor);
  res.status(201).json(event);
});
