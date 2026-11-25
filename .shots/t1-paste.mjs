/* Пункт 1: вставка учебного текста — текст остаётся доступным до результата */
import { withPage } from './cdp.mjs';

const TEXT = `В целях осуществления проверки качества было проведено исследование. Выборка составила 48 статей, опубликованных с 2019 по 2023 год [12, 14]. Средний объём текста — 12 400 знаков.

Анализ показал, что в 73% случаев авторы злоупотребляют отглагольными существительными. Полученные данные согласуются с работой Иванова и Петрова (2021).

Таким образом, исследование позволяет сделать вывод о необходимости работы над стилем научных текстов.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  await withPage(async (c) => {
    const clickByText = (text, exact = true) => `
      (() => {
        const btn = [...document.querySelectorAll('button')].find(b => {
          const t = (b.textContent||'').trim();
          return ${exact} ? t === ${JSON.stringify(text)} : t.includes(${JSON.stringify(text)});
        });
        if (!btn) return 'NOT_FOUND';
        btn.click();
        return 'ok';
      })()
    `;

    console.log('A) клик «Вставить» в ленте:', await c.evaluate(clickByText('Вставить')));
    await sleep(400);

    console.log('B) textarea в модалке:', await c.evaluate(`
      (() => {
        const ta = document.querySelector('textarea');
        if (!ta) return 'NOT_FOUND';
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(TEXT)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'вставлено символов: ' + ta.value.length;
      })()
    `));
    await sleep(400);

    console.log('C) мета модалки:', await c.evaluate(`
      document.querySelector('.paste-meta')?.textContent?.trim() || '—'
    `));

    console.log('D) клик «Загрузить текст»:', await c.evaluate(clickByText('Загрузить текст')));
    await sleep(900);

    const state = await c.evaluate(`
      (() => {
        const body = document.body.innerText;
        const statusEl = [...document.querySelectorAll('*')]
          .filter(e => e.children.length === 0 && /знаков/.test(e.textContent||''))
          .map(e => e.textContent.trim());
        return JSON.stringify({
          dialogs: document.querySelectorAll('[role=dialog]').length,
          status: statusEl[0] || '—',
          hasText48: body.includes('48'),
          hasText2021: body.includes('2021'),
          hasParagraphs: /абзац/i.test(body),
          textareaInModal: !!document.querySelector('textarea'),
        }, null, 1);
      })()
    `);
    console.log('E) состояние после вставки:\n' + state);
  });
  process.exit(0);
};

run().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
