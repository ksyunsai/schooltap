/* Connect the page to the same worker that receives pushes when the app is closed. */
(() => {
  const version = 'locale-2';
  const script = new URL('./sw.js?rev=' + version, location.href).href;
  const container = navigator.serviceWorker;
  let registrationTask;
  let lastRequest = Promise.resolve();

  function bounded(work, ms, reason) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(reason)), ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  function register() {
    if (!container) return Promise.resolve(null);
    if (!registrationTask) {
      const work = Promise.resolve().then(() => container.register(script, { scope: './', updateViaCache: 'none' }));
      registrationTask = bounded(work, 12000, 'worker-registration-timeout').catch(() => {
        registrationTask = null;
        return null;
      });
    }
    return registrationTask;
  }

  const expected = worker => worker && worker.scriptURL === script;

  async function active() {
    let reg = await register();
    if (!reg) throw new Error('worker-unavailable');
    if (![reg.active, reg.waiting, reg.installing].some(expected)) {
      // An older open page may have registered the previous URL in this same scope.
      registrationTask = null;
      reg = await register();
      if (!reg) throw new Error('worker-unavailable');
    }
    const deadline = Date.now() + 12000;
    while (!expected(reg.active) || reg.active.state !== 'activated') {
      if (Date.now() >= deadline) {
        registrationTask = null;
        throw new Error('worker-activation-timeout');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return reg;
  }

  async function exchange(reg, action, lang, role) {
    const worker = reg.active;
    if (!expected(worker) || worker.state !== 'activated') throw new Error('worker-replaced');
    const { port1, port2 } = new MessageChannel();
    try {
      const ack = new Promise((resolve, reject) => {
        port1.onmessage = event => resolve(event.data);
        port1.onmessageerror = () => reject(new Error('worker-reply-unreadable'));
        worker.postMessage({ type: 'SCHOOLTAP_RECEIVER', version, action, lang, role }, [port2]);
      });
      const reply = await bounded(ack, 5000, 'worker-reply-timeout');
      if (worker !== reg.active) throw new Error('worker-replaced');
      if (!reply || !reply.ok || reply.version !== version || reply.lang !== lang) {
        throw new Error('worker-unconfirmed');
      }
      if (action === 'test' && (!reply.title || !reply.body)) throw new Error('worker-test-unconfirmed');
      return reply;
    } finally {
      port1.close();
      port2.close();
    }
  }

  function request(action, lang, role) {
    if (lang !== 'ko' && lang !== 'en') return Promise.reject(new Error('invalid-language'));
    const run = lastRequest.then(async () => {
      const reg = await active();
      try {
        return await exchange(reg, action, lang, role);
      } catch (error) {
        // A sync can be replayed after an update. Replaying a test could display it twice.
        if (action !== 'sync') throw error;
        await bounded(reg.update(), 12000, 'worker-update-timeout');
        return exchange(await active(), action, lang, role);
      }
    });
    lastRequest = run.catch(() => {});
    return run;
  }

  globalThis.schoolTapReceiver = {
    get registration() { return register(); },
    active,
    sync: lang => request('sync', lang),
    test: (lang, role) => request('test', lang, role)
  };
  register();
})();
