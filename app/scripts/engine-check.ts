/* ============================================================================
   engine-check.ts — проверка выбора движка и локальной GGUF-настройки.

   Запуск: npm run engine-check
   Проверяет, что фабрика createEngine отдаёт нужный движок для всех
   комбинаций настроек, и что локальная модель не подменяется молча.
   ========================================================================== */

import { createEngine, isCloudReady } from '../src/engines';
import { GgufEngine, LocalRuleEngine } from '../src/engines';
import { FILE_SOURCE_ID } from '../src/engines/localModel';
import type { AppSettings, RunSettings } from '../src/core/types';

let ok = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    ok++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const base: AppSettings = {
  engine: 'local',
  cloudModel: 'gpt-4o-mini',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  cloudProvider: 'gigachat',
  gigachatProxyUrl: '/api/gigachat',
  localEngine: 'rules',
  localModelUrl: '',
  localModelPath: '',
  cloudAllowed: false,
  cloudConsentGiven: false,
  docFontSize: 17,
  weeklyLimitPages: 100,
  pagesThisWeek: 0,
  weekAnchor: '2026-11-24',
};

const localRun: RunSettings = { preset: 'F1', intensity: 3, compressTarget: 'auto', engine: 'local', model: 'rules' };
const cloudRun: RunSettings = { preset: 'F1', intensity: 3, compressTarget: 'auto', engine: 'cloud', model: 'gpt-4o-mini' };

console.log('1. Облако не разрешено');
check('облако выключено → не готово', !isCloudReady(base));
check('локальный запуск → правила', createEngine(base, localRun) instanceof LocalRuleEngine);
check(
  'облачный запуск без согласия → правила',
  createEngine(base, cloudRun) instanceof LocalRuleEngine,
);

console.log('2. Локальная GGUF-модель');
const gguf: AppSettings = { ...base, localEngine: 'gguf', localModelUrl: 'https://example.com/m.gguf' };
const ggufEngine = createEngine(gguf, localRun);
check('GGUF выбран и адрес задан → GgufEngine', ggufEngine instanceof GgufEngine);
check('подпись движка человеческая', ggufEngine.label === 'Локальная модель');
check('вид движка — local', ggufEngine.kind === 'local');

const ggufNoUrl: AppSettings = { ...base, localEngine: 'gguf', localModelUrl: '   ' };
check(
  'GGUF выбран, адрес пустой → правила (без падения)',
  createEngine(ggufNoUrl, localRun) instanceof LocalRuleEngine,
);

const ggufFile: AppSettings = { ...base, localEngine: 'gguf', localModelUrl: FILE_SOURCE_ID };
check('модель из файла → GgufEngine', createEngine(ggufFile, localRun) instanceof GgufEngine);

console.log('3. Приоритет локального режима');
check(
  'локальный запуск при настроенном облаке → всё равно локально',
  createEngine(
    { ...base, cloudAllowed: true, apiKey: 'sk-test' },
    localRun,
  ) instanceof LocalRuleEngine,
);
check(
  'облако без ключа GigaChat-прокси → не готово',
  !isCloudReady({ ...base, cloudAllowed: true, cloudProvider: 'gigachat', gigachatProxyUrl: '' }),
);
check(
  'облако с прокси GigaChat → готово',
  isCloudReady({ ...base, cloudAllowed: true, cloudProvider: 'gigachat', gigachatProxyUrl: '/api/gigachat' }),
);

console.log('');
if (failed === 0) {
  console.log(`ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (${ok})`);
  process.exit(0);
}
console.log(`ПРОВАЛЕНО ${failed} из ${ok + failed}`);
process.exit(1);
