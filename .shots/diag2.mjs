/* Диагностика 2: исключения и состояние UI во время «зависшей» обработки. */
import { withPage } from './cdp.mjs';
import { sleep, TEXT, waitFor } from './lib.mjs';

const HOOK = `
window.__reqs = [];
(function(){
  const orig = window.fetch.bind(window);
  window.fetch = function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat') !== -1) {
      let body = null;
      try { body = init && init.body ? JSON.parse(init.body) : null; } catch(e){}
      window.__reqs.push({ n: window.__reqs.length + 1, url });
      const t = (body && body.user) || '';
      return Promise.resolve(new Response(
        JSON.stringify({ ok:true, content:'ПЕРЕПИСАНО: ' + t.slice(0, 60), model:'GigaChat-2',
          usage:{ prompt_tokens:100, completion_tokens:20, total_tokens:120 }, elapsedMs: 7 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ));
    }
    return orig(input, init);
  };
})();
`;

const run = async () => {
  await withPage(async (c) => {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Log.enable');

    await c.evaluate(`
      (() => { localStorage.clear();
        localStorage.setItem('tph.v1.settings', JSON.stringify({ cloudAllowed:true, cloudConsentGiven:true,
          gigachatProxyUrl:'/api/gigachat', cloudProvider:'gigachat', cloudModel:'GigaChat-2', clientId:'qa-1' }));
        return 1; })()
    `);
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await c.send('Page.reload');
    await sleep(3000);
    await waitFor(c, `document.readyState === 'complete'`, 20000);
    await sleep(800);
    await c.evaluate(`(() => { const d=document.querySelector('[role=dialog]'); if(!d) return 0;
      const b=[...d.querySelectorAll('button')].find(x=>/Новый проект|Пропустить/.test(x.textContent||'')); if(b)b.click(); return 1; })()`);
    await sleep(700);
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Вставить'); if(b)b.click(); return 1; })()`);
    await sleep(900);
    await c.evaluate(`(() => { const ta=document.querySelector('textarea'); if(!ta) return 0;
      const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      s.call(ta, ${JSON.stringify(TEXT)}); ta.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
    await sleep(500);
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Загрузить текст'); if(b)b.click(); return 1; })()`);
    await sleep(1200);
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Облако'); if(b)b.click(); return 1; })()`);
    await sleep(400);
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Запустить'); if(b)b.click(); return 1; })()`);
    await sleep(4000);

    console.log('--- статусбар ---');
    console.log(await c.evaluate(`
      (() => {
        const bar = document.querySelector('.status-bar');
        return bar ? bar.innerText.replace(/\\n+/g,' | ').slice(0, 300) : 'нет .status-bar';
      })()
    `));

    console.log('--- события консоли/исключений ---');
    const interesting = c.events.filter((e) =>
      e.method === 'Runtime.exceptionThrown' ||
      e.method === 'Runtime.consoleAPICalled' ||
      e.method === 'Log.entryAdded'
    );
    for (const e of interesting.slice(-12)) {
      if (e.method === 'Runtime.exceptionThrown') {
        console.log('EXCEPTION:', (e.params.exceptionDetails?.exception?.description || '').slice(0, 300));
      } else if (e.method === 'Runtime.consoleAPICalled') {
        const txt = (e.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        console.log(`console.${e.params.type}:`, String(txt).slice(0, 200));
      } else {
        console.log('LOG:', (e.params.entry?.text || '').slice(0, 200));
      }
    }

    console.log('--- запросы ---', await c.evaluate(`JSON.stringify(window.__reqs)`));
    console.log('--- текст на экране (фрагмент) ---');
    console.log(await c.evaluate(`document.body.innerText.replace(/\\s+/g,' ').slice(0, 600)`));
  });
  process.exit(0);
};

run().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
