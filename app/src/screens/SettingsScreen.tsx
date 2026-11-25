/* ============================================================================
   SettingsScreen.tsx — E10 «Настройки» (design.md §6, FR-11.2, FR-SEC-6).
   Движок, ключ API (маска), лимиты, пути, шрифт документа.
   ========================================================================== */

import { useState } from 'react';
import { Eye, EyeOff, Cpu, Cloud, ShieldCheck, Trash2, Save, Info, PlugZap, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Field, Toggle } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { Chip } from '../components/ui/Chip';
import { storageSizeKb, wipeAll } from '../state/storage';
import { checkGigaChat } from '../engines/gigachat';
import { LocalModelCard } from './LocalModelCard';
import './SettingsScreen.css';

type CheckState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; models: string[]; chatModels: string[]; keySource: string; trustAnchors: boolean }
  | { state: 'error'; message: string };

export function SettingsScreen() {
  const { settings, patchSettings, pushToast, logEvent, audit } = useStore();
  const [showKey, setShowKey] = useState(false);
  const [draftKey, setDraftKey] = useState(settings.apiKey);
  const [draftUrl, setDraftUrl] = useState(settings.apiBaseUrl);
  const [draftModel, setDraftModel] = useState(settings.cloudModel);
  const [draftProxy, setDraftProxy] = useState(settings.gigachatProxyUrl);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const sizeKb = storageSizeKb();

  const isGigaChat = settings.cloudProvider === 'gigachat';

  const maskKey = (k: string) => (k.length <= 4 ? '••••' : `••••••••${k.slice(-4)}`);

  const saveCloud = () => {
    patchSettings({
      apiKey: draftKey.trim(),
      apiBaseUrl: draftUrl.trim(),
      cloudModel: draftModel.trim(),
      gigachatProxyUrl: draftProxy.trim() || '/api/gigachat',
    });
    logEvent({ event: 'settings', object: 'движок', engine: 'cloud', param: 'ключ/адрес обновлены', result: 'ок' });
    pushToast({ kind: 'ok', message: 'Настройки облака сохранены локально.' });
  };

  const runCheck = async () => {
    setCheck({ state: 'loading' });
    try {
      const result = await checkGigaChat(draftProxy.trim() || '/api/gigachat');
      if (!result.configured) {
        setCheck({ state: 'error', message: 'Ключ авторизации GigaChat не найден на сервере.' });
        return;
      }
      setCheck({ state: 'ok', ...result });
      logEvent({ event: 'settings', object: 'GigaChat', engine: 'cloud', param: `проверка, моделей ${result.models.length}`, result: 'ок' });
    } catch (e) {
      setCheck({ state: 'error', message: (e as Error).message });
    }
  };

  return (
    <ScreenShell
      title="Настройки"
      subtitle="Всё хранится только на этом компьютере: тексты, профиль и ключи"
    >
      <div className="set-grid">
        {/* Движок */}
        <section className="set-card">
          <div className="set-card__head">
            <Cpu size={18} />
            <h2 className="set-card__title">Движок по умолчанию</h2>
          </div>
          <p className="set-card__desc">
            Переключение движка не меняет функций и экранов — только скорость, качество и предупреждение о передаче данных.
          </p>
          <div className="engine-switch engine-switch--wide" role="radiogroup" aria-label="Движок по умолчанию">
            <button
              role="radio"
              aria-checked={settings.engine === 'local'}
              className={`engine-opt${settings.engine === 'local' ? ' engine-opt--active' : ''}`}
              onClick={() => patchSettings({ engine: 'local' })}
            >
              <Cpu size={16} /> Локально
            </button>
            <button
              role="radio"
              aria-checked={settings.engine === 'cloud'}
              className={`engine-opt${settings.engine === 'cloud' ? ' engine-opt--active' : ''}`}
              onClick={() => patchSettings({ engine: 'cloud' })}
              disabled={!settings.cloudAllowed}
            >
              <Cloud size={16} /> Облако
            </button>
          </div>
          <div className="set-row">
            <Toggle
              checked={settings.cloudAllowed}
              onChange={(v) => {
                patchSettings({ cloudAllowed: v, engine: v ? settings.engine : 'local' });
                logEvent({ event: 'settings', object: 'облако', engine: '—', param: v ? 'разрешено' : 'запрещено', result: 'ок' });
              }}
              label="Разрешить облачную обработку"
              description="Если выключить, приложение никогда не отправит текст в интернет"
            />
          </div>
        </section>

        {/* Локальная модель */}
        <LocalModelCard />

        {/* Облачный провайдер */}
        <section className="set-card">
          <div className="set-card__head">
            <Cloud size={18} />
            <h2 className="set-card__title">Облачный провайдер</h2>
            {isGigaChat ? <Chip kind="ok">GigaChat</Chip> : settings.apiKey ? <Chip kind="ok">ключ задан</Chip> : <Chip kind="warn">ключ не задан</Chip>}
          </div>
          <p className="set-card__desc">
            {isGigaChat
              ? 'GigaChat работает через локальный серверный прокси. Ключ авторизации хранится только в файле на сервере (app/.env) и никогда не попадает в браузер.'
              : 'Любой OpenAI-совместимый API. Ключ хранится локально и показывается в маске.'}
          </p>

          <div className="engine-switch engine-switch--wide" role="radiogroup" aria-label="Облачный провайдер">
            <button
              role="radio"
              aria-checked={isGigaChat}
              className={`engine-opt${isGigaChat ? ' engine-opt--active' : ''}`}
              onClick={() => patchSettings({ cloudProvider: 'gigachat', cloudModel: 'GigaChat-2' })}
            >
              GigaChat
            </button>
            <button
              role="radio"
              aria-checked={!isGigaChat}
              className={`engine-opt${!isGigaChat ? ' engine-opt--active' : ''}`}
              onClick={() => patchSettings({ cloudProvider: 'openai' })}
            >
              OpenAI-совместимый
            </button>
          </div>

          {isGigaChat ? (
            <>
              <Field
                label="Адрес прокси GigaChat"
                value={draftProxy}
                onChange={(e) => setDraftProxy(e.target.value)}
                placeholder="/api/gigachat"
                hint="Тот же сервер раздаёт интерфейс и проксирует запросы к GigaChat"
              />
              <Field
                label="Модель"
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                placeholder="GigaChat-2"
                hint="GigaChat-2, GigaChat-2-Pro, GigaChat-2-Max, GigaChat-3-…"
              />
              <div className="set-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={check.state === 'loading' ? <Loader2 size={14} /> : <PlugZap size={14} />}
                  onClick={runCheck}
                  disabled={check.state === 'loading'}
                >
                  {check.state === 'loading' ? 'Проверяю…' : 'Проверить подключение'}
                </Button>
                <Button variant="primary" size="sm" icon={<Save size={14} />} onClick={saveCloud}>
                  Сохранить
                </Button>
              </div>

              {check.state === 'ok' && (
                <div className="set-check set-check--ok">
                  <CheckCircle2 size={16} />
                  <div>
                    <strong>Подключено.</strong> Ключ на сервере:{' '}
                    {check.keySource === 'env' ? 'переменная окружения' : check.keySource === 'file' ? 'файл API/api.txt' : 'не найден'}.
                    Доступно моделей: {check.models.length}
                    {check.chatModels.length > 0 ? ` (для переписывания: ${check.chatModels.join(', ')})` : ''}.
                    {check.trustAnchors ? ' Сертификаты Минцифры подключены.' : ''}
                  </div>
                </div>
              )}
              {check.state === 'error' && (
                <div className="set-check set-check--bad">
                  <XCircle size={16} />
                  <div>{check.message}</div>
                </div>
              )}

              <p className="set-hint">
                <ShieldCheck size={14} />
                <span>
                  Ключ авторизации не вводится в интерфейсе. Добавьте его на сервере: файл <code>app/.env</code>,
                  строка <code>GIGACHAT_AUTH_KEY=…</code>. Подробнее — <code>app/WEB_README.md</code>.
                </span>
              </p>
            </>
          ) : (
            <>
              <Field
                label="Адрес API"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                hint="Без /chat/completions — путь добавится автоматически"
              />
              <Field
                label="Модель"
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                placeholder="gpt-4o-mini"
              />
              <Field
                label="Ключ API"
                type={showKey ? 'text' : 'password'}
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder={settings.apiKey ? maskKey(settings.apiKey) : 'sk-…'}
                hint="Ключ не покидает ваш компьютер, кроме запросов к указанному провайдеру"
              />
              <div className="set-actions">
                <Button variant="secondary" size="sm" icon={showKey ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setShowKey((v) => !v)}>
                  {showKey ? 'Скрыть' : 'Показать'}
                </Button>
                <Button variant="primary" size="sm" icon={<Save size={14} />} onClick={saveCloud}>
                  Сохранить
                </Button>
              </div>
            </>
          )}

          <p className="set-hint">
            <ShieldCheck size={14} />
            <span>Без облака приложение работает на локальных правилах — полностью офлайн.</span>
          </p>
        </section>

        {/* Шрифт и лимиты */}
        <section className="set-card">
          <div className="set-card__head">
            <Info size={18} />
            <h2 className="set-card__title">Чтение и лимиты</h2>
          </div>

          <div className="set-slider">
            <label className="set-slider__label" htmlFor="font-size">
              Размер шрифта документа: <strong>{settings.docFontSize} px</strong>
            </label>
            <input
              id="font-size"
              type="range"
              min={16}
              max={24}
              step={1}
              value={settings.docFontSize}
              onChange={(e) => patchSettings({ docFontSize: Number(e.target.value) })}
              className="set-range"
            />
            <div className="set-slider__preview" style={{ fontSize: `${settings.docFontSize}px` }}>
              Так будет выглядеть текст документа.
            </div>
          </div>

          <div className="set-row">
            <Field
              label="Ваше имя в отчётах"
              value={settings.userName}
              maxLength={60}
              placeholder="Например: Иванов А.В."
              onChange={(e) => patchSettings({ userName: e.target.value })}
              hint="Подпись в отчёте администратора: кто и сколько токенов израсходовал. Можно оставить пустым."
            />
          </div>

          <div className="set-row">
            <Field
              label="Недельный лимит, страниц"
              type="number"
              min={0}
              value={settings.weeklyLimitPages}
              onChange={(e) => patchSettings({ weeklyLimitPages: Number(e.target.value) })}
              hint={`Обработано на этой неделе: ${settings.pagesThisWeek} стр.`}
            />
          </div>

          <div className="set-row">
            <Field
              label="Каталог данных"
              value="%APPDATA%\Текст-по-человечески"
              readOnly
              hint="В десктопной сборке здесь лежат SQLite-база и оригиналы DOCX"
            />
          </div>
        </section>

        {/* Данные */}
        <section className="set-card">
          <div className="set-card__head">
            <Trash2 size={18} />
            <h2 className="set-card__title">Данные приложения</h2>
          </div>
          <p className="set-card__desc">
            Занято локально: <strong>{sizeKb} КБ</strong>. Записей журнала: {audit.length}.
          </p>
          <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setWipeOpen(true)}>
            Удалить все данные
          </Button>
        </section>
      </div>

      <Modal
        open={wipeOpen}
        title="Удалить все данные?"
        onClose={() => setWipeOpen(false)}
        icon={<Trash2 size={20} />}
        tone="bad"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWipeOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                wipeAll();
                logEvent({ event: 'settings', object: 'данные', engine: '—', param: 'полная очистка', result: 'ок' });
                setWipeOpen(false);
                window.location.reload();
              }}
            >
              Удалить и перезапустить
            </Button>
          </>
        }
      >
        <p>
          Будут удалены все проекты, версии, профиль стиля, журнал и ключ API. Это действие необратимо. Оригиналы DOCX,
          которые вы импортировали, остаются у вас на диске.
        </p>
      </Modal>
    </ScreenShell>
  );
}
