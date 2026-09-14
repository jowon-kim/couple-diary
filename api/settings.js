import { requireAuth, body, guard, methodNotAllowed, normalizeSettings } from '../lib/http.js';
import { patchSettings } from '../lib/store.js';
import { keys } from '../lib/setup.js';

/**
 * GET   바깥 시계에 넣을 열쇠 — 앱이 만들어 DB에 둔 것이라 설정 화면이 보여줍니다
 * PATCH 보낸 칸만 바꾸기
 *
 * 설정 값 자체는 /api/state가 달력과 같이 내려줍니다.
 */
export default guard(async (req, res) => {
  const allowed = ['GET', 'PATCH'];
  if (!allowed.includes(req.method)) return methodNotAllowed(res, allowed);
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') return res.status(200).json({ cronKey: (await keys()).cronSecret });

  res.status(200).json(await patchSettings(normalizeSettings(body(req))));
});
