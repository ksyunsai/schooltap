const RECEIVER_VERSION = 'locale-2';
importScripts('./ride-messages.js?v=ride-copy-3', './ride-alerts.js?v=ride-copy-3');

// SchoolTap™ Service Worker (Background Push & Notification Click Handler)
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
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
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).catch(() => new Response(
    'SchoolTap · Connect to the internet and reload. 인터넷에 연결한 뒤 새로고침해 주세요.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});

async function showPush(payload, expectedLanguage) {
  const lang = await schoolTapAlerts.readLanguage();
  if (expectedLanguage && lang !== expectedLanguage) throw new Error('Notification language changed');
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
  return notice;
}

self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    payload = event.data?.text();
  }
  event.waitUntil(showPush(payload));
});

self.addEventListener('message', (event) => {
  const request = event.data;
  const port = event.ports?.[0];
  if (request?.type !== 'SCHOOLTAP_RECEIVER' || !port) return;
  event.waitUntil((async () => {
    const failure = { ok: false, version: RECEIVER_VERSION };
    try {
      if (request.version !== RECEIVER_VERSION || !['sync','test'].includes(request.action)
          || !['ko','en'].includes(request.lang)) return port.postMessage(failure);
      const saved = await schoolTapAlerts.saveLanguage(request.lang);
      if (!saved) return port.postMessage(failure);
      const reply = { ok: true, version: RECEIVER_VERSION, lang: request.lang };
      if (request.action === 'test') {
        const url = ['PARENT','READER'].includes(request.role) ? './?role=' + request.role : './';
        const notice = await showPush({ event_type: 'TEST', tag: 'schooltap-test', url }, request.lang);
        reply.title = notice.title;
        reply.body = notice.body;
      }
      port.postMessage(reply);
    } catch {
      port.postMessage(failure);
    } finally {
      port.close?.();
    }
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
