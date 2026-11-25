/* Мини-клиент CDP: подключение к Edge/Chrome по --remote-debugging-port. */
const PORT = process.env.CDP_PORT || 9222;

export async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

export async function connect(urlFilter = 'localhost:5173') {
  const list = await targets();
  const page =
    list.find((t) => t.type === 'page' && t.url.includes(urlFilter)) ||
    list.find((t) => t.type === 'page');
  if (!page) throw new Error('нет страницы с ' + urlFilter);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws error'));
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) {
          pending.delete(mid);
          reject(new Error('timeout ' + method));
        }
      }, 120000);
    });

  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        'JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text),
      );
    }
    return r.result?.value;
  };

  return { ws, send, evaluate, events, close: () => ws.close() };
}

export async function withPage(fn, urlFilter) {
  const c = await connect(urlFilter);
  try {
    return await fn(c);
  } finally {
    c.close();
  }
}
