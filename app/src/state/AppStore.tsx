/* ============================================================================
   AppStore.tsx — единое состояние приложения: проект, настройки, журнал,
   профиль стиля, тосты, пакетная обработка, автосохранение (FR-10.1).
   ========================================================================== */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AppSettings,
  AuditEvent,
  BatchState,
  EngineKind,
  Paragraph,
  Project,
  RunSettings,
  Screen,
  StyleProfile,
  Toast,
  ViewMode,
} from '../core/types';
import { uid } from '../core/paragraphs';
import { saveAudit, loadAudit } from './storage';

export interface UiState {
  screen: Screen;
  viewMode: ViewMode;
  searchOpen: boolean;
  searchQuery: string;
  panelCollapsed: boolean;
  largeFont: boolean;
  techView: boolean;
  /** Выбранный абзац для точечного режима. */
  focusedParagraphId: string | null;
}

interface StoreValue {
  project: Project | null;
  projects: Project[];
  settings: AppSettings;
  audit: AuditEvent[];
  profile: StyleProfile | null;
  dictionary: string[];
  toasts: Toast[];
  batch: BatchState;
  ui: UiState;
  lastSavedAt: number | null;
  saving: boolean;

  setProject: (p: Project | null) => void;
  updateProject: (updater: (p: Project) => Project) => void;
  /** Немедленно сохранить текущий проект, не дожидаясь автосохранения. */
  flushProject: () => void;
  /** Закрыть текущий проект (с сохранением) и вернуться к пустому экрану. */
  closeProject: () => void;
  setParagraphs: (paras: Paragraph[]) => void;
  patchParagraph: (id: string, patch: Partial<Paragraph>) => void;
  setSettings: (s: AppSettings) => void;
  patchSettings: (patch: Partial<AppSettings>) => void;
  setProfile: (p: StyleProfile | null) => void;
  setDictionary: (terms: string[]) => void;
  logEvent: (e: Omit<AuditEvent, 'id' | 'at'>) => void;
  clearAuditLog: () => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  setBatch: (b: Partial<BatchState>) => void;
  setUi: (patch: Partial<UiState>) => void;
  openProjects: (projects: Project[]) => void;
  createSnapshot: (reason: 'launch' | 'export' | 'rollback' | 'manual', label: string) => void;
  restoreVersion: (versionId: string) => void;
  deleteProject: (id: string) => void;
  markSaved: () => void;
  markSaving: () => void;
  runSettings: RunSettings;
  setRunSettings: (patch: Partial<RunSettings>) => void;
}

const emptyBatch: BatchState = {
  running: false,
  paused: false,
  total: 0,
  done: 0,
  failed: 0,
  startedAt: 0,
  etaMs: 0,
};

const defaultUi: UiState = {
  screen: 'editor',
  viewMode: 'edit',
  searchOpen: false,
  searchQuery: '',
  panelCollapsed: false,
  largeFont: false,
  techView: false,
  focusedParagraphId: null,
};

const StoreContext = createContext<StoreValue | null>(null);

/** Reducer для журнала — держим в памяти и синхронизируем с localStorage. */
type AuditAction = { type: 'add'; event: AuditEvent } | { type: 'clear' } | { type: 'set'; events: AuditEvent[] };

function auditReducer(state: AuditEvent[], action: AuditAction): AuditEvent[] {
  switch (action.type) {
    case 'add':
      return [...state, action.event].slice(-1000);
    case 'clear':
      return [];
    case 'set':
      return action.events;
    default:
      return state;
  }
}

export interface AppStoreProviderProps {
  children: ReactNode;
  initialProjects: Project[];
  initialProject: Project | null;
  initialSettings: AppSettings;
  initialProfile: StyleProfile | null;
  initialDictionary: string[];
  onPersistProject: (p: Project) => void;
  onPersistProjects: (projects: Project[]) => void;
  onPersistSettings: (s: AppSettings) => void;
  onPersistProfile: (p: StyleProfile | null) => void;
  onPersistDictionary: (d: string[]) => void;
  onPersistCurrentId: (id: string | null) => void;
}

export function AppStoreProvider({
  children,
  initialProjects,
  initialProject,
  initialSettings,
  initialProfile,
  initialDictionary,
  onPersistProject,
  onPersistProjects,
  onPersistSettings,
  onPersistProfile,
  onPersistDictionary,
  onPersistCurrentId,
}: AppStoreProviderProps) {
  const [project, setProjectState] = useState<Project | null>(initialProject);
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [settings, setSettingsState] = useState<AppSettings>(initialSettings);
  const [profile, setProfileState] = useState<StyleProfile | null>(initialProfile);
  const [dictionary, setDictionaryState] = useState<string[]>(initialDictionary);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [batch, setBatchState] = useState<BatchState>(emptyBatch);
  const [ui, setUiState] = useState<UiState>(defaultUi);
  const [audit, dispatchAudit] = useReducer(auditReducer, [], () => loadAudit());
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [runSettings, setRunSettingsState] = useState<RunSettings>(
    initialProject?.settings ?? {
      preset: 'F1',
      intensity: 3,
      compressTarget: 30,
      engine: initialSettings.engine,
      model: initialSettings.cloudModel,
    },
  );

  const autosaveTimer = useRef<number | null>(null);
  const projectRef = useRef<Project | null>(project);
  projectRef.current = project;

  /* ------------------------------ Проекты ------------------------------ */

  const persist = useCallback(
    (p: Project) => {
      onPersistProject(p);
      setProjects((prev) => {
        const idx = prev.findIndex((x) => x.id === p.id);
        const next = idx >= 0 ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p];
        onPersistProjects(next);
        return next;
      });
    },
    [onPersistProject, onPersistProjects],
  );

  const setProject = useCallback(
    (p: Project | null) => {
      // Перед сменой проекта сохраняем предыдущий, чтобы не потерять правки,
      // сделанные меньше секунды назад (окно автосохранения).
      const prev = projectRef.current;
      if (prev && (!p || prev.id !== p.id)) persist(prev);
      projectRef.current = p;
      setProjectState(p);
      if (p) {
        setRunSettingsState(p.settings);
        onPersistCurrentId(p.id);
      } else {
        onPersistCurrentId(null);
      }
    },
    [onPersistCurrentId, persist],
  );

  const updateProject = useCallback(
    (updater: (p: Project) => Project) => {
      const current = projectRef.current;
      if (!current) return;
      const next = { ...updater(current), updatedAt: Date.now() };
      // Держим ref в актуальном состоянии: иначе flushProject сразу после
      // правки сохранит предыдущую версию проекта.
      projectRef.current = next;
      setProjectState(next);
      // Автосохранение с задержкой (FR-10.1: ≤30 с; здесь быстрее — 1,2 с).
      setSaving(true);
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => {
        persist(next);
        setSaving(false);
        setLastSavedAt(Date.now());
      }, 1200);
    },
    [persist],
  );

  /** Сохранить текущее состояние немедленно (перед сменой проекта/закрытием). */
  const flushProject = useCallback(() => {
    if (autosaveTimer.current) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    const current = projectRef.current;
    if (!current) return;
    persist(current);
    setSaving(false);
    setLastSavedAt(Date.now());
  }, [persist]);

  /** Закрыть текущий проект: сохранить и очистить рабочую область. */
  const closeProject = useCallback(() => {
    if (autosaveTimer.current) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    const current = projectRef.current;
    if (current) persist(current);
    projectRef.current = null;
    setProjectState(null);
    onPersistCurrentId(null);
    setSaving(false);
    setBatchState(emptyBatch);
  }, [persist, onPersistCurrentId]);

  // Сохранение при закрытии (FR-10.1, §11.3 №7).
  useEffect(() => {
    const handler = () => {
      const current = projectRef.current;
      if (current) onPersistProject(current);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [onPersistProject]);

  const setParagraphs = useCallback(
    (paras: Paragraph[]) => {
      updateProject((p) => ({ ...p, paragraphs: paras }));
    },
    [updateProject],
  );

  const patchParagraph = useCallback(
    (id: string, patch: Partial<Paragraph>) => {
      updateProject((p) => ({
        ...p,
        paragraphs: p.paragraphs.map((para) => (para.id === id ? { ...para, ...patch } : para)),
      }));
    },
    [updateProject],
  );

  const createSnapshot = useCallback(
    (reason: 'launch' | 'export' | 'rollback' | 'manual', label: string) => {
      updateProject((p) => ({
        ...p,
        versions: [
          ...p.versions,
          {
            id: uid('v'),
            createdAt: Date.now(),
            reason,
            label,
            paragraphs: p.paragraphs.map((para) => ({
              id: para.id,
              original: para.original,
              current: para.current,
              status: para.status,
              blockKind: para.blockKind,
              headingLevel: para.headingLevel,
            })),
          },
        ].slice(-40),
      }));
    },
    [updateProject],
  );

  const restoreVersion = useCallback(
    (versionId: string) => {
      const current = projectRef.current;
      if (!current) return;
      const version = current.versions.find((v) => v.id === versionId);
      if (!version) return;
      updateProject((p) => ({
        ...p,
        paragraphs: p.paragraphs.map((para) => {
          const snap = version.paragraphs.find((s) => s.id === para.id);
          if (!snap) return para;
          return { ...para, current: snap.current, status: snap.status };
        }),
      }));
    },
    [updateProject],
  );

  const deleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== id);
        onPersistProjects(next);
        return next;
      });
      if (projectRef.current?.id === id) {
        setProjectState(null);
        onPersistCurrentId(null);
      }
    },
    [onPersistProjects, onPersistCurrentId],
  );

  const openProjects = useCallback((next: Project[]) => {
    setProjects(next);
  }, []);

  /* ----------------------------- Настройки ----------------------------- */

  const setSettings = useCallback(
    (s: AppSettings) => {
      setSettingsState(s);
      onPersistSettings(s);
    },
    [onPersistSettings],
  );

  const patchSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettingsState((prev) => {
        const next = { ...prev, ...patch };
        onPersistSettings(next);
        return next;
      });
    },
    [onPersistSettings],
  );

  const setProfile = useCallback(
    (p: StyleProfile | null) => {
      setProfileState(p);
      onPersistProfile(p);
    },
    [onPersistProfile],
  );

  const setDictionary = useCallback(
    (terms: string[]) => {
      setDictionaryState(terms);
      onPersistDictionary(terms);
    },
    [onPersistDictionary],
  );

  /* ------------------------------- Журнал ------------------------------ */

  const logEvent = useCallback((e: Omit<AuditEvent, 'id' | 'at'>) => {
    const event: AuditEvent = { ...e, id: uid('ev'), at: Date.now() };
    dispatchAudit({ type: 'add', event });
    const existing = loadAudit();
    saveAudit([...existing, event]);
  }, []);

  const clearAuditLog = useCallback(() => {
    dispatchAudit({ type: 'clear' });
    saveAudit([]);
  }, []);

  /* ------------------------------- Тосты ------------------------------- */

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const toast: Toast = { ...t, id: uid('t') };
    // Держим не больше трёх уведомлений: старые вытесняются.
    setToasts((prev) => [...prev.slice(-2), toast]);
    // Автозакрытие и для уведомлений с кнопкой — иначе они копятся
    // и перекрывают рабочую область. С кнопкой живут дольше.
    const ttl = t.action ? 12000 : t.kind === 'bad' ? 9000 : 6000;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== toast.id));
    }, ttl);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* ----------------------------- Пакет/UI ------------------------------ */

  const setBatch = useCallback((b: Partial<BatchState>) => {
    setBatchState((prev) => ({ ...prev, ...b }));
  }, []);

  const setUi = useCallback((patch: Partial<UiState>) => {
    setUiState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setRunSettings = useCallback((patch: Partial<RunSettings>) => {
    setRunSettingsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const markSaved = useCallback(() => {
    setSaving(false);
    setLastSavedAt(Date.now());
  }, []);

  const markSaving = useCallback(() => setSaving(true), []);

  const value = useMemo<StoreValue>(
    () => ({
      project,
      projects,
      settings,
      audit,
      profile,
      dictionary,
      toasts,
      batch,
      ui,
      lastSavedAt,
      saving,
      setProject,
      updateProject,
      flushProject,
      closeProject,
      setParagraphs,
      patchParagraph,
      setSettings,
      patchSettings,
      setProfile,
      setDictionary,
      logEvent,
      clearAuditLog,
      pushToast,
      dismissToast,
      setBatch,
      setUi,
      openProjects,
      createSnapshot,
      restoreVersion,
      deleteProject,
      markSaved,
      markSaving,
      runSettings,
      setRunSettings,
    }),
    [
      project,
      projects,
      settings,
      audit,
      profile,
      dictionary,
      toasts,
      batch,
      ui,
      lastSavedAt,
      saving,
      setProject,
      updateProject,
      flushProject,
      closeProject,
      setParagraphs,
      patchParagraph,
      setSettings,
      patchSettings,
      setProfile,
      setDictionary,
      logEvent,
      clearAuditLog,
      pushToast,
      dismissToast,
      setBatch,
      setUi,
      openProjects,
      createSnapshot,
      restoreVersion,
      deleteProject,
      markSaved,
      markSaving,
      runSettings,
      setRunSettings,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore должен использоваться внутри AppStoreProvider');
  return ctx;
}

/** Утилита: получить движок по настройкам (единый интерфейс, FR-8.3.1). */
export function engineLabel(kind: EngineKind): string {
  return kind === 'cloud' ? 'Облако' : 'Локально';
}
