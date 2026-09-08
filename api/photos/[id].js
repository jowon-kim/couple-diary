import { requireAuth, guard, methodNotAllowed } from '../../lib/http.js';
import { findPhoto, removePhoto } from '../../lib/store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default guard(async (req, res) => {
  if (!['GET', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['GET', 'DELETE']);

  const { id } = req.query;
  if (!UUID.test(String(id || ''))) return res.status(404).json({ error: '없는 사진이에요' });

  if (req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    const gone = await removePhoto(id);
    if (!gone) return res.status(404).json({ error: '없는 사진이에요' });
    return res.status(204).end();
  }

  /* <img src="...">로 불러가는 자리라 인증 헤더를 실을 수 없습니다.
     주소를 아는 사람만 볼 수 있게 두되, id가 uuid라 찍어서 맞힐 수 없습니다.
     주소가 새면 누구나 볼 수 있으니, 남에게 서비스로 내줄 거면 여기를 손봐야 합니다. */
  const photo = await findPhoto(id);
  if (!photo) return res.status(404).json({ error: '없는 사진이에요' });

  // 사진은 절대 안 바뀌고 지우면 주소째 사라지니 오래 캐시해도 됩니다
  res.setHeader('Content-Type', photo.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.status(200).end(Buffer.from(photo.data, 'base64'));
});
