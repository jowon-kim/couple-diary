import { tokenFor, body, guard, methodNotAllowed } from '../lib/http.js';

export default guard(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const given = String(body(req).password || '');
  const password = process.env.DIARY_PASSWORD;
  if (!password) return res.status(500).json({ error: '서버에 비밀번호가 설정되지 않았어요' });

  if (given === password) return res.status(200).json({ token: tokenFor() });

  await new Promise((r) => setTimeout(r, 400)); // 무차별 대입 완화
  return res.status(401).json({ error: '비밀번호가 맞지 않아요' });
});
