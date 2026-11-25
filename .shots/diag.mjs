/* Диагностика: почему пакет обрывается после первого абзаца. */
import { withPage } from './cdp.mjs';
import { sleep, TEXT, waitFor } from './lib.mjs';

const HOOK = `
window.__reqs = []; window.__log = [];
(function(){
  const orig = window.fetch.bind(window);
  window.fetch = function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat') !== -1) {
      let body = null;
      try { body = init && init.body ? JSON.parse(init.body) : null; } catch(e){}
      window.__reqs.push({ at: Date.now(), n: window.__reqs.length + 1 });
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
window.addEventListener('error', e => window.__log.push('window.error: ' + e.message));
window.addEventListener('unhandledrejection', e => window.__log.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
`;

const run = async () => {
  await withPage(async (c) => {
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    c.events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .slice(-5)
      .forEach((e) => console.log('console.error:', JSON.stringify(e.params.args?.[0]?.value || e.params.args?.[0]?.description || '').slice(0, 200)));

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
    await c.evaluate(`
      (() => { const d=document.querySelector('[role=dialog]'); if(!d) return 0;
        const b=[...d.querySelectorAll('button')].find(x=>/Новый проект|Пропустить/.test(x.textContent||''));
        if(b) b.click(); return 1; })()
    `);
    await sleep(700);

    // Вставка
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Вставить'); if(b)b.click(); return 1; })()`);
    await sleep(900);
    await c.evaluate(`
      (() => { const ta=document.querySelector('textarea'); if(!ta) return 0;
        const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
        s.call(ta, ${JSON.stringify(TEXT)}); ta.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()
    `);
    await sleep(500);
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Загрузить текст'); if(b)b.click(); return 1; })()`);
    await sleep(1200);

    console.log('абзацев в проекте:', await c.evaluate(`
      (() => { const p = JSON.parse(localStorage.getItem('tph.v1.projects')||'[]');
        return p[0] ? p[0].paragraphs.length : 'нет проекта в localStorage'; })()
    `));

    // Облако + запуск
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Облако'); if(b)b.click(); return 1; })()`);
    await sleep(500);
    await c.evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Запустить'); if(b)b.click(); return 1; })()`);

    for (const t of [1000, 2000, 4000, 7000]) {
      await sleep(t === 1000 ? 1000 : t - (t === 2000 ? 1000 : t === 4000 ? 2000 : 4000));
      const s = JSON.parse(await c.evaluate(`
        JSON.stringify({
          reqs: window.__reqs.length,
          disabled: (() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Запустить'); return b? b.disabled : 'no-btn'; })(),
          log: window.__log.slice(-3),
        })
      `));
      console.log(`t=${t}мс: запросов=${s.reqs}, кнопка disabled=${s.disabled}, ошибок JS=${JSON.stringify(s.log)}`);
    }

    console.log('итог статусов:', await c.evaluate(`
      (() => { const p = JSON.parse(localStorage.getItem('tph.v1.projects')||'[]');
        return p[0] ? JSON.stringify(p[0].paragraphs.map(x => x.status)) : '—'; })()
    `));
  });
  process.exit(0);
};

run().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
