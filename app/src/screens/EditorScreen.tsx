/* ============================================================================
   EditorScreen.tsx — E1: лента + панель + документ + статус-бар (design.md §4.2).
   Здесь живёт вся логика пакетной и точечной обработки.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardPaste,
  FileUp,
  FilePlus2,
  Shield,
  Sparkles,
  AlertTriangle,
  X,
  ArrowRight,
} from 'lucide-react';
import { useStore } from '../state/AppStore';
import { Ribbon } from '../components/editor/Ribbon';
import { SettingsPanel } from '../components/editor/SettingsPanel';
import { StatusBar } from '../components/editor/StatusBar';
import { DocumentView } from '../components/editor/DocumentView';
import { CompareView } from '../components/editor/CompareView';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Chip, StatusChip } from '../components/ui/Chip';
import { Modal } from '../components/ui/Modal';
import { Field } from '../components/ui/Field';
import { uid, pagesOf, splitIntoParagraphs } from '../core/paragraphs';
import { tokenize, protectionSummary, PROTECTION_LABELS } from '../core/protection';
import { processParagraph, processSpot } from '../core/pipeline';
import { runBatch as executeBatch } from '../core/batch';
import { createEngine, isCloudReady } from '../engines';
import { isAbortError } from '../engines/engine';
import { isSupportedFile, importDocx, readFileText } from '../core/docxImport';
import { loadSessionConsent } from '../state/storage';
import type { Paragraph, Project, Variant } from '../core/types';
import './EditorScreen.css';

export function EditorScreen() {
  const store = useStore();
  const {
    project,
    setProject,
    updateProject,
    settings,
    runSettings,
    setRunSettings,
    ui,
    setUi,
    batch,
    setBatch,
    pushToast,
    logEvent,
    createSnapshot,
    dictionary,
    patchParagraph,
    patchSettings,
    closeProject,
    flushProject,
  } = store;

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [spot, setSpot] = useState<{ paragraphId: string; start: number; end: number; text: string } | null>(null);
  const [spotVariants, setSpotVariants] = useState<Variant[]>([]);
  const [spotLoading, setSpotLoading] = useState(false);
  const [spotElapsed, setSpotElapsed] = useState(0);
  const [spotTimeout, setSpotTimeout] = useState(false);
  const [level5Confirm, setLevel5Confirm] = useState<{ next: 5 } | null>(null);
  const [searchResults, setSearchResults] = useState(0);
  const [isNarrow, setIsNarrow] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  /** Отмена текущего абзаца (пауза) — отдельно от полного стопа. */
  const stepAbortRef = useRef<AbortController | null>(null);
  const spotAbortRef = useRef<AbortController | null>(null);
  const pauseRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const spotTimerRef = useRef<number | null>(null);
  /** id проекта, к которому относится текущий пакет. */
  const runProjectIdRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(project?.id ?? null);
  projectIdRef.current = project?.id ?? null;

  /* ----------------------------- Движок ----------------------------- */

  const engine = useMemo(
    () => createEngine(settings, runSettings),
    [settings, runSettings],
  );

  /* ------------------------------ Пауза/стоп ------------------------------ */

  /** Пауза: останавливаем текущий абзац и не начинаем новые. */
  const togglePause = useCallback(() => {
    const next = !pauseRef.current;
    pauseRef.current = next;
    if (next) stepAbortRef.current?.abort();
    setBatch({ paused: next });
  }, [setBatch]);

  /** Стоп: отменяем пакет целиком, включая текущий абзац. */
  const stopBatch = useCallback(() => {
    pauseRef.current = false;
    stepAbortRef.current?.abort();
    abortRef.current?.abort();
    setBatch({ paused: false });
  }, [setBatch]);

  /* --------------------------- Создание проекта --------------------------- */

  const buildProject = useCallback(
    (paras: Paragraph[], title: string, sourceFileName?: string, sourceDocxBase64?: string): Project => {
      // Автозащита при импорте (S4).
      const withProtection = paras.map((p) => {
        const { spans } = tokenize(p.original, [], dictionary);
        return { ...p, protectedSpans: spans };
      });
      return {
        id: uid('proj'),
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        paragraphs: withProtection,
        versions: [],
        settings: runSettings,
        sourceFileName,
        sourceDocxBase64,
      };
    },
    [dictionary, runSettings],
  );

  const applyPaste = useCallback(() => {
    const text = pasteText.trim();
    if (!text) return;
    const paras = splitIntoParagraphs(text);
    if (paras.length === 0) {
      pushToast({ kind: 'warn', message: 'Не удалось найти абзацы в тексте.' });
      return;
    }
    // Новый текст заменяет проект: останавливаем обработку, чтобы результат
    // не применился к абзацам уже закрытого проекта.
    stopBatch();
    const title = paras[0]?.original.slice(0, 60) || 'Новый проект';
    const p = buildProject(paras, title);
    setProject(p);
    setPasteOpen(false);
    setPasteText('');
    setUi({ viewMode: 'edit', focusedParagraphId: null });
    logEvent({ event: 'import', object: `проект ${p.id.slice(-4)}`, engine: '—', param: `буфер, ${paras.length} абз.`, result: 'ок' });
    pushToast({ kind: 'ok', message: `Загружено ${paras.length} абзацев. Настройте режим и запустите обработку.` });
  }, [pasteText, buildProject, setProject, logEvent, pushToast, stopBatch, setUi]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!isSupportedFile(file.name)) {
        pushToast({ kind: 'bad', message: 'Поддерживаются DOCX, TXT и MD.' });
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        pushToast({ kind: 'bad', message: 'Файл больше 25 МБ. Разделите документ.' });
        return;
      }
      // Импорт заменяет проект — останавливаем текущую обработку.
      stopBatch();
      setImporting(true);
      setImportCount(0);
      try {
        if (file.name.toLowerCase().endsWith('.docx')) {
          const { paragraphs, base64 } = await importDocx(file);
          setImportCount(paragraphs.length);
          if (paragraphs.length === 0) {
            pushToast({ kind: 'warn', message: 'В документе не найден текст.' });
            return;
          }
          const p = buildProject(paragraphs, file.name.replace(/\.docx$/i, ''), file.name, base64);
          setProject(p);
          setUi({ viewMode: 'edit', focusedParagraphId: null });
          logEvent({ event: 'import', object: file.name, engine: '—', param: `DOCX, ${paragraphs.length} абз.`, result: 'ок' });
          pushToast({ kind: 'ok', message: `Импортировано ${paragraphs.length} абзацев из DOCX.` });
        } else {
          const text = await readFileText(file);
          const paras = splitIntoParagraphs(text);
          setImportCount(paras.length);
          const p = buildProject(paras, file.name.replace(/\.(txt|md)$/i, ''), file.name);
          setProject(p);
          setUi({ viewMode: 'edit', focusedParagraphId: null });
          logEvent({ event: 'import', object: file.name, engine: '—', param: `${paras.length} абз.`, result: 'ок' });
          pushToast({ kind: 'ok', message: `Импортировано ${paras.length} абзацев.` });
        }
      } catch (e) {
        pushToast({ kind: 'bad', message: `Не удалось прочитать файл: ${(e as Error).message}` });
        logEvent({ event: 'error', object: file.name, engine: '—', param: 'импорт', result: 'ошибка' });
      } finally {
        setImporting(false);
      }
    },
    [buildProject, setProject, setUi, logEvent, pushToast, stopBatch],
  );

  /* --------------------------- Пакетная обработка --------------------------- */

  const runBatch = useCallback(async () => {
    if (!project) return;

    // Защита от повторного запуска: если обработка уже идёт, молча выходим.
    if (abortRef.current) return;

    // M1: согласие на облако (FR-SEC-2, A13). Разовое согласие живёт до закрытия вкладки.
    if (runSettings.engine === 'cloud' && isCloudReady(settings) && !settings.cloudConsentGiven && !loadSessionConsent()) {
      // Модалку открывает App по событию; здесь прерываемся.
      window.dispatchEvent(new CustomEvent('tph:need-cloud-consent'));
      return;
    }

    // Уровень 5 требует подтверждения (FR-2.3).
    if (runSettings.intensity === 5 && !level5Confirm) {
      setLevel5Confirm({ next: 5 });
      return;
    }

    const targets = project.paragraphs.filter((p) => p.status !== 'accepted');
    if (targets.length === 0) {
      pushToast({ kind: 'info', message: 'Все абзацы уже приняты.' });
      return;
    }

    // Недельный лимит (FR-6.4, FR-6.5, S13/M3). Точечный режим не блокируется.
    const runChars = targets.reduce((s, p) => s + p.original.length, 0);
    const runPages = pagesOf(runChars);
    if (settings.pagesThisWeek + runPages > settings.weeklyLimitPages) {
      window.dispatchEvent(new CustomEvent('tph:weekly-limit'));
      return;
    }

    createSnapshot('launch', `Запуск: ${runSettings.preset}, уровень ${runSettings.intensity}`);
    logEvent({
      event: 'batch-start',
      object: `проект ${project.id.slice(-4)}`,
      engine: runSettings.engine,
      param: `${runSettings.preset}, ур.${runSettings.intensity}, ${targets.length} абз.`,
      result: 'старт',
    });

    abortRef.current = new AbortController();
    pauseRef.current = false;
    const controller = abortRef.current;
    runProjectIdRef.current = project.id;
    const startedAt = Date.now();
    setBatch({ running: true, paused: false, total: targets.length, done: 0, failed: 0, startedAt, etaMs: 0 });

    const outcome = await executeBatch({
      targets,
      runSettings,
      engine,
      dictionary,
      stopSignal: controller.signal,
      // Новый контроллер на каждую попытку: после паузы шаг не «залипает».
      newStep: () => {
        const step = new AbortController();
        stepAbortRef.current = step;
        return step.signal;
      },
      isPaused: () => pauseRef.current,
      isStale: () => projectIdRef.current !== runProjectIdRef.current,
      onProgress: (p) => setBatch(p),
      onResult: (id, res) =>
        patchParagraph(id, {
          current: res.paragraph.current,
          variants: res.paragraph.variants,
          status: res.paragraph.status,
          protectedSpans: res.paragraph.protectedSpans,
          sense: res.paragraph.sense,
        }),
      onError: (id) => patchParagraph(id, { status: 'error' }),
    });

    const { done, failed, processedChars, stopped, stale } = outcome;
    pauseRef.current = false;
    runProjectIdRef.current = null;
    // Если проект уже заменён, глобальное состояние пакета/настроек
    // относится к новому проекту — не трогаем его.
    if (!stale) {
      setBatch({ running: false, paused: false, currentParagraphId: undefined });
    }
    abortRef.current = null;
    stepAbortRef.current = null;

    // Проект заменён (импорт/закрытие): итоги старого пакета не пишем
    // в журнал нового проекта и не показываем поверх него.
    if (stale) return;

    logEvent({
      event: stopped ? 'batch-stop' : 'batch-start',
      object: `проект ${project.id.slice(-4)}`,
      engine: runSettings.engine,
      param: `${done}/${targets.length}`,
      result: stopped ? 'остановлено' : failed > 0 ? `частично, ${failed} с ошибкой` : 'ок',
    });

    // Списываем страницы за фактически обработанные абзацы (FR-6.4):
    // при остановке неполный пакет не должен стоить как полный.
    if (processedChars > 0) {
      patchSettings({ pagesThisWeek: settings.pagesThisWeek + pagesOf(processedChars) });
    }

    if (stopped) {
      if (done > 0) {
        setUi({ viewMode: 'compare' });
        pushToast({
          kind: 'info',
          message: `Обработка остановлена: готово ${done} из ${targets.length}. Уже обработанные абзацы сохранены.`,
        });
      } else {
        pushToast({ kind: 'info', message: 'Обработка остановлена, текст не изменён.' });
      }
      return;
    }

    if (done > 0) {
      setUi({ viewMode: 'compare' });
      pushToast({
        kind: failed > 0 ? 'warn' : 'ok',
        message:
          failed > 0
            ? `Обработано ${done} абзацев, ${failed} требуют внимания. Откройте отчёт смысла.`
            : `Готово: ${done} абзацев. Сравните «было/стало» и примите правки.`,
        actionLabel: 'Отчёт смысла',
        action: () => setUi({ screen: 'sense' }),
      });
    }
  }, [
    project,
    runSettings,
    settings,
    patchSettings,
    engine,
    dictionary,
    level5Confirm,
    createSnapshot,
    logEvent,
    setBatch,
    patchParagraph,
    setUi,
    pushToast,
  ]);

  /* ----------------------------- Точечный режим ----------------------------- */

  const handleSelectText = useCallback((paragraphId: string, start: number, end: number, text: string) => {
    setSpot({ paragraphId, start, end, text });
    setSpotVariants([]);
    setSpotTimeout(false);
  }, []);

  const runSpot = useCallback(async () => {
    if (!spot) return;
    setSpotLoading(true);
    setSpotElapsed(0);
    setSpotTimeout(false);
    setSpotVariants([]);
    spotAbortRef.current = new AbortController();

    const started = Date.now();
    if (spotTimerRef.current) window.clearInterval(spotTimerRef.current);
    spotTimerRef.current = window.setInterval(() => {
      const el = Math.round((Date.now() - started) / 100) / 10;
      setSpotElapsed(el);
      if (el > 10 && runSettings.engine === 'cloud') setSpotTimeout(true);
    }, 100);

    logEvent({
      event: 'spot-start',
      object: `абзац ${spot.paragraphId.slice(-4)}`,
      engine: runSettings.engine,
      param: `${spot.text.length} зн.`,
      result: 'старт',
    });

    try {
      const res = await processSpot(spot.text, {
        preset: runSettings.preset,
        intensity: runSettings.intensity,
        compressTarget: runSettings.compressTarget,
        engine,
        dictionary,
        signal: spotAbortRef.current.signal,
      });
      setSpotVariants(res.variants);
    } catch (e) {
      if (!isAbortError(e)) {
        pushToast({ kind: 'bad', message: 'Не удалось получить варианты.' });
      }
    } finally {
      setSpotLoading(false);
      if (spotTimerRef.current) window.clearInterval(spotTimerRef.current);
    }
  }, [spot, runSettings, engine, dictionary, logEvent, pushToast]);

  const applySpotVariant = useCallback(
    (v: Variant) => {
      if (!spot || !project) return;
      const para = project.paragraphs.find((p) => p.id === spot.paragraphId);
      if (!para) return;
      const next = para.current.slice(0, spot.start) + v.text + para.current.slice(spot.end);
      patchParagraph(para.id, {
        current: next,
        status: 'accepted',
        accepted: true,
        sense: v.sense,
      });
      logEvent({
        event: 'accept',
        object: `точечно ${para.id.slice(-4)}`,
        engine: runSettings.engine,
        param: v.label,
        result: 'ок',
      });
      setSpot(null);
      setSpotVariants([]);
      pushToast({ kind: 'ok', message: 'Правка применена.' });
    },
    [spot, project, patchParagraph, logEvent, runSettings.engine, pushToast],
  );

  /* -------------------------------- Правки -------------------------------- */

  const acceptAll = useCallback(() => {
    if (!project) return;
    updateProject((p) => ({
      ...p,
      paragraphs: p.paragraphs.map((para) =>
        para.status === 'processed' || para.status === 'warning'
          ? { ...para, status: 'accepted', accepted: true }
          : para,
      ),
    }));
    logEvent({ event: 'accept-all', object: `проект ${project.id.slice(-4)}`, engine: runSettings.engine, param: '—', result: 'ок' });
    pushToast({ kind: 'ok', message: 'Все обработанные абзацы приняты.' });
  }, [project, updateProject, logEvent, runSettings.engine, pushToast]);

  const rejectAll = useCallback(() => {
    if (!project) return;
    updateProject((p) => ({
      ...p,
      paragraphs: p.paragraphs.map((para) =>
        para.status !== 'original' ? { ...para, current: para.original, status: 'rejected', accepted: false } : para,
      ),
    }));
    logEvent({ event: 'reject-all', object: `проект ${project.id.slice(-4)}`, engine: runSettings.engine, param: '—', result: 'ок' });
    pushToast({ kind: 'info', message: 'Все правки отклонены, текст вернулся к исходному.' });
  }, [project, updateProject, logEvent, runSettings.engine, pushToast]);

  const acceptOne = useCallback(
    (id: string) => {
      patchParagraph(id, { status: 'accepted', accepted: true });
      logEvent({ event: 'accept', object: `абзац ${id.slice(-4)}`, engine: runSettings.engine, param: '—', result: 'ок' });
    },
    [patchParagraph, logEvent, runSettings.engine],
  );

  const rejectOne = useCallback(
    (id: string) => {
      const para = project?.paragraphs.find((p) => p.id === id);
      if (!para) return;
      patchParagraph(id, { current: para.original, status: 'rejected', accepted: false });
      logEvent({ event: 'reject', object: `абзац ${id.slice(-4)}`, engine: runSettings.engine, param: '—', result: 'ок' });
    },
    [project, patchParagraph, logEvent, runSettings.engine],
  );

  const applyVariant = useCallback(
    (id: string, index: number) => {
      const para = project?.paragraphs.find((p) => p.id === id);
      const v = para?.variants[index];
      if (!v) return;
      patchParagraph(id, { current: v.text, sense: v.sense, status: 'processed' });
    },
    [project, patchParagraph],
  );

  const regenerate = useCallback(
    async (id: string) => {
      const para = project?.paragraphs.find((p) => p.id === id);
      if (!para) return;
      try {
        const res = await processParagraph(para, {
          preset: runSettings.preset,
          intensity: runSettings.intensity,
          compressTarget: runSettings.compressTarget,
          engine,
          dictionary,
        });
        patchParagraph(id, {
          current: res.paragraph.current,
          variants: res.paragraph.variants,
          status: res.paragraph.status,
          sense: res.paragraph.sense,
        });
        pushToast({ kind: 'ok', message: `Абзац переписан заново (попыток: ${res.attempts}).` });
      } catch (e) {
        if (!isAbortError(e)) pushToast({ kind: 'bad', message: 'Не удалось переписать абзац.' });
      }
    },
    [project, runSettings, engine, dictionary, patchParagraph, pushToast],
  );

  /* ----------------------------- Закрытие проекта ----------------------------- */

  const [closeConfirm, setCloseConfirm] = useState(false);

  const doCloseProject = useCallback(() => {
    stopBatch();
    if (spotAbortRef.current) {
      spotAbortRef.current.abort();
      setSpot(null);
      setSpotVariants([]);
    }
    flushProject();
    closeProject();
    setCloseConfirm(false);
    setUi({ viewMode: 'edit', focusedParagraphId: null, searchOpen: false, searchQuery: '' });
    pushToast({ kind: 'info', message: 'Проект закрыт и сохранён. Можно загрузить новый файл.' });
  }, [stopBatch, flushProject, closeProject, setUi, pushToast]);

  /* ------------------------------ Навигация ------------------------------ */

  const moveFocus = useCallback(
    (dir: 1 | -1) => {
      if (!project) return;
      const list = project.paragraphs.filter((p) => p.status !== 'original');
      if (list.length === 0) return;
      const idx = list.findIndex((p) => p.id === ui.focusedParagraphId);
      const nextIdx = Math.min(list.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + dir));
      setUi({ focusedParagraphId: list[nextIdx].id });
    },
    [project, ui.focusedParagraphId, setUi],
  );

  /* ---------------------------- Горячие клавиши ---------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void runBatch();
      } else if (e.key === 'Escape' && batch.running) {
        e.preventDefault();
        stopBatch();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Y' || e.key === 'y' || e.key === 'Н')) {
        e.preventDefault();
        acceptAll();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || e.key === 'н')) {
        e.preventDefault();
        if (ui.focusedParagraphId) acceptOne(ui.focusedParagraphId);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'а')) {
        e.preventDefault();
        setUi({ searchOpen: !ui.searchOpen });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runBatch, acceptAll, acceptOne, ui.focusedParagraphId, ui.searchOpen, setUi, batch.running, stopBatch]);

  /* ---------------------------- Поиск по тексту ---------------------------- */

  useEffect(() => {
    if (!project || !ui.searchQuery.trim()) {
      setSearchResults(0);
      return;
    }
    const q = ui.searchQuery.trim().toLowerCase();
    let count = 0;
    for (const p of project.paragraphs) {
      const text = (ui.viewMode === 'result' ? p.current : p.original).toLowerCase();
      let from = 0;
      for (;;) {
        const idx = text.indexOf(q, from);
        if (idx === -1) break;
        count += 1;
        from = idx + q.length;
      }
    }
    setSearchResults(count);
  }, [project, ui.searchQuery, ui.viewMode]);

  /* --------------------- Панель на узком экране (S14) --------------------- */

  // design.md §6.3: при < 1200 px панель уходит в выдвижную и по умолчанию
  // свёрнута, чтобы документ получил всю ширину.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1200px)');
    const apply = (narrow: boolean) => {
      setIsNarrow(narrow);
      if (narrow) setUi({ panelCollapsed: true });
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------- Рендер -------------------------------- */

  const paragraphs = project?.paragraphs ?? [];
  const hasResult = paragraphs.some((p) => p.status !== 'original');
  const fontSize = ui.largeFont ? Math.min(24, settings.docFontSize + 3) : settings.docFontSize;
  const summary = protectionSummary(paragraphs.flatMap((p) => p.protectedSpans));
  const protectedTotal = paragraphs.reduce((s, p) => s + p.protectedSpans.length, 0);

  return (
    <>
      <Ribbon
        onPaste={() => setPasteOpen(true)}
        onImport={() => fileInputRef.current?.click()}
        onNewProject={() => setCloseConfirm(true)}
        onExport={() => setUi({ screen: 'export' })}
        onRun={() => void runBatch()}
        onPause={togglePause}
        onStop={stopBatch}
        onAcceptAll={acceptAll}
        onRejectAll={rejectAll}
        onAcceptCurrent={() => ui.focusedParagraphId && acceptOne(ui.focusedParagraphId)}
        onRejectCurrent={() => ui.focusedParagraphId && rejectOne(ui.focusedParagraphId)}
        onNextParagraph={() => moveFocus(1)}
        onPrevParagraph={() => moveFocus(-1)}
        onToggleSearch={() => setUi({ searchOpen: !ui.searchOpen })}
        onToggleLargeFont={() => setUi({ largeFont: !ui.largeFont })}
        onTogglePanel={() => setUi({ panelCollapsed: !ui.panelCollapsed })}
      />

      <div className="workspace">
        {/* На узком экране панель выдвижная — затемнение закрывает её по клику. */}
        {isNarrow && !ui.panelCollapsed && (
          <button
            className="workspace__scrim"
            aria-label="Закрыть панель настроек"
            onClick={() => setUi({ panelCollapsed: true })}
          />
        )}
        <div className={`workspace__panel${ui.panelCollapsed ? ' workspace__panel--hidden' : ''}`}>
          <SettingsPanel />
        </div>

        <main className="workspace__main">
          {ui.searchOpen && (
            <div className="searchbar">
              <Field
                placeholder="Найти в тексте…"
                value={ui.searchQuery}
                onChange={(e) => setUi({ searchQuery: e.target.value })}
                icon={<Sparkles size={16} />}
                autoFocus
                aria-label="Поиск по тексту"
              />
              <span className="searchbar__count">
                {ui.searchQuery.trim() ? `${searchResults} совпадений` : 'Ctrl+F'}
              </span>
              <IconButton label="Закрыть поиск" onClick={() => setUi({ searchOpen: false, searchQuery: '' })}>
                <X size={16} />
              </IconButton>
            </div>
          )}

          {/* S2: идёт импорт */}
          {importing && (
            <div className="banner banner--info">
              <span className="banner__spin" />
              <span>Разбираем структуру документа… найдено абзацев: {importCount}</span>
            </div>
          )}

          {/* S4: защищённые фрагменты */}
          {protectedTotal > 0 && paragraphs.length > 0 && (
            <div className="banner banner--protect">
              <Shield size={16} />
              <span>
                Автоматически защищено:{' '}
                {Object.entries(summary)
                  .filter(([k, v]) => v > 0 && k !== 'manual')
                  .map(([k, v]) => `${v} ${PROTECTION_LABELS[k as keyof typeof PROTECTION_LABELS]}`)
                  .join(', ')}
              </span>
              <button className="banner__link" onClick={() => setUi({ screen: 'protection' })}>
                Посмотреть
              </button>
            </div>
          )}

          {/* S6: идёт обработка */}
          {batch.running && (
            <div className="banner banner--progress">
              <span>
                Обработка: <strong>{batch.done}</strong> из {batch.total} абзацев
                {batch.paused && ' — пауза'}
              </span>
              <div className="banner__bar">
                <div className="banner__fill" style={{ width: `${(batch.done / Math.max(1, batch.total)) * 100}%` }} />
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={togglePause}
              >
                {batch.paused ? 'Продолжить' : 'Пауза'}
              </Button>
              <Button size="sm" variant="ghost" onClick={stopBatch}>
                Стоп
              </Button>
            </div>
          )}

          {/* S7: готово */}
          {!batch.running && hasResult && (
            <div className="banner banner--done">
              <span>
                Принято {paragraphs.filter((p) => p.status === 'accepted').length} · требуют внимания{' '}
                {paragraphs.filter((p) => p.status === 'warning').length} · ошибки{' '}
                {paragraphs.filter((p) => p.status === 'error').length}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setUi({ screen: 'sense' })}>
                Открыть отчёт смысла
              </Button>
            </div>
          )}

          {/* S1: пусто */}
          {paragraphs.length === 0 ? (
            <div className="workspace__empty">
              <EmptyState
                illustration="doc-empty"
                title="Вставьте текст или импортируйте DOCX"
                description="Приложение перепишет научный текст прозой, без клише, и не изменит ни одного числа, имени или ссылки."
                actions={
                  <>
                    <Button variant="primary" size="lg" icon={<ClipboardPaste size={18} />} onClick={() => setPasteOpen(true)}>
                      Вставить из буфера
                    </Button>
                    <Button variant="secondary" size="lg" icon={<FileUp size={18} />} onClick={() => fileInputRef.current?.click()}>
                      Импорт DOCX
                    </Button>
                  </>
                }
              />
            </div>
          ) : ui.viewMode === 'compare' && hasResult ? (
            <CompareView
              paragraphs={paragraphs}
              focusedId={ui.focusedParagraphId}
              onFocus={(id) => setUi({ focusedParagraphId: id })}
              onAccept={acceptOne}
              onReject={rejectOne}
              onVariant={applyVariant}
              onRegenerate={(id) => void regenerate(id)}
            />
          ) : (
            <DocumentView
              paragraphs={paragraphs}
              mode={ui.viewMode === 'result' ? 'result' : 'edit'}
              fontSize={fontSize}
              searchQuery={ui.searchQuery}
              focusedId={ui.focusedParagraphId}
              showProtection={ui.viewMode !== 'result'}
              onFocusParagraph={(id) => setUi({ focusedParagraphId: id })}
              onSelectText={handleSelectText}
            />
          )}

          {/* Точечный режим: панель вариантов (FR-5.1) */}
          {spot && (
            <div className="spot" role="dialog" aria-label="Варианты переписывания">
              <div className="spot__head">
                <div className="spot__title">
                  <Sparkles size={16} />
                  Варианты переписывания
                  {spotLoading && <span className="spot__timer">{spotElapsed.toFixed(1)} с</span>}
                </div>
                <IconButton
                  label="Закрыть"
                  onClick={() => {
                    spotAbortRef.current?.abort();
                    setSpot(null);
                    setSpotVariants([]);
                  }}
                >
                  <X size={16} />
                </IconButton>
              </div>

              <p className="spot__source">«{spot.text.length > 160 ? `${spot.text.slice(0, 160)}…` : spot.text}»</p>

              {!spotVariants.length && !spotLoading && (
                <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => void runSpot()}>
                  Переписать фрагмент
                </Button>
              )}

              {/* S9: скелетон */}
              {spotLoading && !spotVariants.length && (
                <div className="spot__skeleton">
                  <div className="spot__skeleton-line" />
                  <div className="spot__skeleton-line" />
                  <div className="spot__skeleton-line spot__skeleton-line--short" />
                  <span className="spot__muted">Готовлю варианты…</span>
                </div>
              )}

              {/* S10: таймаут */}
              {spotTimeout && spotLoading && (
                <div className="spot__timeout">
                  <AlertTriangle size={16} />
                  <span>Модель отвечает дольше обычного</span>
                  <Button size="sm" variant="secondary" onClick={() => void runSpot()}>
                    Ещё подождать
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => spotAbortRef.current?.abort()}>
                    Отменить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRunSettings({ engine: 'local' })}>
                    Переключить движок
                  </Button>
                </div>
              )}

              {spotVariants.map((v) => (
                <div key={v.id} className="spot__variant">
                  <div className="spot__variant-head">
                    <Chip kind="accent">{v.label}</Chip>
                    {v.sense && <StatusChip level={v.sense.level} />}
                  </div>
                  <p className="spot__variant-text">{v.text}</p>
                  <div className="spot__variant-actions">
                    <Button variant="primary" size="sm" onClick={() => applySpotVariant(v)}>
                      Принять
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <StatusBar />

      {/* Импорт файла */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.txt,.md"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {/* E2: вставка из буфера */}
      <Modal
        open={pasteOpen}
        title="Вставить текст"
        onClose={() => setPasteOpen(false)}
        width={640}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPasteOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={applyPaste} disabled={!pasteText.trim()}>
              Загрузить текст
            </Button>
          </>
        }
      >
        <p>Вставьте фрагмент главы. Абзацы разделяются пустой строкой. Строки с «-» или «1.» станут списком.</p>
        <textarea
          className="paste-area"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="Вставьте текст сюда (Ctrl+V)…"
          autoFocus
          aria-label="Текст для обработки"
        />
        <div className="paste-meta">
          <span>{pasteText.length.toLocaleString('ru-RU')} знаков</span>
          <span>≈ {Math.max(1, Math.ceil(pasteText.length / 1800))} стр.</span>
        </div>
      </Modal>

      {/* Закрытие проекта */}
      <Modal
        open={closeConfirm}
        title="Закрыть проект и начать новый?"
        onClose={() => setCloseConfirm(false)}
        icon={<FilePlus2 size={20} />}
        tone="warn"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloseConfirm(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={doCloseProject}>
              Сохранить и закрыть
            </Button>
          </>
        }
      >
        <p>
          Текущий проект сохранится в «Истории проектов» — вернуться к нему можно оттуда. Рабочая область очистится, и
          вы сможете вставить новый текст или импортировать файл.
        </p>
        {batch.running && (
          <p className="modal-muted">
            Идёт обработка: она будет остановлена. Уже готовые абзацы сохранятся.
          </p>
        )}
      </Modal>

      {/* FR-2.3: подтверждение уровня 5 */}
      <Modal
        open={Boolean(level5Confirm)}
        title="Уровень 5: свободный пересказ"
        onClose={() => setLevel5Confirm(null)}
        icon={<AlertTriangle size={20} />}
        tone="warn"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLevel5Confirm(null)}>
              Остаться на уровне 4
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setLevel5Confirm(null);
                void runBatch();
              }}
            >
              Понятно, пересказывать
            </Button>
          </>
        }
      >
        <p>На уровне 5 модель переписывает абзац заново, а не правит предложения. Смысл и факты сохраняются, но формулировки будут заметно другими.</p>
        <div className="level-demo">
          <div>
            <span className="level-demo__label">Уровень 4</span>
            <p>Проведённое исследование показало, что регулярные занятия повышают выносливость студентов.</p>
          </div>
          <ArrowRight size={16} className="level-demo__arrow" />
          <div>
            <span className="level-demo__label">Уровень 5</span>
            <p>Студенты, которые занимаются регулярно, выдерживают нагрузку дольше — это подтвердило исследование.</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
