/* Диагностика движка: корпус текстов × пресеты F1–F4 × уровни 1–5,
   с проверкой сохранности смысла и типографики.
   Запуск: npm run probe
   Код возврата 1, если найдены проблемы. */

import { tokenize, unmaskText } from '../src/core/protection';
import { rewriteParagraph } from '../src/core/ruleEngine';
import { checkSense } from '../src/core/validation';
import { splitIntoParagraphs, stripListMarker } from '../src/core/paragraphs';

interface CorpusCase {
  name: string;
  text: string;
  /** Списки в F3 обязаны разворачиваться в прозу — это не дефект. */
  listsMayFlatten?: boolean;
}

const CORPUS: CorpusCase[] = [
  {
    name: 'научный абзац с числами и инициалами',
    text:
      'В современном мире проблема обработки текстов является одной из наиболее актуальных. В рамках данного исследования был проведён анализ 120 публикаций за период 2015–2023 гг., что позволяет говорить о высокой степени изученности вопроса. Иванов И.И. (2019) отмечает, что данный подход является достаточно эффективным.',
  },
  {
    name: 'отрицания и кванторы',
    text:
      'Не все испытуемые показали прирост результата. Большинство участников не отметили побочных эффектов, однако часть группы прекратила занятия досрочно. Ни один показатель не ухудшился статистически значимо.',
  },
  {
    name: 'единицы измерения и проценты',
    text:
      'Средняя частота сердечных сокращений составила 148 уд/мин при нагрузке 4,5 кг и температуре 36,6 °C. Концентрация лактата выросла до 8,2 ммоль/л, что на 32 % выше исходного уровня. Объём выборки — 45 человек, возраст 18–25 лет.',
  },
  {
    name: 'аббревиатуры, латиница и ссылки',
    text:
      'Согласно ГОСТ 7.0.5-2008 и методике ВОЗ, показатель VO2max оценивали в МГУ и СПбГУ [12; 15]. Ранее Smith и Jones (2020) описали сходную процедуру на выборке 240 респондентов (Иванов и др., 2019).',
  },
  {
    name: 'длинный абзац с перечислением',
    text:
      'Программа тренировок включала четыре блока, и каждый блок решал свою задачу: первый развивал общую выносливость, второй отвечал за силовые качества, третий формировал координацию, а четвёртый закреплял технику движений. Тренер корректировал нагрузку по самочувствию спортсмена, поэтому интенсивность менялась от занятия к занятию, и это позволяло избегать переутомления.',
  },
  {
    name: 'список из трёх пунктов',
    text: '- Первый пункт описывает подготовительный этап работы.\n- Второй пункт касается основной части исследования.\n- Третий пункт фиксирует выводы и ограничения.',
    listsMayFlatten: true,
  },
  {
    name: 'заголовок и абзац',
    text: '## Методы исследования\n\nВ работе применялись методы анализа научной литературы и педагогического наблюдения.',
  },
  {
    name: 'короткие рубленые фразы',
    text: 'Цель ясна. Задачи определены. Выборка мала. Выводы осторожны. Работа продолжается.',
  },
];

const PRESETS = ['F1', 'F2', 'F3', 'F4'] as const;
const LEVELS = [1, 2, 3, 4, 5] as const;

interface Finding {
  corpus: string;
  preset: string;
  level: number;
  flags: string[];
  output: string;
}

/** Проверить типографику результата, не считая легальных сокращений. */
function typographyFlags(text: string): string[] {
  const flags: string[] = [];
  // Инициалы (И.И., И. И.), сокращения (гг., т.е., др.) и ГОСТ-номера — легальны.
  const noAbbrev = text
    .replace(/(?<![А-ЯЁа-яё])[А-ЯЁ]\.\s?[А-ЯЁ]\./g, 'X')
    .replace(/(?<![А-ЯЁа-яё])(?:гг|т\.\s?е|и\s+др|и\s+пр|см|рис|табл|с|стр|в|вв|н\.\s?э)\./g, 'X')
    .replace(/\d+\.\d+/g, 'N');
  if (/[.,;:]{2}/.test(noAbbrev)) flags.push('ДВОЙНОЙ ЗНАК');
  if (/[,;:]\s*\./.test(noAbbrev)) flags.push('ЗАПЯТАЯ ПЕРЕД ТОЧКОЙ');
  if (/^\s*[,;:]/.test(text)) flags.push('ЗНАК В НАЧАЛЕ');
  if (/[ \t]{2,}/.test(text)) flags.push('ДВОЙНОЙ ПРОБЕЛ');
  if (/\s+[.,;:!?]/.test(text)) flags.push('ПРОБЕЛ ПЕРЕД ЗНАКОМ');
  if (/[(\[]\s+|\s+[)\]]/.test(text)) flags.push('ПРОБЕЛ В СКОБКАХ');
  return flags;
}

const findings: Finding[] = [];
let variants = 0;

for (const corpusCase of CORPUS) {
  const paragraphs = splitIntoParagraphs(corpusCase.text);
  for (const p of paragraphs) {
    // Движок получает содержимое блока без маркера списка (как в конвейере).
    const source = p.blockKind === 'list-item' ? stripListMarker(p.original) : p.original;
    if (!source.trim()) continue;

    const { masked, tokenMap } = tokenize(source, [], []);
    const roundTrip = unmaskText(masked, tokenMap).text;
    if (roundTrip !== source) {
      findings.push({
        corpus: corpusCase.name,
        preset: '—',
        level: 0,
        flags: ['РАУНД-ТРИП НЕ ДОСЛОВНЫЙ'],
        output: roundTrip,
      });
    }

    for (const preset of PRESETS) {
      for (const level of LEVELS) {
        variants += 1;
        const out = rewriteParagraph(masked, { preset, intensity: level, compressTarget: 30, seed: 'probe' });
        const restored = unmaskText(out, tokenMap).text;
        const sense = checkSense(source, restored);
        const flags = typographyFlags(restored);

        if (restored.trim() === source.trim() && preset !== 'F1') flags.push('БЕЗ ИЗМЕНЕНИЙ');
        if (sense.level === 'bad') flags.push(`СМЫСЛ:${sense.issues.map((i) => i.kind).join('/')}`);
        if (sense.level === 'warn') flags.push('СМЫСЛ:warn');
        // Потеря чисел/имён/ссылок недопустима ни при каком пресете.
        const lost = sense.issues.filter((i) => i.kind === 'lost-number' || i.kind === 'lost-name' || i.kind === 'lost-ref');
        if (lost.length > 0) flags.push(`ПОТЕРЯ ФАКТОВ:${lost.length}`);
        // Новый список появляется только если его не было.
        if (sense.issues.some((i) => i.kind === 'new-list') && !corpusCase.listsMayFlatten) {
          flags.push('НОВЫЙ СПИСОК');
        }
        // Пустой результат — всегда дефект.
        if (!restored.trim()) flags.push('ПУСТОЙ РЕЗУЛЬТАТ');

        if (flags.length > 0) {
          findings.push({ corpus: corpusCase.name, preset, level, flags, output: restored });
        }
      }
    }
  }
}

console.log(`Корпус: ${CORPUS.length} текстов, вариантов проверено: ${variants}\n`);

for (const f of findings) {
  console.log(`[${f.corpus}] ${f.preset} / ур.${f.level} — ${f.flags.join(' | ')}`);
  console.log(`  ${f.output.replace(/\n/g, '\n  ')}\n`);
}

const hard = findings.filter((f) =>
  f.flags.some(
    (fl) =>
      fl.startsWith('ПОТЕРЯ ФАКТОВ') ||
      fl.startsWith('СМЫСЛ:bad') ||
      fl === 'ПУСТОЙ РЕЗУЛЬТАТ' ||
      fl === 'РАУНД-ТРИП НЕ ДОСЛОВНЫЙ',
  ),
);
const soft = findings.length - hard.length;

console.log(`ИТОГО вариантов с замечаниями: ${findings.length} (жёстких: ${hard.length}, мягких: ${soft})`);

if (hard.length > 0) {
  console.error('\nЖЁСТКИЕ ДЕФЕКТЫ — исправить обязательно.');
  process.exit(1);
}
