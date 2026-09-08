import { requireAuth, body, guard, methodNotAllowed, ValidationError } from '../../lib/http.js';
import { insertPhoto, countPhotos } from '../../lib/store.js';

const ALLOWED = ['image/webp', 'image/jpeg', 'image/png'];
const MAX_BYTES = 300 * 1024; // 브라우저에서 줄여 보내니 넉넉합니다
const MAX_PHOTOS = 30;        // 무료 한도를 갉아먹지 않게 (public/app.js에도 같은 값)

export default guard(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!requireAuth(req, res)) return;

  const { mime, data } = body(req);
  if (!ALLOWED.includes(mime)) throw new ValidationError('사진 파일만 넣을 수 있어요');
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new ValidationError('사진을 읽지 못했어요');
  }
  if (Buffer.byteLength(data, 'base64') > MAX_BYTES) throw new ValidationError('사진이 너무 커요');
  if (await countPhotos() >= MAX_PHOTOS) {
    throw new ValidationError(`사진은 ${MAX_PHOTOS}장까지만 넣을 수 있어요`);
  }

  res.status(201).json({ id: await insertPhoto(mime, data) });
});
