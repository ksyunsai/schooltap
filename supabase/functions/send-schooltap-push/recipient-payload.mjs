import './ride-messages.js';
import './ride-alerts.js';

// Only these ride details must survive a second localization by an updated receiver.
const alertFields = [
  'event_type', 'student_name', 'student_name_ko', 'student_name_en',
  'eta_minutes', 'stop_ko', 'stop_en'
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function displayFields(fields, notice) {
  const localized = { ...fields };
  for (const key of ['title', 'body', 'message', 'lang']) {
    if (typeof fields[key] === 'string') localized[key] = key === 'message' ? notice.body : notice[key];
  }
  return localized;
}

/**
 * Call inside the existing send loop, after selecting this subscription.
 * payload is the existing Web Push payload object, before JSON.stringify.
 * record is the current authorized ride (using the DB record field names).
 */
export function localizeRecipientPayload(row, payload, record) {
  const lang = row?.subscription_json?.lang;
  if ((lang !== 'ko' && lang !== 'en') || !isObject(payload)) return payload;

  const details = {};
  for (const key of alertFields) {
    const value = record?.[key];
    if ((typeof value === 'string' && value.length) || Number.isFinite(value)) details[key] = value;
  }
  // Preserve existing record fields and all routing metadata. Never send the whole database row.
  const source = { ...payload };
  if (Object.keys(details).length && (payload.record === undefined || isObject(payload.record))) {
    source.record = { ...details, ...payload.record };
  }
  const notice = globalThis.schoolTapAlerts.format(source, lang);
  const localized = { ...displayFields(source, notice), title: notice.title, body: notice.body, lang };
  if (isObject(source.notification)) {
    localized.notification = { ...displayFields(source.notification, notice), title: notice.title, body: notice.body };
  }
  if (isObject(source.data)) localized.data = displayFields(source.data, notice);
  return localized;
}
