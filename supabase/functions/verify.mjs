import assert from 'node:assert/strict';
import { localizeRecipientPayload } from './send-schooltap-push/recipient-payload.mjs';

const row = lang => ({ subscription_json: { endpoint: 'https://push.example.test/id', keys: {}, lang } });
const payload = {
  title: '📍 [Emma] 도착 약 10분 전!',
  body: '[home bus stop] 정류장으로 버스가 접근 중입니다.',
  tag: 'eta-123',
  url: './?role=PARENT',
  notification: { title: '이전 제목', body: '기존 본문', icon: '/bus.png' },
  data: { url: './?role=PARENT', title: '옛 알림', message: '이전 안내', localId: 6 }
};
const ride = {
  event_type: 'APPROACHING_10M', student_name_en: 'Emma', student_name_ko: '엠마',
  eta_minutes: 10, stop_en: 'home bus stop', stop_ko: '집 앞', invite_code: 'keep-on-server'
};
const original = structuredClone(payload);
for (const lang of [undefined, null, '', 'fr']) assert.equal(localizeRecipientPayload(row(lang), payload, ride), payload);
assert.equal(localizeRecipientPayload({}, payload, ride), payload);

for (const lang of ['en', 'ko']) {
  const result = localizeRecipientPayload(row(lang), payload, ride);
  const english = lang === 'en';
  assert.equal(result.lang, lang);
  assert.match(result.title, english ? /Bus approaching.*10 min.*Emma/ : /정류장 도착 예정.*10분.*엠마/);
  assert.match(result.body, english ? /Stop · home bus stop/ : /정류장 · 집 앞/);
  if (english) assert.doesNotMatch(result.title + result.body, /[가-힣]/);
  assert.equal(result.notification.title, result.title);
  assert.equal(result.notification.body, result.body);
  assert.equal(result.data.message, result.body);
  assert.equal(result.data.title, result.title);
  assert.equal(result.notification.icon, payload.notification.icon);
  assert.equal(result.data.localId, payload.data.localId);
  assert.equal(result.url, payload.url);
  assert.equal(result.tag, payload.tag);
  assert(!JSON.stringify(result).includes('keep-on-server'));
  const receiver = globalThis.schoolTapAlerts.format(result, lang);
  assert.equal(receiver.title, result.title);
  assert.match(receiver.body, english ? /home bus stop/ : /집 앞/);
}
assert.deepEqual(payload, original);

const missedExit = {
  title: '🏷️ [Emma] 하차 태그를 잊은 것 같아요',
  body: '승차 후 1시간 동안 하차 기록이 없어요. 아이에게 도착 여부를 확인해 보세요.'
};
for (const event of [undefined, {event_type: 'NO_ALIGHT_1H'}]) {
  const english = localizeRecipientPayload(row('en'), missedExit, event);
  const korean = localizeRecipientPayload(row('ko'), missedExit, event);
  assert.match(english.title, /No exit tap 1 hour after boarding · Emma/);
  assert.doesNotMatch(english.title + english.body, /[가-힣]/);
  assert.match(korean.title, /승차 1시간 후 하차 태그 미확인 · Emma/);
  assert.match(korean.body, /확인|물어봐/);
}

const originalRandom = Math.random;
try {
  for (const [kind, pools] of Object.entries(globalThis.schoolTapRideMessages)) {
    for (const lang of ['ko', 'en']) {
      const bodies = new Set();
      assert.equal(pools[lang].length, 20);
      for (let i = 0; i < 20; i++) {
        Math.random = () => (i + 0.5) / 20;
        const result = localizeRecipientPayload(row(lang), {}, { ...ride, event_type: kind });
        assert(result.body.includes(pools[lang][i]));
        if (kind === 'NO_ALIGHT_1H') {
          assert.match(result.title + result.body, lang === 'en' ? /hour/i : /한 시간|1시간/);
          assert.match(result.body, lang === 'en' ? /check|confirm|ask your (?:child|rider)/i : /확인|물어봐/);
        }
        bodies.add(result.body);
      }
      assert.equal(bodies.size, 20);
    }
  }
} finally {
  Math.random = originalRandom;
}
console.log('PASS: legacy ETA and missing-exit payloads, recipient-specific English and Korean, preserved routing, old subscriptions, and 240 localized message variants.');
