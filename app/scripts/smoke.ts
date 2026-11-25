/* Смоук-тест ядра: защита, токенизация, переписывание, валидация, экспорт.
   Запуск: npm run smoke */

import { tokenize, unmaskText, protectionSummary } from '../src/core/protection';
import { rewriteParagraph } from '../src/core/ruleEngine';
import { checkSense, extractSenseUnits } from '../src/core/validation';
import { splitIntoParagraphs, pagesOf, CHARS_PER_PAGE } from '../src/core/paragraphs';
import { processParagraph } from '../src/core/pipeline';
import { LocalRuleEngine } from '../src/engines/localEngine';
import { findCliches, clicheDensity } from '../src/core/cliches';
import { buildMarkdown, buildTxt } from '../src/core/exporters';
import type { Paragraph } from '../src/core/types';

let failed = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const SAMPLE = `В современном мире проблема обработки текстов является одной из наиболее актуальных. В рамках данного исследования был проведён анализ 120 публикаций за период 2015–2023 гг., что позволяет говорить о высокой степени изученности вопроса. Иванов И.И. (2019) отмечает, что данный подход является достаточно эффективным.`;

console.log('\n1. Защита и токенизация');
{
  const { masked, spans, tokenMap } = tokenize(SAMPLE, [], []);
  const back = unmaskText(masked, tokenMap).text;
  check('раунд-трип дословный', back === SAMPLE, back.slice(0, 80));
  check('числа найдены', spans.some((s) => s.cls === 'number'));
  check('имена найдены', spans.some((s) => s.cls === 'name'));
  check('маска не содержит цифр из текста', !/120|2015|2023/.test(masked), masked.slice(0, 90));
  check('токены в маске', /⟦/.test(masked));
  const sum = protectionSummary(spans);
  check('сводка не пустая', Object.values(sum).some((n) => n > 0), JSON.stringify(sum));
}

console.log('\n2. Офлайн-движок');
{
  const { masked, tokenMap } = tokenize(SAMPLE, [], []);
  const out = rewriteParagraph(masked, { preset: 'F1', intensity: 3, compressTarget: 30, seed: 'test' });
  const restored = unmaskText(out, tokenMap).text;
  check('результат не пустой', restored.length > 40);
  check('факты сохранены', /120/.test(restored) && /2015/.test(restored) && /Иванов/.test(restored), restored);
  check('токены не остались', !/⟦/.test(restored));
  const shorter = rewriteParagraph(masked, { preset: 'F2', intensity: 4, compressTarget: 30, seed: 'test2' });
  check('F2 не длиннее исходника', shorter.length <= masked.length * 1.05);
}

console.log('\n3. Клише');
{
  const text = 'В современном мире следует отметить, что в рамках данного исследования, как известно, играет важную роль.';
  const found = findCliches(text);
  check('клише найдены', found.length > 0, JSON.stringify(found.map((f) => f.text)));
  check('плотность > 0', clicheDensity(text) > 0);
}

console.log('\n4. Валидация смысла');
{
  const units = extractSenseUnits(SAMPLE);
  check('единицы смысла извлечены', units.numbers.length > 0 && units.names.length > 0, JSON.stringify(units));
  check('год 2015 не обрезан', units.numbers.includes('2015-2023') || units.numbers.includes('2015'), JSON.stringify(units.numbers));
  const same = checkSense(SAMPLE, SAMPLE);
  check('идентичный текст → ok/warn без потерь', same.level !== 'bad' && same.kept === same.found, `${same.level} ${same.kept}/${same.found}`);
  const lossy = checkSense(SAMPLE, 'Обработка текстов важна. Анализ публикаций показал эффективность подхода.');
  check('потеря фактов замечена', lossy.level !== 'ok' || lossy.issues.length > 0, lossy.level);
}

console.log('\n5. Абзацы и страницы');
{
  const paras = splitIntoParagraphs(`Заголовок\n\nПервый абзац текста.\n\n- пункт один\n- пункт два`);
  check('разбито на 4 блока', paras.length === 4, String(paras.length));
  check('заголовок распознан', paras[0].blockKind === 'heading', paras[0].blockKind);
  check('список распознан', paras.filter((p) => p.blockKind === 'list-item').length === 2);
  check('страница = 1800 знаков', CHARS_PER_PAGE === 1800 && pagesOf(1800) === 1 && pagesOf(1801) === 2);
}

console.log('\n6. Конвейер');
{
  const p: Paragraph = {
    id: 'p1',
    original: SAMPLE,
    current: SAMPLE,
    status: 'original',
    blockKind: 'paragraph',
    protectedSpans: [],
    variants: [],
    sense: null,
  };
  const res = await processParagraph(p, {
    preset: 'F1',
    intensity: 3,
    compressTarget: 30,
    engine: new LocalRuleEngine(),
    dictionary: [],
  });
  check('статус присвоен', res.paragraph.status !== 'original', res.paragraph.status);
  check('варианты есть', res.paragraph.variants.length >= 1, String(res.paragraph.variants.length));
  check('факты на месте', /120/.test(res.paragraph.current) && /Иванов/.test(res.paragraph.current));
  check('проверка смысла приложена', res.sense.found > 0);
}

console.log('\n7. Регрессии движка (probe)');
{
  const { masked, tokenMap } = tokenize(SAMPLE, [], []);
  const restores = (preset: 'F1' | 'F2' | 'F3' | 'F4', intensity: 1 | 2 | 3 | 4 | 5) =>
    unmaskText(
      rewriteParagraph(masked, { preset, intensity, compressTarget: 30, seed: 's' }),
      tokenMap,
    ).text;

  const lvl1 = restores('F1', 1);
  check('уровень 1 снимает канцелярит', !/в рамках/i.test(lvl1) && !/в современном мире/i.test(lvl1), lvl1.slice(0, 90));
  check('канцелярит не ломает падеж', !/в данного/i.test(lvl1), lvl1.slice(0, 120));

  for (const preset of ['F1', 'F2', 'F3', 'F4'] as const) {
    for (const intensity of [1, 2, 3, 4, 5] as const) {
      const out = restores(preset, intensity);
      const clean = out.replace(/[А-ЯЁ]\.\s?[А-ЯЁ]\./g, 'X').replace(/гг\./g, 'г');
      const label = `${preset}/ур.${intensity}`;
      check(`${label}: факты на месте`, /120/.test(out) && /2015/.test(out) && /Иванов/.test(out), out.slice(0, 80));
      check(`${label}: нет двойных знаков`, !/[.,;:]{2}/.test(clean), clean.slice(0, 80));
      check(`${label}: нет запятой перед точкой`, !/[,;:]\s*\./.test(clean), clean.slice(0, 80));
      check(`${label}: нет знака в начале`, !/^\s*[,;:]/.test(out), out.slice(0, 40));
      check(`${label}: связка не перед придаточным`, !/(?:^|\. )(?:Поэтому|Итоге|Результате),?\s+(?:что|чтобы|котор)/i.test(out), out.slice(0, 90));
    }
  }
}

console.log('\n8. Стоп-лист имён');
{
  const text = 'Следует отметить, что подход эффективен.';
  check('«Следует» не считается именем', extractSenseUnits(text).names.length === 0, JSON.stringify(extractSenseUnits(text).names));
  const rewritten = 'Отметим, что подход эффективен.';
  const sense = checkSense(text, rewritten);
  check('правка зачина не даёт ложной потери', sense.level !== 'bad', `${sense.level} ${JSON.stringify(sense.issues)}`);
}

console.log('\n9. Экспорт');{
  const paras: Paragraph[] = [
    {
      id: 'h',
      original: 'Введение',
      current: 'Введение',
      status: 'accepted',
      blockKind: 'heading',
      protectedSpans: [],
      variants: [],
      sense: null,
    },
    {
      id: 'p',
      original: SAMPLE,
      current: SAMPLE,
      status: 'accepted',
      blockKind: 'paragraph',
      protectedSpans: [],
      variants: [],
      sense: null,
    },
  ];
  const md = buildMarkdown(paras);
  check('markdown: заголовок через #', md.includes('# Введение'), md.slice(0, 60));
  check('markdown: текст на месте', md.includes('120 публикаций'));
  const txt = buildTxt(paras);
  check('txt без служебных меток', !/⟦|🔴|accepted/.test(txt));
}

console.log(`\n${failed === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО: ${failed}`}\n`);
if (failed > 0) process.exit(1);
