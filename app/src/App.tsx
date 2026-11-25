/* ============================================================================
   App.tsx — корень приложения: провайдер состояния, маршрутизация экранов,
   модалки M1–M5 и первичный выбор движка (FR-8.3.4).
   ========================================================================== */

import { useEffect, useState } from 'react';
import { AlertTriangle, Cloud, Download, Cpu, FilePlus2, ArrowRight, Sun, Moon } from 'lucide-react';
import { AppStoreProvider, useStore } from './state/AppStore';
import { LOCAL_MODEL_PRESETS } from './engines/localModel';
import {
  loadCurrentProjectId,
  loadDictionary,
  loadProjects,
  loadSettings,
  loadStyleProfile,
  saveCurrentProjectId,
  saveDictionary,
  saveProjects,
  saveSessionConsent,
  saveSettings,
  saveStyleProfile,
} from './state/storage';
import { EditorScreen } from './screens/EditorScreen';
import { SenseReportScreen } from './screens/SenseReportScreen';
import { ProtectionScreen } from './screens/ProtectionScreen';
import { StyleProfileScreen } from './screens/StyleProfileScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ExportScreen } from './screens/ExportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AuditScreen } from './screens/AuditScreen';
import { AccountScreen } from './screens/AccountScreen';
import { clearToken, loadToken, me as fetchMe } from './state/account';
import { Toasts } from './components/ui/Toasts';
import { Modal } from './components/ui/Modal';
import { Button } from './components/ui/Button';
import './styles/app.css';

function ScreenRouter() {
  const { ui } = useStore();
  switch (ui.screen) {
    case 'sense':
      return <SenseReportScreen />;
    case 'protection':
      return <ProtectionScreen />;
    case 'style':
      return <StyleProfileScreen />;
    case 'history':
      return <HistoryScreen />;
    case 'export':
      return <ExportScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'audit':
      return <AuditScreen />;
    case 'account':
      return <AccountScreen />;
    case 'editor':
    default:
      return <EditorScreen />;
  }
}

/** M1 — предупреждение об облачной отправке (FR-SEC-2, S5, A13). */
function CloudConsentModal() {
  const { settings, patchSettings, setRunSettings, logEvent, pushToast } = useStore();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('tph:need-cloud-consent', handler);
    return () => window.removeEventListener('tph:need-cloud-consent', handler);
  }, []);

  const confirm = () => {
    patchSettings({ cloudConsentGiven: remember });
    saveSessionConsent(true);
    logEvent({
      event: 'settings',
      object: 'облако',
      engine: 'cloud',
      param: remember ? 'согласие постоянно' : 'разовое',
      result: 'ок',
    });
    setOpen(false);
    pushToast({ kind: 'info', message: 'Согласие получено — нажмите «Запустить» ещё раз.' });
  };

  return (
    <Modal
      open={open}
      title="Текст будет отправлен в облако"
      onClose={() => setOpen(false)}
      width={640}
      icon={<Cloud size={22} />}
      tone="warn"
      footer={
        <>
          <Button
            variant="ghost"
            className="modal__footer-left"
            onClick={() => {
              patchSettings({ engine: 'local', cloudAllowed: false });
              setRunSettings({ engine: 'local', model: 'rules' });
              setOpen(false);
              pushToast({ kind: 'info', message: 'Включён локальный режим — текст не покинет компьютер.' });
            }}
          >
            Перейти на локальный движок
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Отменить
          </Button>
          <Button variant="primary" onClick={confirm}>
            Продолжить
          </Button>
        </>
      }
    >
      <p>
        Неопубликованная работа покинет ваш компьютер и будет обработана провайдером модели{' '}
        <strong>{settings.cloudProvider === 'gigachat' ? `GigaChat (${settings.cloudModel})` : settings.cloudModel}</strong>. Числа, имена и ссылки к этому моменту уже заменены защитными
        токенами, но остальной текст уйдёт в сеть.
      </p>
      <label className="consent-check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Разрешить облако постоянно (можно отключить в настройках)</span>
      </label>
    </Modal>
  );
}

/** S13/M3 — недельный лимит. */
function WeeklyLimitModal() {
  const { settings } = useStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('tph:weekly-limit', handler);
    return () => window.removeEventListener('tph:weekly-limit', handler);
  }, []);

  const nextWeek = new Date(Date.now() + 7 * 86400000).toLocaleDateString('ru-RU');

  return (
    <Modal
      open={open}
      title="Недельный лимит исчерпан"
      onClose={() => setOpen(false)}
      icon={<AlertTriangle size={22} />}
      tone="warn"
      footer={
        <Button variant="primary" onClick={() => setOpen(false)}>
          Понятно
        </Button>
      }
    >
      <p>
        Обработано {settings.pagesThisWeek} из {settings.weeklyLimitPages} страниц на этой неделе. Лимит обновится{' '}
        {nextWeek}.
      </p>
      <p className="modal-muted">Точечный режим остаётся доступным: можно переписывать отдельные абзацы без лимита.</p>
    </Modal>
  );
}

/** S14/M4 — ошибка round-trip DOCX. */
function DocxRoundTripModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('tph:docx-roundtrip-error', handler);
    return () => window.removeEventListener('tph:docx-roundtrip-error', handler);
  }, []);

  return (
    <Modal
      open={open}
      title="Не удалось сохранить форматирование"
      onClose={() => setOpen(false)}
      icon={<Download size={22} />}
      tone="warn"
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Экспорт чистым текстом
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Понятно
          </Button>
        </>
      }
    >
      <p>
        Часть абзацев содержит вложенные таблицы — их форматирование не переносится автоматически. Текст этих абзацев
        будет экспортирован без изменения содержимого таблиц.
      </p>
    </Modal>
  );
}

/** Переключатель темы — иконка в правом верхнем углу. */
function ThemeToggle() {
  const { settings, patchSettings } = useStore();

  return (
    <button
      className="theme-toggle"
      aria-label={settings.darkMode ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
      onClick={() => patchSettings({ darkMode: !settings.darkMode })}
    >
      {settings.darkMode ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

/** Выбор движка — большие плитки. Показывается при каждом новом проекте. */
function EngineSelector() {
  const { settings, patchSettings, setRunSettings, project, logEvent, ui } = useStore();
  const [open, setOpen] = useState(false);
  const [showingForNewProject, setShowingForNewProject] = useState(false);
  const [selectedLocalModel, setSelectedLocalModel] = useState<string>('');

  useEffect(() => {
    if (!project) {
      setOpen(true);
      setShowingForNewProject(true);
    }
  }, [project]);

  const choose = (engine: 'cloud' | 'local') => {
    if (engine === 'local') {
      // Выбираем модель: если выбрана — используем GGUF, иначе правила
      const preset = LOCAL_MODEL_PRESETS.find((m) => m.url === selectedLocalModel);
      if (preset) {
        patchSettings({ engine: 'local', localEngine: 'gguf', localModelUrl: preset.url });
        setRunSettings({ engine: 'local', model: 'gguf' });
      } else {
        patchSettings({ engine: 'local', localEngine: 'rules' });
        setRunSettings({ engine: 'local', model: 'rules' });
      }
    } else {
      patchSettings({ engine: 'cloud' });
      setRunSettings({ engine: 'cloud', model: settings.cloudModel });
    }
    logEvent({ event: 'settings', object: 'выбор движка', engine, param: `модель=${selectedLocalModel || 'rules'}`, result: 'ок' });
    setOpen(false);
  };

  // Модалку выбора движка показываем только в редакторе: на других экранах
  // (аккаунт, настройки, журнал) она перекрывала бы содержимое.
  if (!open || ui.screen !== 'editor') return null;

  return (
    <>
      <Modal
        open={open}
        title=""
        onClose={() => {
          if (showingForNewProject) return;
          setOpen(false);
        }}
        width={720}
        bare
      >
        <div className="engine-selector">
          {/* Заголовок */}
          <div className="engine-selector__header">
            <h2>Как обрабатывать текст?</h2>
            <p>Выберите режим обработки. Его можно поменять в любой момент в настройках.</p>
          </div>

          {/* Плитки выбора */}
          <div className="engine-selector__tiles">
            {/* Локально */}
            <div className="engine-selector__tile-group">
              <button
                className="engine-selector__tile"
                onClick={() => choose('local')}
                aria-label="Обработать локально — полностью офлайн"
              >
                <div className="engine-selector__tile-icon">
                  <Cpu size={32} />
                </div>
                <div className="engine-selector__tile-content">
                  <span className="engine-selector__tile-title">Локально</span>
                  <span className="engine-selector__tile-desc">
                    Полностью офлайн. Текст не покидает компьютер. Мгновенный отклик, работает без интернета.
                  </span>
                  <span className="engine-selector__tile-hint">
                    Движок: встроенные правила · без ключей · без сети
                  </span>
                </div>
                <ArrowRight size={20} className="engine-selector__tile-arrow" />
              </button>

              {/* Выбор модели */}
              <div className="engine-selector__model-picker">
                <span className="engine-selector__model-label">Модель для локальной обработки:</span>
                <select
                  className="engine-selector__model-select"
                  value={selectedLocalModel}
                  onChange={(e) => setSelectedLocalModel(e.target.value)}
                  aria-label="Выберите модель"
                >
                  <option value="">— Встроенные правила (без загрузки) —</option>
                  {LOCAL_MODEL_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.url}>
                      {preset.name} ({preset.sizeMb} МБ)
                    </option>
                  ))}
                </select>
                {selectedLocalModel && (
                  <span className="engine-selector__model-note">
                    Модель будет скачана один раз и сохранена в браузере.
                  </span>
                )}
              </div>
            </div>

            {/* Облако */}
            <button
              className="engine-selector__tile engine-selector__tile--accent"
              onClick={() => choose('cloud')}
              aria-label="Обработать через облако — более живой текст"
            >
              <div className="engine-selector__tile-icon">
                <Cloud size={32} />
              </div>
              <div className="engine-selector__tile-content">
                <span className="engine-selector__tile-title">Облако</span>
                <span className="engine-selector__tile-desc">
                  Более живая проза. Нужен интернет и ключ API. Перед первым запуском — предупреждение.
                </span>
                <span className="engine-selector__tile-hint">
                  Провайдер: {settings.cloudProvider === 'gigachat' ? 'GigaChat' : 'OpenAI'} · {settings.cloudModel} · требует ключ
                </span>
              </div>
              <ArrowRight size={20} className="engine-selector__tile-arrow" />
            </button>
          </div>

          {/* Кнопка для нового проекта — продолжить без выбора */}
          {showingForNewProject && !project && (
            <div className="engine-selector__skip">
              <Button
                variant="ghost"
                size="sm"
                icon={<FilePlus2 size={16} />}
                onClick={() => {
                  patchSettings({ engine: 'local', localEngine: 'rules' });
                  setRunSettings({ engine: 'local', model: 'rules' });
                  setOpen(false);
                }}
              >
                Новый проект — локально по умолчанию
              </Button>
            </div>
          )}

          {/* Кнопка «Пропустить» когда есть проект (редкий кейс) */}
          {!showingForNewProject && (
            <div className="engine-selector__skip">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Пропустить
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Состояние входа: проверяем сессию до показа приложения. */
type AuthGate = 'checking' | 'anonymous' | 'authenticated';

function AppInner() {
  const { settings } = useStore();
  const [auth, setAuth] = useState<AuthGate>(() => (loadToken() ? 'checking' : 'anonymous'));

  /* Проверка сохранённой сессии при запуске. */
  useEffect(() => {
    let alive = true;
    const token = loadToken();
    if (!token) {
      setAuth('anonymous');
      return () => {
        alive = false;
      };
    }
    fetchMe(token)
      .then(() => {
        if (alive) setAuth('authenticated');
      })
      .catch((err: { status?: number }) => {
        if (!alive) return;
        // 401 — сессия истекла; сетевую ошибку не считаем выходом.
        if (err?.status === 401) clearToken();
        setAuth(err?.status === 401 ? 'anonymous' : 'authenticated');
      });
    return () => {
      alive = false;
    };
  }, []);

  /* Вход, выход и удаление аккаунта меняют доступ к приложению. */
  useEffect(() => {
    const handler = () => setAuth(loadToken() ? 'authenticated' : 'anonymous');
    window.addEventListener('tph:account-changed', handler);
    return () => window.removeEventListener('tph:account-changed', handler);
  }, []);

  /* Применяем тёмную тему к <html> */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', Boolean(settings.darkMode));
  }, [settings.darkMode]);

  if (auth === 'checking') {
    return (
      <div className="app app--boot">
        <div className="boot-screen" role="status" aria-live="polite">
          <span className="boot-screen__mark" aria-hidden="true">
            Т
          </span>
          <span className="boot-screen__text">Проверяем вход…</span>
        </div>
        <Toasts />
        <ThemeToggle />
      </div>
    );
  }

  // Без входа доступна только форма: проекты и история привязаны к аккаунту.
  if (auth === 'anonymous') {
    return (
      <div className="app app--gate">
        <AccountScreen standalone />
        <Toasts />
        <ThemeToggle />
      </div>
    );
  }

  return (
    <div className="app">
      <ScreenRouter />
      <Toasts />
      <CloudConsentModal />
      <WeeklyLimitModal />
      <DocxRoundTripModal />
      <EngineSelector />
      <ThemeToggle />
    </div>
  );
}

export default function App() {
  const projects = loadProjects();
  const currentId = loadCurrentProjectId();
  const initialProject = projects.find((p) => p.id === currentId) ?? null;

  return (
    <AppStoreProvider
      initialProjects={projects}
      initialProject={initialProject}
      initialSettings={loadSettings()}
      initialProfile={loadStyleProfile()}
      initialDictionary={loadDictionary()}
      onPersistProject={(p) => {
        const list = loadProjects();
        const idx = list.findIndex((x) => x.id === p.id);
        const next = idx >= 0 ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
        saveProjects(next);
      }}
      onPersistProjects={saveProjects}
      onPersistSettings={saveSettings}
      onPersistProfile={saveStyleProfile}
      onPersistDictionary={saveDictionary}
      onPersistCurrentId={saveCurrentProjectId}
    >
      <AppInner />
    </AppStoreProvider>
  );
}
