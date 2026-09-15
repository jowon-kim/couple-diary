/**
 * Tests for the screen itself (public/app.js).
 *
 *   npm test
 *
 * The handler tests never load app.js, so a typo in it once shipped with every
 * test green: the + button threw before the editor could open, and nobody
 * could add an event. This loads the real scripts in the order index.html does
 * and presses the things people press first.
 *
 * Like i18n-test.mjs it stubs the browser rather than pulling in a headless
 * one. Elements are made on demand by id, so the stub only has to be as smart
 * as the code paths below need. It cannot tell whether things look right —
 * that still needs a real browser.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/* ── 아주 작은 가짜 DOM ── */
class Text {
  constructor(data) { this.textContent = String(data); }
}

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = { setProperty(k, v) { this[k] = String(v); } };
    this.attrs = {};
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.innerHTML = '';
    this.parentElement = null;
    this.offsetTop = this.offsetHeight = this.offsetWidth = this.clientHeight = this.scrollTop = 0;
    this.own = '';
    const names = new Set();
    Object.defineProperty(this, 'className', {
      get: () => [...names].join(' '),
      set: (v) => { names.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => names.add(x)); },
    });
    this.classList = {
      add: (...c) => c.forEach((x) => names.add(x)),
      remove: (...c) => c.forEach((x) => names.delete(x)),
      toggle: (c, on = !names.has(c)) => { on ? names.add(c) : names.delete(c); return on; },
      contains: (c) => names.has(c),
    };
  }

  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this.own; }
  set textContent(v) { this.children = []; this.own = String(v); }

  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === 'string' ? new Text(n) : n;
      if (node.fragment) { node.children.forEach((c) => this.append(c)); node.children = []; continue; }
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) { this.children = []; this.own = ''; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(event) {
    event.target ??= this;
    event.preventDefault ??= () => {};
    event.stopPropagation ??= () => {};
    (this.listeners[event.type] || []).forEach((fn) => fn(event));
    this['on' + event.type]?.(event);
    return true;
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close' }); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
  cloneNode() { return new El(this.tagName); }
  getBoundingClientRect() { return { width: 400, height: 0, top: 0, left: 0 }; }
  focus() {}
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  setPointerCapture() {}
}

const byId = new Map();
const bySelector = new Map();
const document = new El('html');
Object.assign(document, {
  documentElement: new El('html'),
  hidden: false,
  title: '',
  getElementById: (id) => {
    if (!byId.has(id)) { const el = new El(); el.id = id; byId.set(id, el); }
    return byId.get(id);
  },
  querySelector: (selector) => {
    if (!bySelector.has(selector)) bySelector.set(selector, new El());
    return bySelector.get(selector);
  },
  createElement: (tag) => new El(tag),
  createTextNode: (data) => new Text(data),
  createDocumentFragment: () => Object.assign(new El(), { fragment: true }),
});

const store = new Map();
const fetches = [];

Object.assign(globalThis, {
  window: globalThis,
  document,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {},
  location: { origin: 'https://diary.test' },
  matchMedia: () => ({ matches: false }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: () => 0,
  setInterval: () => 0,   // 2분마다 맞추는 타이머가 테스트를 붙잡지 않게
  fetch: async (url, init = {}) => {
    fetches.push({ url, method: init.method, body: init.body });
    const body = init.body ? JSON.parse(init.body) : {};
    return { ok: true, status: 200, json: async () => ({ cronKey: 'k', ...body }) };
  },
});
// Node 24 ships its own navigator, and it is read-only.
Object.defineProperty(globalThis, 'navigator', {
  value: { languages: ['ko-KR', 'ko'], language: 'ko-KR', userAgent: 'test' }, configurable: true,
});

/* index.html과 같은 순서로, 같은 전역에 싣습니다 */
for (const file of ['i18n/index.js', 'i18n/en.js', 'i18n/ko.js', 'holidays/none.js', 'holidays/kr.js', 'app.js']) {
  vm.runInThisContext(readFileSync(`public/${file}`, 'utf8'), { filename: file });
}
const run = (code) => vm.runInThisContext(code);
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failed = 0;
const ok = (what, cond, saw) => {
  if (cond) { passed++; console.log(`PASS  ${what}`); }
  else { failed++; console.log(`FAIL  ${what}  ${JSON.stringify(saw)}`); }
};
const attempt = (code) => {
  try { run(code); return null; } catch (e) { return e.message; }
};

const year = new Date().getFullYear();
ok('the screen starts in the browser language', run('i18n.getLocale()') === 'ko', run('i18n.getLocale()'));

/* 일정 쓰기 — + 버튼과 "이 날에 일정 추가"가 부르는 곳 */
let error = attempt(`openEditor(null, '${year}-09-20')`);
ok('the + button opens the editor', !error && $('editor').open, error);
ok('with the date written out', $('f-date-text').textContent.includes('9월 20일'), $('f-date-text').textContent);

/* 날짜 고르기 */
error = attempt(`datePicker.open('f-date')`);
ok('the date picker opens', !error && $('datepick').open, error);
ok('its title does not say the month twice', $('dp-title').textContent === `${year}년 9월`, $('dp-title').textContent);
error = attempt(`datePicker.pick('${year}-09-30')`);
ok('picking a day closes the picker', !error && !$('datepick').open, error);
ok('and puts the day in', $('f-date').value === `${year}-09-30` && $('f-date-text').textContent.includes('9월 30일'),
  [$('f-date').value, $('f-date-text').textContent]);
run(`$('editor').close()`);

/* 달력 머리 */
run(`state.cursor = new Date(${year}, 8, 1); render()`);
ok('the month label does not say the month twice', $('month-label').children[0]?.textContent === '9월',
  $('month-label').children[0]?.textContent);

/* 설정 — 처음 만난 날을 넣은 뒤에도 열려야 합니다 */
run(`state.settings.since = '2025-05-18'`);
error = attempt('openSettings()');
ok('settings open once the day you met is set', !error && $('settings').open, error);
ok('and show that day', $('s-since-text').textContent.includes('2025년 5월 18일'), $('s-since-text').textContent);
run(`$('settings').close()`);
await sleep(20);

/* 언어 — 아무도 안 고른 달력은 처음 연 기기의 언어로 채웁니다 */
fetches.length = 0;
run(`applyState({ events: [], photos: [], settings: { ...state.settings, locale: '' } })`);
await sleep(20);
const savedLocale = () => fetches.filter((f) => f.method === 'PATCH' && f.body && 'locale' in JSON.parse(f.body));
ok('an unpicked language stays the browser one', run('i18n.getLocale()') === 'ko', run('i18n.getLocale()'));
ok('and is saved so notifications speak it too',
  run('state.settings.locale') === 'ko' && savedLocale().length === 1 && JSON.parse(savedLocale()[0].body).locale === 'ko',
  fetches);

fetches.length = 0;
run(`applyState({ events: [], photos: [], settings: { ...state.settings, locale: 'en' } })`);
await sleep(20);
ok('a language someone picked wins over the browser', run('i18n.getLocale()') === 'en', run('i18n.getLocale()'));
ok('and is left alone', savedLocale().length === 0, fetches);

/* 여러 날 일정 — 열하루짜리 하나가 달력과 목록을 도배하지 않게 */
{
  const day = (n) => run(`ymd(addDays(parse(TODAY), ${n}))`);
  const kids = (el, cls) => el.children.filter((c) => c.classList?.contains(cls));
  const trip = { id: 'trip', title: '오점뭐', date: day(1), endDate: day(11), time: null, endTime: null, memo: '', owner: 'both', repeat: 'none' };
  const lunch = { id: 'lunch', title: '점심', date: day(3), endDate: null, time: '12:00', endTime: null, memo: '', owner: 'a', repeat: 'none' };
  globalThis.__events = [trip, lunch];
  run(`state.events = __events; state.settings.since = null; state.cursor = new Date(parse('${day(1)}').getFullYear(), parse('${day(1)}').getMonth(), 1); render()`);

  const rows = $('upcoming-list').children.map((li) => li.children[0].children[1]);
  const tripRows = rows.filter((body) => body.children[0].textContent === '오점뭐');
  ok('coming up lists a multi-day event once', tripRows.length === 1 && rows.length === 2, rows.map((b) => b.textContent));
  const dotted = (s) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`;
  const range = `${dotted(day(1))} ~ ${dotted(day(11))}`;
  ok('with the days it runs', tripRows[0]?.children[1].textContent.includes(range), tripRows[0]?.children[1].textContent);

  const cells = $('grid').children.filter((c) => c.dataset.date >= trip.date && c.dataset.date <= trip.endDate);
  const bars = cells.map((c) => kids(kids(c, 'spans')[0] || { children: [] }, 'bar')[0]);
  ok('every day it covers gets a piece of one band', cells.length > 0 && bars.every((b) => b && b.classList.contains('both')), cells.length);
  ok('and no dot of its own', cells.every((c) => kids(kids(c, 'branch')[0], 'cherry-dot').length === 0 || c.dataset.date === lunch.date));
  ok('the band has ends where it starts and stops',
    !!bars[0]?.classList.contains('from') && (cells.at(-1).dataset.date !== trip.endDate || !!bars.at(-1)?.classList.contains('to')));
  const labels = bars.filter((b) => kids(b, 'bar-label').length);
  const weeks = new Set(cells.map((c) => Math.floor($('grid').children.indexOf(c) / 7))).size;
  ok('its title shows once a week, not once a day', labels.length === weeks && labels[0].children[0].textContent === '오점뭐',
    [labels.length, weeks]);
  ok('the single-day event still gets its dot',
    kids(kids($('grid').children.find((c) => c.dataset.date === lunch.date), 'branch')[0], 'cherry-dot').length === 1);

  /* 겹치면 줄을 나누고, 다섯 줄까지 보여주고, 넘치면 +n으로 */
  const overlap = (id, owner) => ({ ...trip, id, owner, title: id });
  globalThis.__events = [trip, ...['2', '3', '4', '5', '6'].map((n, i) => overlap(n, ['a', 'b', 'both'][i % 3]))];
  run('state.events = __events; render()');
  const first = $('grid').children.find((c) => c.dataset.date === trip.date);
  const lanes = kids(kids(first, 'spans')[0], 'bar');
  ok('five overlapping bands all show', lanes.length === 5 && lanes.every((b) => !b.classList.contains('vacant')), lanes.map((b) => b.className));
  ok('drawn thinner so the week does not balloon', kids(first, 'spans')[0].classList.contains('dense'));
  ok('and the sixth is counted', kids(kids(first, 'branch')[0], 'more')[0]?.textContent === '+1');

  globalThis.__events = [trip, overlap('second', 'a')];
  run('state.events = __events; render()');
  ok('two bands keep the roomy size', !kids($('grid').children.find((c) => c.dataset.date === trip.date), 'spans')[0].classList.contains('dense'));
}

/* 줄은 주마다 새로 잡습니다 — 앞 주에 둘째 줄이던 띠도, 윗줄이 비면 다음 주엔 맨 위로 */
{
  const band = (id, date, endDate) => ({ id, title: id, date, endDate, time: null, endTime: null, memo: '', owner: 'both', repeat: 'none' });
  globalThis.__events = [band('short', '2026-09-06', '2026-09-08'), band('long', '2026-09-07', '2026-09-15')];
  run(`state.events = __events; state.cursor = new Date(2026, 8, 1); render()`);
  const cell = (date) => $('grid').children.find((c) => c.dataset.date === date);
  const bars = (date) => cell(date).children.find((c) => c.classList?.contains('spans'))?.children || [];
  ok('a band sits under the one that started first', bars('2026-09-07').length === 2 && bars('2026-09-07')[1].className.includes('both'),
    bars('2026-09-07').map((b) => b.className));
  ok('and moves up the next week instead of leaving a gap', bars('2026-09-13').length === 1 && !bars('2026-09-13')[0].classList.contains('vacant'),
    bars('2026-09-13').map((b) => b.className));
}

/* 반복 — 매달/매년 밑에 위에서 고른 날짜를 풀어 씁니다 */
{
  run(`i18n.setLocale('ko', { remember: false })`);
  const summary = () => ($('f-repeat-summary').hidden ? null : $('f-repeat-summary').textContent);
  const lunch = { id: 'lunch', title: '오점뭐', date: '2026-09-15', endDate: '2026-09-25', time: null, endTime: null, memo: '', owner: 'both', repeat: 'monthly' };
  globalThis.__lunch = lunch;
  error = attempt('openEditor(__lunch)');
  ok('a monthly multi-day event reads back its days', !error && summary() === '매달 15일 ~ 25일', error || summary());

  run(`setRepeat('yearly')`);
  ok('yearly names the month too', summary() === '매년 9월 15일 ~ 9월 25일', summary());

  $('f-multi').checked = false;
  $('f-multi').dispatchEvent({ type: 'change' });
  ok('turning off several days leaves one day', summary() === '매년 9월 15일', summary());

  run(`setRepeat('none')`);
  ok('no repeat, no line', summary() === null, summary());
  run(`$('editor').close()`);

  globalThis.__lunch = { ...lunch, date: '2026-09-28', endDate: '2026-10-03' };
  run('openEditor(__lunch)');
  ok('running into the next month says so', summary() === '매달 28일 ~ 다음 달 3일', summary());
  run(`$('editor').close()`);

  error = attempt(`openEditor(null, '${year}-09-20')`);
  $('f-repeat-on').checked = true;
  $('f-repeat-on').dispatchEvent({ type: 'change' });
  ok('ticking repeats on a new event shows the day at once', !error && summary() === '매달 20일', error || summary());
  run(`$('editor').close()`);

  run(`i18n.setLocale('en', { remember: false })`);
  globalThis.__lunch = lunch;
  run('openEditor(__lunch)');
  ok('and in English', summary() === 'Every month, day 15 to 25', summary());
  run(`$('editor').close()`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
