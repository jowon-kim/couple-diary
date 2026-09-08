import { requireAuth, body, guard, methodNotAllowed, normalizeEvent } from '../../lib/http.js';
import { findEvent, updateEvent, removeEvent } from '../../lib/store.js';
import { notify } from '../../lib/push.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default guard(async (req, res) => {
  if (!['PATCH', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['PATCH', 'DELETE']);
  if (!requireAuth(req, res)) return;

  const { id } = req.query;
  if (!UUID.test(String(id || ''))) return res.status(404).json({ error: '없는 일정이에요' });

  if (req.method === 'DELETE') {
    const gone = await removeEvent(id);
    if (!gone) return res.status(404).json({ error: '없는 일정이에요' });
    await notify('일정 지움', gone, req.query.actor);
    return res.status(204).end();
  }

  const existing = await findEvent(id);
  if (!existing) return res.status(404).json({ error: '없는 일정이에요' });

  const input = body(req);
  const updated = await updateEvent(id, normalizeEvent(input, existing));
  await notify('일정 고침', updated, input.actor);
  res.status(200).json(updated);
});
