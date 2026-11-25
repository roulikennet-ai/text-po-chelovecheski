/* Чек-лист: 1) вставка текста, 4) пустое поле, 7) повторный клик */
import { withPage } from './cdp.mjs';

const TEXT = `В целях осуществления проверки качества было проведено исследование. Выборка — 48 статей. Средний объём — 12 400 знаков.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const results = [];
  const add = (label, ok, detail) => {
    results.push({ label, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${label}: ${detail}`);
  };

  await withPage(async (c) => {
    // ===== ПУНКТ 1: Вставка текста =====
    // 1а. Нажать "Вставить" в ленте
    await c.evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent||'').trim() === 'Вставить'
        );
        if (btn) { btn.click(); return 'ok'; }
        return 'not found';
      })()
    `);
    await sleep(400);

    // 1б. Вставить текст в textarea модалки
    await c.evaluate(`
      (() => {
        const ta = document.querySelector('textarea.paste-area, textarea');
        if (!ta) return 'textarea not found';
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(TEXT)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'chars=' + ta.value.length + ' meta=' + (document.querySelector('.paste-meta')?.textContent?.trim() || '—');
      })()
    `);
    await sleep(400);

    // 1в. Нажать "Применить текст"
    const applied = await c.evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent||'').trim() === 'Применить текст' && !b.disabled
        );
        if (!btn) return 'not found';
        btn.click();
        return 'ok';
      })()
    `);
    await sleep(800);

    // 1г. Проверить: текст в редакторе, счётчик знаков
    const check1 = await c.evaluate(`
      (() => {
        const status = [...document.querySelectorAll('.status-bar, [class*=status]')]
          .map(e => e.textContent.trim()).find(t => /знаков/.test(t));
        const bodyText = document.body.innerText;
        const hasNumber = /48/.test(bodyText);
        return JSON.stringify({
          statusLine: status || '—',
          hasNumber: hasNumber,
          dialogs: document.querySelectorAll('[role=dialog]').length,
          paragraphs: /абзац/i.test(bodyText) ? 'да' : 'нет',
        });
      })()
    `);
    const p1 = JSON.parse(check1);
    add('1. Вставка текста', p1.hasNumber && p1.dialogs === 0,
      `статус: ${p1.statusLine}, число 48: ${p1.hasNumber}, модалка закрыта: ${p1.dialogs === 0}`);

    // ===== ПУНКТ 4: Пустое поле =====
    // Создать новый проект (очистить)
    const newProj = await c.evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => /новый/i.test(b.textContent)
        );
        if (!btn) return 'not found';
        btn.click();
        return 'ok';
      })()
    `);
    await sleep(500);

    // 4а. Нажать "Запустить" на пустом проекте
    const runEmpty = await c.evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent||'').trim() === 'Запустить' && !b.disabled
        );
        if (!btn) return 'not found';
        btn.click();
        return 'ok';
      })()
    `);
    await sleep(600);

    // 4б. Проверить: toast с подсказкой
    const toast = await c.evaluate(`
      (() => {
        const toasts = [...document.querySelectorAll('.toast, [class*=toast], [class*=notification]')]
          .map(e => e.textContent.trim());
        return JSON.stringify({ toasts, hasEmpty: toasts.some(t => /пуст|нет|не|законч|внимание/i.test(t)) });
      })()
    `);
    const t = JSON.parse(toast);
    add('4. Пустое поле', t.hasEmpty,
      `тоasts: ${JSON.stringify(t.toasts)}`);

    // ===== ПУНКТ 7: Повторный клик =====
    // 7а. Проверить, что кнопка "Запустить" имеет disabled при running
    // Сначала запустим обработку (локальные правила — мгновенно)
    const pasteAgain = await c.evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent||'').trim() === 'Вставить'
        );
        if (!btn) return 'not found';
        btn.click();
        return 'ok';
      })()
    `);
    await sleep(400);
    await c.evaluate(`
      (() => {
        const ta = document.querySelector('textarea.paste-area, textarea');
        if (!ta) return 'no textarea';
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, ${JSON.stringify(TEXT)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent||'').trim() === 'Применить текст'
        );
        if (btn) btn.click();
        return 'applied';
      })()
    `);
    await sleep(800);

    // 7б. Кликнуть "Запустить" дважды подряд быстро
    const doubleClick = await c.evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(
          b => (b.textContent||'').trim() === 'Запустить' && !b.disabled
        );
        if (!btn) return 'no button';
        const before = btn.disabled;
        btn.click();
        const afterFirst = btn.disabled;
        btn.click();
        const afterSecond = btn.disabled;
        return JSON.stringify({ before, afterFirst, afterSecond });
      })()
    `);
    await sleep(1500);

    const dc = JSON.parse(doubleClick);
    add('7. Повторный клик', dc.afterFirst === true || dc.afterSecond === true,
      `disabled: ${JSON.stringify(dc)}`);
  });

  // Итоговая таблица
  console.log('\n=== ИТОГО ===');
  results.forEach(r => console.log(`${r.ok ? '✅' : '❌'} ${r.label} — ${r.detail}`));
  process.exit(0);
};

run().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
