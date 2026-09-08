import { requireAuth, guard, methodNotAllowed } from '../lib/http.js';
import { listEvents, getSettings, listPhotoIds } from '../lib/store.js';

export default guard(async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!requireAuth(req, res)) return;

  // photos: 설정에서 올린 달력 사진 id (사진 자체는 /api/photos/{id})
  const [events, settings, photos] = await Promise.all([
    listEvents(), getSettings(), listPhotoIds(),
  ]);
  res.status(200).json({ events, settings, photos });
});
