import { requireAuth, body, guard, methodNotAllowed, ValidationError } from '../../lib/http.js';
import { savePushSub, removePushSub } from '../../lib/store.js';
import { publicKey } from '../../lib/push.js';

const ENDPOINT_LIMIT = 500; // 실제로는 300자 안팎입니다 — 터무니없는 건 받지 않습니다

/**
 * GET    이 앱의 공개키 — 브라우저가 구독을 만들 때 필요합니다
 * POST   이 기기로 알림 받기 (같은 기기가 다시 켜면 덮어씁니다)
 * DELETE 이 기기만 끄기 — 같은 사람의 다른 기기는 그대로 둡니다
 */
export default guard(async (req, res) => {
  const allowed = ['GET', 'POST', 'DELETE'];
  if (!allowed.includes(req.method)) return methodNotAllowed(res, allowed);
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') return res.status(200).json({ publicKey: await publicKey() });

  if (req.method === 'DELETE') {
    const endpoint = String(req.query.endpoint || '');
    if (!endpoint) throw new ValidationError('error.noDevice');
    await removePushSub(endpoint);
    return res.status(204).end();
  }

  const { owner, subscription } = body(req);
  if (!['a', 'b'].includes(owner)) throw new ValidationError('error.pickWhoFirst');

  const endpoint = subscription?.endpoint;
  const { p256dh, auth } = subscription?.keys || {};
  const ok =
    typeof endpoint === 'string' &&
    endpoint.startsWith('https://') &&
    endpoint.length <= ENDPOINT_LIMIT &&
    typeof p256dh === 'string' && p256dh &&
    typeof auth === 'string' && auth;
  if (!ok) throw new ValidationError('error.pushFailed');

  await savePushSub(owner, { endpoint, p256dh, auth });
  res.status(201).json({ ok: true });
});
