import { requireAuth, body, guard, methodNotAllowed, ValidationError } from '../../lib/http.js';
import { insertPhoto, countPhotos } from '../../lib/store.js';

const ALLOWED = ['image/webp', 'image/jpeg', 'image/png'];
const MAX_BYTES = 300 * 1024; // 브라우저에서 줄여 보내니 넉넉합니다
const MAX_PHOTOS = 30;        // 무료 한도를 갉아먹지 않게 (public/app.js에도 같은 값)

export default guard(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!(await requireAuth(req, res))) return;

  const { mime, data } = body(req);
  if (!ALLOWED.includes(mime)) throw new ValidationError('error.imageOnly');
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new ValidationError('error.photoRead');
  }
  if (Buffer.byteLength(data, 'base64') > MAX_BYTES) throw new ValidationError('error.photoTooBig');
  if (await countPhotos() >= MAX_PHOTOS) {
    throw new ValidationError('error.photoLimit');
  }

  res.status(201).json({ id: await insertPhoto(mime, data) });
});
