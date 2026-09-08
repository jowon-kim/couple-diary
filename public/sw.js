/**
 * 서비스워커 — 알림만 맡습니다. 오프라인 캐시는 하지 않아요.
 * 앱이 닫혀 있어도 이 파일이 깨어나서 알림을 띄웁니다.
 */

/* 새 파일을 올리면 다음에 열 때 바로 갈아탑니다 (기다리지 않게) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* 형식이 깨졌으면 기본 문구로 띄웁니다 — 안 띄우면 브라우저가 경고를 냅니다 */
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Couple Diary', {
    body: data.body || '',
    icon: '/favicon.png',
    // 갤럭시 상단바에 뜨는 작은 아이콘. 안드로이드가 모양만 떼어다 쓰기 때문에
    // 사진을 주면 뭉개진 덩어리가 됩니다 — 모양만 남긴 고양이 얼굴을 따로 줍니다.
    // 색은 안드로이드가 알아서 (밝은 상단바면 회색, 어두우면 흰색) 칠합니다.
    badge: '/badge.png',
    // 같은 일정이면 알림이 쌓이지 않고 마지막 것만 남습니다
    tag: data.tag || 'diary',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    // 이미 열어둔 창이 있으면 그리로, 없으면 새로 엽니다
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if (client.url.startsWith(self.location.origin)) return client.focus();
    }
    return self.clients.openWindow('/');
  })());
});
