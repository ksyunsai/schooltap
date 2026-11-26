// SchoolTap™ Service Worker (Background Push & Notification Click Handler)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Keep launches online-first so site updates and live ride data stay current.
const appPath = new URL(self.registration.scope).pathname;
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || (url.pathname !== appPath && url.pathname !== appPath + 'index.html')) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    'SchoolTap · Connect to the internet and reload. 인터넷에 연결한 뒤 새로고침해 주세요.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {
      title: 'SchoolTap™ Smart Bus Alert',
      body: event.data ? event.data.text() : 'New school bus update received.'
    };
  }

  const title = payload.title || payload.notification?.title || '🚌 SchoolTap™ Bus Alert';
  const body = payload.body || payload.notification?.body || 'Your child’s bus ride status was updated.';
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
