import { tokenFor, missingSetup, body, guard, methodNotAllowed } from '../lib/http.js';

export default guard(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const given = String(body(req).password || '');
  const missing = missingSetup();
  if (missing) return res.status(500).json({ error: missing });

  if (given === process.env.DIARY_PASSWORD) return res.status(200).json({ token: await tokenFor() });

  await new Promise((r) => setTimeout(r, 400)); // 무차별 대입 완화
  return res.status(401).json({ error: 'error.wrongPassword' });
});
