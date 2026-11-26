importScripts('./ride-messages.js', './ride-alerts.js');

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
  event.waitUntil((async () => {
    let payload;
    try {
      payload = event.data?.json();
    } catch {
      payload = event.data?.text();
    }
    const lang = await schoolTapAlerts.readLanguage();
    const notice = schoolTapAlerts.format(payload, lang);
    await self.registration.showNotification(notice.title, {
      body: notice.body,
      lang,
      tag: notice.tag || 'schooltap-push-' + Date.now(),
      renotify: true,
      vibrate: [220, 100, 220],
      icon: new URL('./icons/schooltap-192.png', self.registration.scope).href,
      data: { url: notice.url || './?role=PARENT' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = new URL(self.registration.scope);
  const parentUrl = new URL('./?role=PARENT', scope);
  let target = parentUrl;
  try {
    const parsed = new URL(event.notification.data?.url || parentUrl, scope);
    if (parsed.origin === scope.origin && parsed.pathname.startsWith(scope.pathname)) target = parsed;
  } catch {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetRole = (target.searchParams.get('role') || target.searchParams.get('mode') || 'ADMIN').toUpperCase();
    const existing = windows.find(client => {
      const url = new URL(client.url);
      const role = (url.searchParams.get('role') || url.searchParams.get('mode') || 'ADMIN').toUpperCase();
      return url.origin === scope.origin && url.pathname === target.pathname && role === targetRole;
    });
    if (existing) return existing.focus();
    return self.clients.openWindow(target.href);
  })());
});
