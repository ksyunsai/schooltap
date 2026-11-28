const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bridge = readFileSync(path.join(__dirname, '../app/src/main/assets/reader-bridge.js'), 'utf8');
const readerPage = 'https://ksyunsai.github.io/schooltap/?role=READER';
const uid = '04:A1:02:03:04:05:FE';

function openPage(url = readerPage, embedded = false) {
  const window = new EventTarget();
  window.top = embedded ? {} : window;
  const document = { hidden: false };
  const context = vm.createContext({
    window, document, location: new URL(url), URLSearchParams,
    EventTarget, Event, DOMException, setTimeout, clearTimeout, navigator: {}
  });
  const installed = vm.runInContext(bridge + "('test-channel')", context);
  function connect(channel = 'test-channel') {
    const port = {
      sent: [], start() {}, postMessage(payload) { this.sent.push(payload); },
      send(payload) { this.onmessage?.({ data: payload }); }
    };
    const handshake = new Event('message');
    Object.assign(handshake, { data: channel, ports: [port] });
    window.dispatchEvent(handshake);
    return port;
  }
  return { window, document, context, installed, connect };
}

test('only the top-level official vehicle page receives the reader', () => {
  for (const url of [readerPage.replace('https:', 'http:'), readerPage.replace('/schooltap/', '/other/'),
    readerPage.replace('READER', 'PARENT'), readerPage.replace('github.io', 'github.io.example')]) {
    assert.equal(openPage(url).installed, false);
  }
  assert.equal(openPage(readerPage, true).installed, false);
  assert.equal(openPage().installed, true);
});

test('the existing SchoolTap web scan handler receives one real-format UID only after native readiness', async () => {
  const page = openPage();
  const website = readFileSync(path.join(__dirname, '../../../index.html'), 'utf8');
  const scan = website.match(/const startGalaxyNfcScanner = async \(\) => \{[\s\S]*?\n\s*\};\s*\n\s*\/\/ NFC Tag Engine/);
  assert.ok(scan, 'web entry point must still use the reader bridge');
  const uids = [], states = [];
  Object.assign(page.context, { isEn: true, soundMuted: true, showToast() {}, playChime() {},
    setNfcScanning: value => states.push(value), handleTagUidRef: { current: id => uids.push(id) } });
  const started = vm.runInContext(scan[0].slice(0, scan[0].lastIndexOf('// NFC Tag Engine')) + '\nstartGalaxyNfcScanner()', page.context);
  const wrong = page.connect('another-channel');
  assert.deepEqual(wrong.sent, []);
  const port = page.connect();
  assert.deepEqual(port.sent, ['scan:1']);
  port.send('tag:1:' + uid);
  port.send('ready:2');
  assert.deepEqual(states, []);
  port.send('ready:1');
  await started;
  assert.deepEqual(states, [true]);
  port.send('tag:1:bad');
  port.send('tag:1:');
  port.send('tag:2:' + uid);
  port.send('tag:1:' + uid);
  page.document.hidden = true;
  port.send('tag:1:' + uid);
  page.document.hidden = false;
  page.context.location = new URL(readerPage.replace('/schooltap/', '/other/'));
  port.send('tag:1:' + uid);
  assert.deepEqual(uids, [uid]);
});

test('native adapter errors, replaced scans, and an aborted scan cannot synthesize a tap', async () => {
  const page = openPage();
  const port = page.connect();
  const scanner = new page.window.NDEFReader();
  const rejected = scanner.scan();
  port.send('error:1:NotSupportedError');
  await assert.rejects(rejected, { name: 'NotSupportedError' });
  const first = scanner.scan();
  const controller = new AbortController();
  const second = scanner.scan({ signal: controller.signal });
  await assert.rejects(first, { name: 'AbortError' });
  assert.deepEqual(port.sent, ['scan:1', 'scan:2', 'stop:2', 'scan:3']);
  controller.abort();
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(port.sent.at(-1), 'stop:3');
  page.document.hidden = true;
  await assert.rejects(scanner.scan(), { name: 'InvalidStateError' });
});
