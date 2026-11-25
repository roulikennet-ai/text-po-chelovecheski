/* ============================================================================
   LocalModelCard.tsx — E10, карточка «Локальная модель» (GGUF через wllama).
   Скачивание по адресу, загрузка файла с диска, прогресс, выгрузка, кэш.
   ========================================================================== */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  FileUp,
  HardDrive,
  Info,
  Loader2,
  Power,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useStore } from '../state/AppStore';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Chip } from '../components/ui/Chip';
import {
  FILE_SOURCE_ID,
  LOCAL_MODEL_PRESETS,
  clearModelCache,
  estimateLocalStorageMb,
  getModelState,
  loadLocalModel,
  loadLocalModelFromFile,
  subscribeModelState,
  unloadLocalModel,
} from '../engines/localModel';
import { isAbortError } from '../engines/engine';

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

export function LocalModelCard() {
  const { settings, patchSettings, pushToast, logEvent } = useStore();
  const [model, setModel] = useState(getModelState);
  const [draftUrl, setDraftUrl] = useState(
    settings.localModelUrl === FILE_SOURCE_ID ? '' : settings.localModelUrl,
  );
  const [cache, setCache] = useState<{ mb: number; exact: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isGguf = settings.localEngine === 'gguf';
  const ready = model.status === 'ready';
  const loading = model.status === 'loading';

  useEffect(() => subscribeModelState(setModel), []);

  useEffect(() => {
    let alive = true;
    estimateLocalStorageMb().then((v) => {
      if (alive) setCache(v);
    });
    return () => {
      alive = false;
    };
  }, [model.status]);

  const rememberUrl = (url: string) => {
    setDraftUrl(url);
    patchSettings({ localEngine: 'gguf', localModelUrl: url });
  };

  const download = async () => {
    const url = draftUrl.trim();
    if (!url) {
      pushToast({ kind: 'warn', message: 'Укажите адрес GGUF-файла или выберите модель из списка.' });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      pushToast({ kind: 'warn', message: 'Адрес модели должен начинаться с http:// или https://' });
      return;
    }
    rememberUrl(url);
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await loadLocalModel(url, { signal: controller.signal });
      logEvent({ event: 'settings', object: 'локальная модель', engine: 'local', param: 'скачана', result: 'ок' });
      pushToast({ kind: 'ok', message: 'Локальная модель загружена. Обработка идёт без интернета.' });
    } catch (e) {
      if (isAbortError(e)) {
        pushToast({ kind: 'warn', message: 'Загрузка модели отменена.' });
      } else {
        logEvent({ event: 'error', object: 'локальная модель', engine: 'local', param: 'загрузка', result: 'ошибка' });
        pushToast({ kind: 'bad', message: (e as Error).message });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.gguf')) {
      pushToast({ kind: 'warn', message: 'Нужен файл с расширением .gguf' });
      return;
    }
    patchSettings({ localEngine: 'gguf', localModelUrl: FILE_SOURCE_ID });
    setDraftUrl('');
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    try {
      await loadLocalModelFromFile(file, { signal: controller.signal });
      logEvent({ event: 'settings', object: 'локальная модель', engine: 'local', param: `файл ${file.name}`, result: 'ок' });
      pushToast({ kind: 'ok', message: `Модель «${file.name}» загружена.` });
    } catch (e) {
      if (isAbortError(e)) {
        pushToast({ kind: 'warn', message: 'Загрузка модели отменена.' });
      } else {
        logEvent({ event: 'error', object: 'локальная модель', engine: 'local', param: 'файл', result: 'ошибка' });
        pushToast({ kind: 'bad', message: (e as Error).message });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const unload = async () => {
    await unloadLocalModel();
    logEvent({ event: 'settings', object: 'локальная модель', engine: 'local', param: 'выгружена', result: 'ок' });
    pushToast({ kind: 'ok', message: 'Модель выгружена, память освобождена.' });
  };

  const wipeCache = async () => {
    await clearModelCache();
    setCache(await estimateLocalStorageMb());
    logEvent({ event: 'settings', object: 'локальная модель', engine: 'local', param: 'кэш очищен', result: 'ок' });
    pushToast({ kind: 'ok', message: 'Кэш моделей очищен.' });
  };

  const statusChip = () => {
    if (model.status === 'ready') return <Chip kind="ok" icon={<CheckCircle2 size={12} />}>загружена</Chip>;
    if (model.status === 'loading') return <Chip kind="accent" icon={<Loader2 size={12} />}>загрузка</Chip>;
    if (model.status === 'error') return <Chip kind="bad" icon={<XCircle size={12} />}>ошибка</Chip>;
    return <Chip kind="neutral">не загружена</Chip>;
  };

  const preset = LOCAL_MODEL_PRESETS.find((p) => p.url === settings.localModelUrl);

  return (
    <section className="set-card set-card--wide">
      <div className="set-card__head">
        <Cpu size={18} />
        <h2 className="set-card__title">Локальная модель</h2>
        {statusChip()}
      </div>
      <p className="set-card__desc">
        Скачайте GGUF-модель один раз — дальше она работает офлайн, прямо в приложении. Текст не покидает компьютер.
        Нужно не меньше 4 ГБ свободной памяти.
      </p>

      <div className="engine-switch engine-switch--wide" role="radiogroup" aria-label="Локальный движок">
        <button
          role="radio"
          aria-checked={!isGguf}
          className={`engine-opt${!isGguf ? ' engine-opt--active' : ''}`}
          onClick={() => patchSettings({ localEngine: 'rules' })}
        >
          Встроенные правила
        </button>
        <button
          role="radio"
          aria-checked={isGguf}
          className={`engine-opt${isGguf ? ' engine-opt--active' : ''}`}
          onClick={() => patchSettings({ localEngine: 'gguf' })}
        >
          GGUF-модель
        </button>
      </div>

      {!isGguf ? (
        <p className="set-hint">
          <AlertTriangle size={14} />
          <span>
            Сейчас работает офлайн-движок на правилах: без скачивания и без модели. Он быстрее, но переписывает проще.
          </span>
        </p>
      ) : (
        <>
          <div className="set-presets">
            {LOCAL_MODEL_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`set-preset${settings.localModelUrl === p.url ? ' set-preset--active' : ''}`}
                onClick={() => rememberUrl(p.url)}
                disabled={busy}
              >
                <span className="set-preset__name">{p.name}</span>
                <span className="set-preset__meta">
                  ≈{p.sizeMb} МБ · {p.note}
                </span>
              </button>
            ))}
          </div>

          <Field
            label="Адрес GGUF-файла"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="https://…/model-Q4_K_M.gguf"
            hint="Прямая ссылка на файл .gguf. Можно вставить свою, например с huggingface.co"
            disabled={busy}
          />

          <p className="set-hint">
            <Info size={14} />
            <span>
              Если скачивание обрывается на большом файле, скачайте .gguf в браузере вручную и нажмите
              «Файл с диска» — модель возьмётся прямо с диска, без сети.
            </span>
          </p>

          {loading && (
            <div className="set-progress">
              <div className="set-progress__bar">
                <span
                  className="set-progress__fill"
                  style={{ width: `${model.progress?.percent && model.progress.percent >= 0 ? model.progress.percent : 5}%` }}
                />
              </div>
              <span className="set-progress__text">
                {model.progress && model.progress.percent >= 0
                  ? `${model.progress.percent}% · ${mb(model.progress.loaded)} из ${mb(model.progress.total)} МБ`
                  : model.message || 'Подготовка…'}
              </span>
            </div>
          )}

          {model.status === 'ready' && (
            <div className="set-check set-check--ok">
              <CheckCircle2 size={16} />
              <div>
                <strong>Модель в памяти.</strong>{' '}
                {model.url === FILE_SOURCE_ID
                  ? `Файл «${model.message ?? 'GGUF'}». После перезагрузки страницы файл нужно выбрать снова.`
                  : preset
                    ? preset.name
                    : 'Скачана по указанному адресу и сохранена в кэше браузера.'}
              </div>
            </div>
          )}

          {model.status === 'error' && (
            <div className="set-check set-check--bad">
              <XCircle size={16} />
              <div>{model.message || 'Не удалось загрузить модель.'}</div>
            </div>
          )}

          <div className="set-actions set-actions--start">
            <Button
              variant="primary"
              size="sm"
              icon={busy ? <Loader2 size={14} /> : <Download size={14} />}
              onClick={download}
              disabled={busy || !draftUrl.trim()}
            >
              {busy ? 'Загружаю…' : 'Скачать и загрузить'}
            </Button>
            <Button variant="secondary" size="sm" icon={<FileUp size={14} />} onClick={pickFile} disabled={busy}>
              Файл с диска
            </Button>
            {busy && (
              <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
                Отменить
              </Button>
            )}
            {ready && !busy && (
              <Button variant="secondary" size="sm" icon={<Power size={14} />} onClick={unload}>
                Выгрузить
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".gguf,application/octet-stream"
              className="set-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>

          <p className="set-hint">
            <HardDrive size={14} />
            <span>
              Кэш моделей:{' '}
              {cache === null
                ? 'не удалось определить'
                : cache.exact
                  ? cache.mb === 0
                    ? 'пусто'
                    : `≈${cache.mb} МБ`
                  : `не загружалась, всего в приложении ≈${cache.mb} МБ`}
              .{' '}
              <button type="button" className="set-link" onClick={() => void wipeCache()}>
                <Trash2 size={12} /> Очистить кэш
              </button>
            </span>
          </p>
        </>
      )}
    </section>
  );
}
