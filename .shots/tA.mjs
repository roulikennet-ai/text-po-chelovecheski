/* Чек-лист приёмки: пункты 1, 2, 5, 7. */
import { withPage } from './cdp.mjs';
import { sleep, TEXT, waitFor } from './lib.mjs';

const results = [];
const add = (n, label, ok, detail) => {
  results.push({ n, label, ok, detail });
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${n}. ${label}\n   ${detail}`);
};

const HOOK = `
window.__reqs = [];
window.__failNext = false;
(function(){
  const orig = window.fetch.bind(window);
  window.fetch = function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat') !== -1) {
      let body = null;
      try { body = init && init.body ? JSON.parse(init.body) : null; } catch(e){}
      window.__reqs.push({ url, body });
      if (window.__failNext) {
        window.__failNext = false;
        return Promise.resolve(new Response(
          JSON.stringify({ ok:false, code:'quota', error:'Тестовый сбой модели: превышен лимит' }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        ));
      }
      const t = (body && body.user) || '';
      return new Promise((resolve) => setTimeout(() => resolve(new Response(
        JSON.stringify({ ok:true, content:'ПЕРЕПИСАНО: ' + t.slice(0, 60), model:'GigaChat-2',
          usage:{ prompt_tokens:100, completion_tokens:20, total_tokens:120 }, elapsedMs: 7 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )), 250));
    }
    return orig(input, init);
  };
})();
`;

const click = (c, text) =>
  c.evaluate(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === ${JSON.stringify(text)});
      if (!b) return 'NOT_FOUND';
      if (b.disabled) return 'DISABLED';
      b.click();
      return 'ok';
    })()
  `);

const idle = (c) =>
  c.evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Запустить');
    return !!b && !b.disabled;
  })()`);

const waitIdle = async (c, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await idle(c)) return true;
    await sleep(300);
  }
  return false;
};

/** Ждать, пока число запросов перестанет расти (обработка завершилась). */
const settle = async (c, min = 1, ms = 45000) => {
  let last = -1;
  let stable = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await reqCount(c);
    if (n === last && n >= min) {
      if (++stable >= 6) return n;
    } else {
      stable = 0;
      last = n;
    }
    await sleep(350);
  }
  return last;
};

const reqCount = (c) => c.evaluate(`window.__reqs.length`);
const resetReqs = (c) => c.evaluate(`window.__reqs = []; 0`);

const run = async () => {
  await withPage(async (c) => {
    await c.send('Page.enable');
    await c.send('Runtime.enable');

    await c.evaluate(`
      (() => {
        localStorage.clear();
        localStorage.setItem('tph.v1.settings', JSON.stringify({
          cloudAllowed: true, cloudConsentGiven: true, gigachatProxyUrl: '/api/gigachat',
          cloudProvider: 'gigachat', cloudModel: 'GigaChat-2',
          userName: 'Тестовый Проверяющий', clientId: 'qa-client-1',
        }));
        return 'ready';
      })()
    `);
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await c.send('Page.reload');
    await sleep(3000);
    await waitFor(c, `document.readyState === 'complete'`, 20000);
    await sleep(1000);

    // Закрыть модалку выбора движка
    const closed = await c.evaluate(`
      (() => {
        const dlg = document.querySelector('[role=dialog]');
        if (!dlg) return 'нет модалки';
        const b = [...dlg.querySelectorAll('button')].find(x => /Новый проект|Пропустить/.test(x.textContent||''));
        if (!b) return 'кнопка не найдена';
        b.click();
        return 'ok';
      })()
    `);
    await sleep(900);
    console.log('модалка движка:', closed, '| осталось:', await c.evaluate(`document.querySelectorAll('[role=dialog]').length`));

    /* ---------- ПУНКТ 1: вставка учебного текста ---------- */
    const o1 = await click(c, 'Вставить');
    await sleep(900);
    const filled = await c.evaluate(`
      (() => {
        const ta = document.querySelector('textarea');
        if (!ta) return 'NO_TEXTAREA';
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(ta, ${JSON.stringify(TEXT)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return ta.value.length;
      })()
    `);
    await sleep(600);
    const a1 = await click(c, 'Загрузить текст');
    await sleep(1200);
    const s1 = JSON.parse(await c.evaluate(`
      (() => {
        const body = document.body.innerText;
        return JSON.stringify({
          dialogs: document.querySelectorAll('[role=dialog]').length,
          has48: body.includes('48'), has2021: body.includes('2021'),
          paras: (body.match(/абзац/gi)||[]).length,
        });
      })()
    `));
    add(1, 'Вставка учебного текста',
      s1.has48 && s1.has2021 && s1.dialogs === 0,
      `открытие=${o1}, введено=${filled}, применение=${a1}; текст на месте (48=${s1.has48}, 2021=${s1.has2021}), модалка закрыта=${s1.dialogs === 0}`);

    /* ---------- ПУНКТ 2: выбор другого стиля ---------- */
    const eng = await click(c, 'Облако');
    await sleep(600);
    const pr = await c.evaluate(`
      (() => {
        const b = [...document.querySelectorAll('button.preset')].find(x => (x.textContent||'').includes('F2'));
        if (!b) return 'NOT_FOUND';
        b.click();
        return 'F2 выбран';
      })()
    `);
    await sleep(600);
    await resetReqs(c);
    const r2 = await click(c, 'Запустить');
    await settle(c, 3);
    const s2 = JSON.parse(await c.evaluate(`
      JSON.stringify({
        count: window.__reqs.length,
        f2: window.__reqs[0] ? /F2/.test(window.__reqs[0].body.system||'') : false,
        szhaty: window.__reqs[0] ? /Сжатый/.test(window.__reqs[0].body.system||'') : false,
        head: window.__reqs[0] ? (window.__reqs[0].body.system||'').slice(0,70) : null,
      })
    `));
    add(2, 'Выбор другого стиля',
      s2.f2 && s2.szhaty,
      `движок=${eng}, ${pr}, запуск=${r2}; запросов=${s2.count}; system содержит «F2»=${s2.f2}, «Сжатый»=${s2.szhaty}; начало: ${JSON.stringify(s2.head)}`);

    /* ---------- ПУНКТ 5: ошибка модели ---------- */
    await resetReqs(c);
    await c.evaluate(`window.__failNext = true; 1`);
    const r5 = await click(c, 'Запустить');
    await settle(c, 3);
    const s5 = JSON.parse(await c.evaluate(`
      (() => {
        const body = document.body.innerText;
        const toasts = [...document.querySelectorAll('[class*=toast]')].map(e => (e.textContent||'').trim()).filter(Boolean);
        return JSON.stringify({
          sourceKept: body.includes('48') && body.includes('2021'),
          errorStatus: (body.match(/ошибк|требуют внимания|не удалось/gi)||[]).length,
          toast: toasts[0] ? toasts[0].slice(0, 90) : null,
          reqs: window.__reqs.length,
        });
      })()
    `));
    add(5, 'Ошибка модели',
      s5.sourceKept && s5.errorStatus > 0 && !!s5.toast,
      `запуск=${r5}; запросов=${s5.reqs}; исходный текст сохранён=${s5.sourceKept}; признаков ошибки=${s5.errorStatus}; тост: ${JSON.stringify(s5.toast)}`);

    /* ---------- ПУНКТ 7: повторный клик ---------- */
    await settle(c, 3);
    await resetReqs(c);
    const dbl = await c.evaluate(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').trim() === 'Запустить');
        if (!b) return JSON.stringify({ err: 'NOT_FOUND' });
        if (b.disabled) return JSON.stringify({ err: 'DISABLED' });
        b.click();
        const dis1 = b.disabled;
        b.click();
        b.click();
        return JSON.stringify({ disabledAfterFirstClick: dis1 });
      })()
    `);
    await settle(c, 3);
    const n7 = await reqCount(c);
    const d7 = JSON.parse(dbl);
    add(7, 'Повторный клик',
      !d7.err && n7 <= 3,
      `${JSON.stringify(d7)}; тройной клик дал ${n7} запросов при 3 абзацах`);
  });

  console.log('\n===== ИТОГО =====');
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}. ${r.label}`));
  process.exit(0);
};

run().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
