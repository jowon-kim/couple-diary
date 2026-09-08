import { requireAuth, body, guard, methodNotAllowed, normalizeSettings } from '../lib/http.js';
import { patchSettings } from '../lib/store.js';

export default guard(async (req, res) => {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);
  if (!requireAuth(req, res)) return;

  res.status(200).json(await patchSettings(normalizeSettings(body(req))));
});
