/* 알림 문구. 웹푸시가 제목·본문을 따로 받아서 두 조각으로 돌려줍니다. */

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const dayLabel = (date) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일 (${WEEKDAY[new Date(y, m - 1, d).getDay()]})`;
};

function whenLabel(event) {
  if (event.endDate && event.endDate !== event.date) {
    return `${dayLabel(event.date)} ~ ${dayLabel(event.endDate)}`;
  }
  if (!event.time) return dayLabel(event.date);
  const time = event.endTime ? `${event.time} ~ ${event.endTime}` : event.time;
  return `${dayLabel(event.date)} ${time}`;
}

/** 이름 뒤에 조사를 안 붙이려고 가운뎃점으로 끊었습니다 (받침에 따라 이/가가 갈립니다). */
export function describe(kind, event, who) {
  return {
    title: `🍒 ${kind}${who ? ' · ' + who : ''}`,
    body: [whenLabel(event), event.title, event.memo].filter(Boolean).join('\n'),
  };
}
