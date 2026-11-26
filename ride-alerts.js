/* Shared by the page and its classic service worker. */
(() => {
  const pools = globalThis.schoolTapRideMessages;
  const labels = {
    BOARD: {ko: '🚌 승차 태그', en: '🚌 Boarding tap'},
    ALIGHT: {ko: '👋 하차 태그', en: '👋 Exit tap'},
    APPROACHING_10M: {ko: '📍 정류장 도착 예정', en: '📍 Bus approaching'},
    NO_ALIGHT_1H: {ko: '🏷️ 하차 태그 미확인', en: '🏷️ No exit tap recorded'},
    TEST: {ko: '🔔 스쿨탭 테스트 알림', en: '🔔 SchoolTap test notification'},
    UPDATE: {ko: '💌 스쿨탭 소식', en: '💌 SchoolTap update'}
  };

  const cacheName = 'schooltap-notification-preferences-v1';
  const languageKey = '/schooltap/notification-language';
  let lastLanguage = 'en';
  let pendingWrite = Promise.resolve();

  function saveLanguage(lang) {
    if (lang !== 'ko' && lang !== 'en') return pendingWrite;
    lastLanguage = lang;
    pendingWrite = pendingWrite.then(async () => {
      const cache = await caches.open(cacheName);
      await cache.put(languageKey, new Response(lang));
    }).catch(() => {});
    return pendingWrite;
  }

  async function readLanguage() {
    await pendingWrite;
    try {
      const response = await (await caches.open(cacheName)).match(languageKey);
      const saved = response && await response.text();
      if (saved === 'ko' || saved === 'en') lastLanguage = saved;
    } catch {}
    return lastLanguage;
  }

  function object(value) {
    if (typeof value === 'string' && value.trimStart().startsWith('{')) {
      try { return JSON.parse(value) || {}; } catch {}
    }
    return value && typeof value === 'object' ? value : {};
  }

  function field(parts, names) {
    for (const part of parts) {
      for (const name of names) {
        const value = part[name];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      }
    }
    return '';
  }

  function explicitKind(value) {
    const token = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (Object.hasOwn(pools, token)) return token;
    if (/^(?:NO_ALIGHT|MISSING_(?:ALIGHT|EXIT|TAP)|MISSED_ALIGHT|NO_EXIT)(?:_.*)?$/.test(token)) return 'NO_ALIGHT_1H';
    if (/^(?:ETA|APPROACHING|BUS_APPROACHING|ARRIVING)(?:_.*)?$/.test(token)) return 'APPROACHING_10M';
    if (/^(?:ALIGHTING|DROPOFF|DROP_OFF|TAP_OFF|EXIT_TAP)$/.test(token)) return 'ALIGHT';
    if (/^(?:BOARDING|PICKUP|PICK_UP|TAP_ON|BOARD_TAP)$/.test(token)) return 'BOARD';
    if (/^(?:PUSH_TEST|TEST_PUSH|TEST_NOTIFICATION)$/.test(token)) return 'TEST';
    return null;
  }

  // Older senders may supply only a human-readable title/body and an event ID.
  function textKind(text) {
    text = text.replace(/승\s*[·/ㆍ-]?\s*하차/g, '');
    if (/(?:테스트|시험\s*(?:푸시|알림|발송)|\btest(?:ing)?\b)/i.test(text)) return 'TEST';
    if (/(?:하차.{0,22}(?:미태그|미확인|누락|미수신|미기록|잊|없|안\s*(?:찍|들어|왔|된)|않)|미(?:태그|확인).{0,8}하차|(?:no|missing|missed|without).{0,18}(?:exit|alight|drop[ -]?off)|(?:exit|alight|drop[ -]?off).{0,22}(?:missed|missing|not (?:yet )?(?:recorded|received)|hasn[’']t|has not|still blank))/i.test(text)) return 'NO_ALIGHT_1H';
    if (/(?:도착(?:할)?\s*(?:예정|예고|예상|약?\s*\d+\s*분)|정류장.{0,12}(?:접근|다가오|가까)|마중\s*알림|\b(?:approaching|arriving|ETA)\b|\d+\s*min(?:ute)?s?\s*(?:away|until))/i.test(text)) return 'APPROACHING_10M';
    const alight = /하차|내렸|내렸어요|\b(?:alight(?:ed|ing)?|drop[ -]?off|exit tap|tapped off|got off)\b/i.test(text);
    const board = /승차|탑승|버스에\s*(?:탔|올랐)|\b(?:board(?:ed|ing)?|tapped on|on board)\b/i.test(text);
    if (alight === board) return null;
    return alight ? 'ALIGHT' : 'BOARD';
  }

  function randomIndex(kind, lang) {
    return Math.floor(Math.random() * pools[kind][lang].length);
  }

  function bodyFor(kind, lang, index) {
    const list = pools[kind][lang];
    const at = Number.isInteger(index) && index >= 0 ? index % list.length : randomIndex(kind, lang);
    return list[at];
  }

  function format(input, requestedLanguage) {
    const lang = requestedLanguage === 'ko' ? 'ko' : 'en';
    const payload = object(input);
    const notice = object(payload.notification);
    const data = object(payload.data);
    const noticeData = object(notice.data);
    const parts = [object(data.record), object(payload.record), object(noticeData.record), data, noticeData, payload];
    const titleText = field([notice, payload, data], ['title']);
    const bodyText = field([notice, payload, data], ['body', 'message']) || (typeof input === 'string' && !Object.keys(payload).length ? input : '');
    const combined = titleText + ' ' + bodyText;
    const kindFields = ['event_type', 'eventType', 'type', 'kind', 'action', 'event'];
    let kind;
    for (const part of parts) {
      for (const key of kindFields) {
        kind = explicitKind(part[key]) || textKind(typeof part[key] === 'string' ? part[key] : '');
        if (kind) break;
      }
      if (kind) break;
    }
    const id = field(parts, ['event_id', 'eventId', 'log_id', 'id']);
    if (!kind && id.startsWith('noalight-')) kind = 'NO_ALIGHT_1H';
    if (!kind && id.startsWith('eta-')) kind = 'APPROACHING_10M';
    if (!kind) {
      const fromTitle = textKind(titleText);
      const fromBody = textKind(bodyText);
      if (fromTitle === 'TEST' || fromBody === 'TEST') kind = 'TEST';
      else if (fromTitle === 'NO_ALIGHT_1H' || fromBody === 'NO_ALIGHT_1H') kind = 'NO_ALIGHT_1H';
      else kind = fromTitle || fromBody || 'UPDATE';
    }
    const rawEta = field(parts, ['eta_minutes','etaMinutes','eta']) || combined.match(/(\d+(?:\.\d+)?)\s*(?:분|min(?:ute)?s?\b)/i)?.[1];
    const eta = Number(rawEta);
    const bracket = titleText.match(/\[([^\]\n]{1,45})\]/)?.[1] || '';
    const nameFromTitle = /스쿨탭|schooltap|알림|태그|승차|하차|탑승|테스트|도착|^(?:bus|test|notice|alert|board|alight|eta|update)$/i.test(bracket) ? '' : bracket;
    const student = field(parts, lang === 'en' ? ['student_name_en','studentNameEn','name_en','nameEn'] : ['student_name_ko','studentNameKo','name_ko','nameKo'])
      || field(parts, ['student_name','studentName','childName'])
      || nameFromTitle || bodyText.match(/^([가-힣]{2,5})\s*(?:학생|어린이)(?:이|가|은|는)\s/)?.[1];
    let title = labels[kind][lang];
    if (kind === 'APPROACHING_10M' && Number.isFinite(eta) && eta > 0) {
      title += lang === 'ko' ? ' · 약 ' + eta + '분' : ' · ~' + eta + ' min';
    }
    if (student && kind !== 'UPDATE' && kind !== 'TEST') title += ' · ' + student;
    let body = bodyFor(kind, lang);
    // Preserve a same-language custom announcement when the sender provides no ride event.
    if (kind === 'UPDATE' && !parts.some(p => kindFields.some(k => explicitKind(p[k]) === 'UPDATE')) && bodyText &&
        !/(?:updated|new (?:ride |bus )?update|업데이트|새 알림|새로운 알림)/i.test(bodyText)) {
      const matches = lang === 'ko' ? /[가-힣]/.test(bodyText) : /[a-z]/i.test(bodyText) && !/[가-힣]/.test(bodyText);
      if (matches) body = bodyText + '\n' + body;
    }
    return {title, body, lang, tag: field([payload, notice, data], ['tag']) || id,
      url: field([payload, data, noticeData, notice], ['url'])};
  }

  globalThis.schoolTapAlerts = { format, randomIndex, bodyFor, saveLanguage, readLanguage };
})();
