// SchoolTap™ Service Worker (옵션 B: 백그라운드 푸시 및 알림 클릭 핸들러)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {
      title: 'SchoolTap™ 통학 안심 알림',
      body: event.data ? event.data.text() : '새로운 통학 알림이 도착했습니다.'
    };
  }

  const title = payload.title || payload.notification?.title || '🚌 SchoolTap™ 통학 알림';
  const body = payload.body || payload.notification?.body || '우리 아이 통학 상태가 업데이트되었습니다.';
  const tag = payload.tag || 'schooltap-push-' + Date.now();
  const targetUrl = payload.url || payload.data?.url || './';

  const svgBadge = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#FBBF24"/><text x="64" y="88" font-size="76" text-anchor="middle">🚌</text></svg>'
  );
  const iconUrl = 'data:image/svg+xml;utf8,' + svgBadge;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      vibrate: [220, 100, 220],
      icon: iconUrl,
      badge: iconUrl,
      data: { url: targetUrl }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification?.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
      return null;
    })
  );
});
