(function installSchoolTapReader(channelId) {
  const isReaderPage = () =>
    window === window.top &&
    location.origin === 'https://ksyunsai.github.io' &&
    ['/schooltap/', '/schooltap/index.html'].includes(location.pathname) &&
    new URLSearchParams(location.search).get('role') === 'READER';

  if (!isReaderPage()) return false;

  let port, session, nextId = 0;
  function finish(current, error) {
    clearTimeout(current.timer);
    if (current.signal) current.signal.removeEventListener('abort', current.abort);
    if (current.reject) current.reject(error);
    session = null;
  }
  function stop(current) {
    if (session !== current) return;
    if (port) port.postMessage('stop:' + current.id);
    finish(current, new DOMException('Scan stopped', 'AbortError'));
  }
  function receive(event) {
    if (!isReaderPage() || !session || typeof event.data !== 'string') return;
    const match = /^(ready|error|tag):(\d+)(?::(.+))?$/.exec(event.data);
    if (!match || Number(match[2]) !== session.id) return;
    const current = session;
    if (match[1] === 'error') {
      const error = new DOMException('NFC reader unavailable', match[3] || 'NotReadableError');
      finish(current, error);
      if (current.ready) current.reader.dispatchEvent(new Event('readingerror'));
    } else if (match[1] === 'ready' && !current.ready) {
      current.ready = true;
      clearTimeout(current.timer);
      current.resolve();
      current.reject = null;
    } else if (match[1] === 'tag' && current.ready && !document.hidden &&
               /^(?:[0-9A-F]{2}:){3,9}[0-9A-F]{2}$/.test(match[3] || '')) {
      const reading = new Event('reading');
      Object.defineProperty(reading, 'serialNumber', { value: match[3] });
      current.reader.dispatchEvent(reading);
      if (typeof current.reader.onreading === 'function') current.reader.onreading(reading);
    }
  }
  function connect(event) {
    if (event.data !== channelId || event.ports.length !== 1 || !isReaderPage()) return;
    window.removeEventListener('message', connect);
    port = event.ports[0];
    port.onmessage = receive;
    port.start();
    if (session) port.postMessage('scan:' + session.id);
  }
  window.addEventListener('message', connect);

  class VehicleReader extends EventTarget {
    scan(options = {}) {
      if (!isReaderPage() || document.hidden)
        return Promise.reject(new DOMException('Reader page must be visible', 'InvalidStateError'));
      if (session) stop(session);
      const signal = options.signal;
      if (signal && signal.aborted)
        return Promise.reject(new DOMException('Scan stopped', 'AbortError'));
      return new Promise((resolve, reject) => {
        const current = { id: ++nextId, reader: this, signal, resolve, reject, ready: false };
        current.abort = () => stop(current);
        current.timer = setTimeout(() => stop(current), 8000);
        session = current;
        if (signal) signal.addEventListener('abort', current.abort, { once: true });
        if (port) port.postMessage('scan:' + current.id);
      });
    }
  }
  Object.defineProperty(window, 'NDEFReader', { configurable: true, value: VehicleReader });
  return true;
})
