/* Общие помощники для UI-проверок через CDP. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TEXT = `В целях осуществления проверки качества было проведено исследование. Выборка составила 48 статей, опубликованных с 2019 по 2023 год [12, 14]. Средний объём текста — 12 400 знаков.

Анализ показал, что в 73% случаев авторы злоупотребляют отглагольными существительными. Полученные данные согласуются с работой Иванова и Петрова (2021).

Таким образом, исследование позволяет сделать вывод о необходимости работы над стилем научных текстов.`;

export async function waitFor(c, expr, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await c.evaluate(expr)) return true;
    await sleep(200);
  }
  return false;
}

export async function resetApp(c) {
  await c.evaluate(`localStorage.clear(); 'cleared'`);
  await c.send('Page.enable');
  await c.send('Page.reload', { ignoreCache: false });
  await sleep(2500);
  await waitFor(c, `document.readyState === 'complete'`, 15000);
}

export async function chooseLocal(c) {
  const r = await c.evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b =>
        (b.getAttribute('aria-label')||'').includes('локально'));
      if (!btn) return 'NOT_FOUND';
      btn.click();
      return 'ok';
    })()
  `);
  await sleep(600);
  return r;
}

export async function clickText(c, text, exact = true) {
  return c.evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('button')].find(b => {
        const t = (b.textContent||'').trim();
        return ${exact} ? t === ${JSON.stringify(text)} : t.includes(${JSON.stringify(text)});
      });
      if (!btn) return 'NOT_FOUND';
      if (btn.disabled) return 'DISABLED';
      btn.click();
      return 'ok';
    })()
  `);
}

export async function pasteText(c, text = TEXT) {
  const open = await clickText(c, 'Вставить');
  if (open !== 'ok') return 'open:' + open;
  await sleep(400);
  const fill = await c.evaluate(`
    (() => {
      const ta = document.querySelector('textarea');
      if (!ta) return 'NO_TEXTAREA';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value.length;
    })()
  `);
  await sleep(400);
  const apply = await clickText(c, 'Загрузить текст');
  await sleep(900);
  return 'chars=' + fill + ', apply=' + apply;
}
