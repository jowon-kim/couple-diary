/**
 * 서버 쪽 문구. 알림에 쓰입니다.
 *
 * 화면과 똑같은 언어팩(public/i18n/*.js)을 그대로 씁니다 — 표를 두 벌로 두면
 * 반드시 한쪽만 고쳐지는 날이 옵니다. 언어팩은 전역에 자기를 등록하는 스크립트라
 * 불러오기만 하면 됩니다. 여기서 static import로 적어두어야 배포할 때
 * 번들에 같이 실립니다.
 *
 * 새 언어를 넣었다면 이 파일에도 import 한 줄을 더해주세요.
 */
import '../public/i18n/en.js';
import '../public/i18n/ko.js';

const FALLBACK = 'en';

const packs = () => globalThis.I18N || {};

/** 아는 언어면 그대로, 모르면 영어. */
export function resolveLocale(tag) {
  if (!tag) return FALLBACK;
  const have = Object.keys(packs());
  const want = String(tag).toLowerCase();
  return have.find((n) => n.toLowerCase() === want)
    || have.find((n) => want.split('-')[0] === n.split('-')[0])
    || FALLBACK;
}

/**
 * 문구 하나. 없는 키는 영어로, 영어에도 없으면 키를 그대로 돌려줍니다 —
 * 반쯤 번역된 언어팩이 알림을 빈칸으로 만들지 않게요.
 */
export function t(locale, key, vars) {
  const all = packs();
  const mine = all[resolveLocale(locale)] || {};
  const en = all[FALLBACK] || {};
  const value = mine[key] != null ? mine[key] : (en[key] != null ? en[key] : key);
  if (!vars) return value;
  return String(value).replace(/\{(\w+)\}/g, (whole, name) => (
    vars[name] != null ? vars[name] : whole
  ));
}
