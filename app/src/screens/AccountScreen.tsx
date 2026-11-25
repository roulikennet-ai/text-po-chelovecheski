/* ============================================================================
   AccountScreen.tsx — регистрация, вход и личный кабинет.

   Приватность: до полей показываем назначение формы, цель использования
   данных и получателя уведомления. Галочка согласия НЕ отмечена заранее.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  FileText,
  History,
  LogOut,
  Mail,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Chip } from '../components/ui/Chip';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { pagesOf } from '../core/paragraphs';
import {
  clearToken,
  deleteAccount,
  getMeta,
  loadToken,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  register as apiRegister,
  saveToken,
  updateProfile,
  type AccountMeta,
  type AccountStats,
  type AccountUser,
} from '../state/account';
import './AccountScreen.css';

type Mode = 'register' | 'login';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Форма регистрации и входа (до авторизации). */
function AuthForms({
  meta,
  metaError,
  loadingMeta,
  onReloadMeta,
}: {
  meta: AccountMeta | null;
  metaError: string | null;
  loadingMeta: boolean;
  onReloadMeta: () => void;
}) {
  const { settings, pushToast, logEvent } = useStore();
  const [mode, setMode] = useState<Mode>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'register') {
      if (!name.trim() || name.trim().length < 2) {
        setError('Укажите имя — от 2 до 60 символов.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        setError('Укажите корректный адрес электронной почты.');
        return;
      }
      if (password.length < 8) {
        setError('Пароль должен быть не короче 8 символов.');
        return;
      }
      if (!consent) {
        setError('Отметьте согласие на обработку персональных данных.');
        return;
      }
      if (!meta) {
        setError('Форма ещё не загрузила текст согласия. Нажмите «Повторить».');
        return;
      }
    } else if (!email.trim() || !password) {
      setError('Укажите адрес и пароль.');
      return;
    }

    setSubmitting(true);
    try {
      const res =
        mode === 'register'
          ? await apiRegister({
              name: name.trim(),
              email: email.trim(),
              password,
              consent,
              consentVersion: meta!.consentVersion,
              clientId: settings.clientId,
            })
          : await apiLogin({ email: email.trim(), password, clientId: settings.clientId });

      saveToken(res.token);
      logEvent({
        event: 'settings',
        object: mode === 'register' ? 'регистрация' : 'вход в аккаунт',
        engine: '—',
        param: res.user.email,
        result: 'ок',
      });
      pushToast({
        kind: 'ok',
        message: mode === 'register' ? 'Аккаунт создан. Добро пожаловать в личный кабинет.' : 'Вы вошли в аккаунт.',
      });
      window.dispatchEvent(new CustomEvent('tph:account-changed'));
    } catch (err) {
      const e = err as { error?: string; code?: string };
      setError(e?.error || 'Не удалось выполнить действие. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingMeta) {
    return <div className="acc-loading">Загружаем форму…</div>;
  }

  if (metaError) {
    return (
      <div className="acc-fatal">
        <AlertTriangle size={22} />
        <div>
          <h2 className="acc-fatal__title">Сервер учётных записей недоступен</h2>
          <p className="acc-fatal__text">{metaError}</p>
          <p className="acc-fatal__hint">
            Регистрация работает на локальном сервере приложения. Запустите его командой <code>npm run web</code> или
            откройте dev-версию через <code>npm run dev</code>.
          </p>
          <Button variant="secondary" size="sm" onClick={onReloadMeta}>
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  const isRegister = mode === 'register';

  return (
    <div className="acc-auth">
      <div className="acc-auth__card">
        <div className="acc-auth__tabs" role="tablist" aria-label="Регистрация или вход">
          <button
            role="tab"
            aria-selected={isRegister}
            className={`acc-tab${isRegister ? ' acc-tab--active' : ''}`}
            onClick={() => {
              setMode('register');
              setError(null);
            }}
          >
            Регистрация
          </button>
          <button
            role="tab"
            aria-selected={!isRegister}
            className={`acc-tab${!isRegister ? ' acc-tab--active' : ''}`}
            onClick={() => {
              setMode('login');
              setError(null);
            }}
          >
            Вход
          </button>
        </div>

        {/* Пояснение ДО сбора контактов (требование приватности). */}
        {isRegister && meta && (
          <div className="acc-notice" aria-label="Зачем нужны данные">
            <h2 className="acc-notice__title">
              <ShieldCheck size={18} /> Зачем эта форма
            </h2>
            <dl className="acc-notice__list">
              <div className="acc-notice__row">
                <dt>Назначение</dt>
                <dd>{meta.notice.purpose}</dd>
              </div>
              <div className="acc-notice__row">
                <dt>Цель использования данных</dt>
                <dd>{meta.notice.dataUse}</dd>
              </div>
              <div className="acc-notice__row">
                <dt>Получатель уведомления</dt>
                <dd>{meta.notice.recipient}</dd>
              </div>
              <div className="acc-notice__row">
                <dt>Срок хранения</dt>
                <dd>{meta.notice.retention}</dd>
              </div>
            </dl>
          </div>
        )}

        <form className="acc-form" onSubmit={submit} noValidate>
          {isRegister && (
            <Field
              label="Имя"
              placeholder="Как к вам обращаться"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={60}
            />
          )}
          <Field
            label="Электронная почта"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
          <Field
            label="Пароль"
            type="password"
            placeholder={isRegister ? 'Не короче 8 символов' : 'Ваш пароль'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            hint={isRegister ? 'Хранится только как необратимый хеш — восстановить пароль нельзя.' : undefined}
          />

          {isRegister && meta && (
            <label className="acc-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{meta.consentText}</span>
            </label>
          )}

          {error && (
            <p className="acc-error" role="alert">
              <AlertTriangle size={14} /> {error}
            </p>
          )}

          <Button
            variant="primary"
            type="submit"
            fullWidth
            icon={isRegister ? <UserRound size={16} /> : <ArrowRight size={16} />}
            disabled={submitting || (isRegister && !consent)}
          >
            {submitting ? 'Отправляем…' : isRegister ? 'Создать аккаунт' : 'Войти'}
          </Button>

          {isRegister && (
            <p className="acc-form__hint">
              Согласие не отмечено заранее: поставьте галочку осознанно. Без согласия аккаунт не создаётся.
            </p>
          )}
        </form>
      </div>

      <aside className="acc-auth__side">
        <h2 className="acc-side__title">Что даёт аккаунт</h2>
        <ul className="acc-side__list">
          <li>
            <FileText size={16} /> Все ваши файлы и проекты в одном месте.
          </li>
          <li>
            <History size={16} /> История действий: импорт, обработка, экспорт.
          </li>
          <li>
            <ShieldCheck size={16} /> Статистика расхода и понятное управление данными.
          </li>
        </ul>
        <p className="acc-side__note">
          Тексты документов остаются на этом устройстве. На сервер уходят только имя, адрес и хеш пароля.
        </p>
      </aside>
    </div>
  );
}

/** Кабинет авторизованного пользователя. */
function AccountDashboard({
  token,
  user,
  stats,
  onSignOut,
}: {
  token: string;
  user: AccountUser;
  stats: AccountStats;
  onSignOut: () => void;
}) {
  const { projects, setProject, setUi, audit, deleteProject, pushToast } = useStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const recentAudit = useMemo(() => [...audit].reverse().slice(0, 12), [audit]);

  const openProject = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setProject(p);
    const processed = p.paragraphs.some((x) => x.status !== 'original');
    setUi({ screen: 'editor', viewMode: processed ? 'compare' : 'edit', focusedParagraphId: null });
  };

  const exportProject = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setProject(p);
    setUi({ screen: 'export' });
  };

  const doDelete = async () => {
    setDeleteError(null);
    if (!deletePassword) {
      setDeleteError('Введите пароль, чтобы подтвердить удаление.');
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount(token, deletePassword);
      clearToken();
      pushToast({ kind: 'info', message: 'Аккаунт удалён. Локальные проекты остались на устройстве.' });
      window.dispatchEvent(new CustomEvent('tph:account-changed'));
    } catch (err) {
      const e = err as { error?: string };
      setDeleteError(e?.error || 'Не удалось удалить аккаунт.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="acc-dash">
        {/* Профиль */}
        <section className="acc-card acc-card--profile">
          <div className="acc-profile">
            <div className="acc-avatar" aria-hidden="true">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="acc-profile__main">
              <h2 className="acc-profile__name">{user.name}</h2>
              <p className="acc-profile__email">
                <Mail size={14} /> {user.email}
              </p>
              <div className="acc-profile__meta">
                <Chip kind="ok">Аккаунт активен</Chip>
                <span>Зарегистрирован {fmtDate(user.createdAt)}</span>
                <span>Последний вход {fmtDateTime(user.lastLoginAt)}</span>
              </div>
            </div>
            <Button variant="secondary" size="sm" icon={<LogOut size={16} />} onClick={onSignOut}>
              Выйти
            </Button>
          </div>

          <div className="acc-consent-info">
            <ShieldCheck size={16} />
            <span>
              Согласие на обработку персональных данных: <strong>да</strong>
              {user.consentAt ? `, ${fmtDate(user.consentAt)}` : ''}
              {user.consentVersion ? ` · версия ${user.consentVersion}` : ''}
            </span>
          </div>
        </section>

        {/* Статистика */}
        <section className="acc-stats" aria-label="Статистика использования">
          <div className="acc-stat">
            <span className="acc-stat__value">{stats.requests.toLocaleString('ru-RU')}</span>
            <span className="acc-stat__label">запросов к модели</span>
          </div>
          <div className="acc-stat">
            <span className="acc-stat__value">{stats.tokens.toLocaleString('ru-RU')}</span>
            <span className="acc-stat__label">токенов израсходовано</span>
          </div>
          <div className="acc-stat">
            <span className="acc-stat__value">{stats.error}</span>
            <span className="acc-stat__label">ошибок</span>
          </div>
          <div className="acc-stat">
            <span className="acc-stat__value">{fmtDateTime(stats.lastAt)}</span>
            <span className="acc-stat__label">последняя активность</span>
          </div>
        </section>

        {/* Файлы */}
        <section className="acc-card">
          <div className="acc-card__head">
            <h2 className="acc-card__title">
              <FileText size={18} /> Мои файлы
            </h2>
            <Chip kind="neutral">{projects.length}</Chip>
          </div>

          {projects.length === 0 ? (
            <EmptyState
              compact
              title="Файлов пока нет"
              description="Загрузите текст или DOCX в редакторе — проект появится здесь."
            />
          ) : (
            <ul className="acc-files">
              {projects.map((p) => {
                const chars = p.paragraphs.reduce((s, x) => s + x.current.length, 0);
                const processed = p.paragraphs.filter((x) => x.status !== 'original').length;
                return (
                  <li key={p.id} className="acc-file">
                    <div className="acc-file__main">
                      <span className="acc-file__title">{p.title}</span>
                      <span className="acc-file__meta">
                        {new Date(p.updatedAt).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {p.paragraphs.length} абз. · {chars.toLocaleString('ru-RU')} зн. ·{' '}
                        {pagesOf(chars)} стр.
                        {p.sourceFileName ? ` · ${p.sourceFileName}` : ''}
                      </span>
                    </div>
                    <div className="acc-file__status">
                      {processed > 0 ? (
                        <Chip kind="ok">{processed} обработано</Chip>
                      ) : (
                        <Chip kind="neutral">без обработки</Chip>
                      )}
                    </div>
                    <div className="acc-file__actions">
                      <Button variant="secondary" size="sm" onClick={() => openProject(p.id)}>
                        Открыть
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Download size={14} />}
                        onClick={() => exportProject(p.id)}
                      >
                        Экспорт
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        aria-label={`Удалить файл «${p.title}»`}
                        onClick={() => {
                          if (confirm(`Удалить проект «${p.title}»? Действие необратимо.`)) {
                            deleteProject(p.id);
                            pushToast({ kind: 'info', message: 'Проект удалён.' });
                          }
                        }}
                      >
                        Удалить
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* История */}
        <section className="acc-card">
          <div className="acc-card__head">
            <h2 className="acc-card__title">
              <History size={18} /> История действий
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setUi({ screen: 'audit' })}>
              Весь журнал
            </Button>
          </div>

          {recentAudit.length === 0 ? (
            <EmptyState compact title="Записей пока нет" description="Здесь появятся импорт, запуски и экспорт." />
          ) : (
            <ul className="acc-history">
              {recentAudit.map((e) => (
                <li key={e.id} className="acc-history__row">
                  <span className="acc-history__time">{fmtDateTime(new Date(e.at).toISOString())}</span>
                  <span className="acc-history__object">{e.object}</span>
                  <span className="acc-history__param">{e.param}</span>
                  <span className="acc-history__result">{e.result}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Управление данными */}
        <section className="acc-card acc-card--danger">
          <div className="acc-card__head">
            <h2 className="acc-card__title">
              <ShieldCheck size={18} /> Мои данные
            </h2>
          </div>
          <p className="acc-danger__text">
            Удаление аккаунта стирает имя, адрес, хеш пароля и все сессии на сервере. Проекты останутся на этом
            устройстве — их можно удалить отдельно в списке файлов.
          </p>
          <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={() => setDeleteOpen(true)}>
            Удалить аккаунт
          </Button>
        </section>
      </div>

      <Modal
        open={deleteOpen}
        title="Удалить аккаунт?"
        onClose={() => {
          setDeleteOpen(false);
          setDeletePassword('');
          setDeleteError(null);
        }}
        icon={<Trash2 size={20} />}
        tone="bad"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteOpen(false);
                setDeletePassword('');
                setDeleteError(null);
              }}
            >
              Отмена
            </Button>
            <Button variant="danger" onClick={doDelete} disabled={deleting}>
              {deleting ? 'Удаляем…' : 'Удалить навсегда'}
            </Button>
          </>
        }
      >
        <p>
          Аккаунт <strong>{user.email}</strong> будет удалён вместе со всеми сессиями. Это действие нельзя отменить.
        </p>
        <Field
          label="Пароль для подтверждения"
          type="password"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          autoComplete="current-password"
        />
        {deleteError && (
          <p className="acc-error" role="alert">
            <AlertTriangle size={14} /> {deleteError}
          </p>
        )}
      </Modal>
    </>
  );
}

/* -------------------------------- Экран -------------------------------- */

export interface AccountScreenProps {
  /**
   * Режим «первый экран»: без каркаса внутренних экранов и без кнопки
   * «назад». Используется, пока пользователь не вошёл в аккаунт.
   */
  standalone?: boolean;
}

export function AccountScreen({ standalone = false }: AccountScreenProps) {
  const { settings, pushToast, logEvent } = useStore();
  const [meta, setMeta] = useState<AccountMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [user, setUser] = useState<AccountUser | null>(null);
  const [stats, setStats] = useState<AccountStats>({
    requests: 0,
    ok: 0,
    error: 0,
    tokens: 0,
    lastAt: null,
    byModel: {},
  });
  const [checking, setChecking] = useState(true);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const m = await getMeta();
      setMeta(m);
    } catch (err) {
      const e = err as { error?: string; code?: string };
      setMetaError(
        e?.code === 'unknown'
          ? 'Не удалось связаться с сервером. Проверьте, что он запущен.'
          : e?.error || 'Не удалось загрузить форму.',
      );
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const current = loadToken();
    if (!current) {
      setUser(null);
      setChecking(false);
      return;
    }
    try {
      const res = await apiMe(current);
      setUser(res.user);
      setStats(res.stats);
      setToken(current);
      // Привязываем текущий clientId к аккаунту при первом входе с этого устройства.
      if (settings.clientId && !res.user.clientIds.includes(settings.clientId)) {
        try {
          await updateProfile(current, { clientId: settings.clientId });
        } catch {
          /* не критично */
        }
      }
    } catch (err) {
      const e = err as { status?: number };
      if (e?.status === 401) {
        clearToken();
        setToken(null);
        setUser(null);
      }
    } finally {
      setChecking(false);
    }
  }, [settings.clientId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Событие приходит после успешной регистрации/входа или удаления аккаунта.
  useEffect(() => {
    const handler = () => {
      setChecking(true);
      void refresh();
    };
    window.addEventListener('tph:account-changed', handler);
    return () => window.removeEventListener('tph:account-changed', handler);
  }, [refresh]);

  const signOut = async () => {
    const current = loadToken();
    if (current) {
      try {
        await apiLogout(current);
      } catch {
        /* локальный выход важнее ответа сервера */
      }
    }
    clearToken();
    setToken(null);
    setUser(null);
    logEvent({ event: 'settings', object: 'аккаунт', engine: '—', param: 'выход', result: 'ок' });
    pushToast({ kind: 'info', message: 'Вы вышли из аккаунта.' });
    // Приложение снова закрывает редактор: без входа доступна только форма.
    window.dispatchEvent(new CustomEvent('tph:account-changed'));
  };

  const content =
    checking && token ? (
      <div className="acc-loading">Проверяем сессию…</div>
    ) : user && token ? (
      <AccountDashboard token={token} user={user} stats={stats} onSignOut={signOut} />
    ) : (
      <AuthForms meta={meta} metaError={metaError} loadingMeta={loadingMeta} onReloadMeta={loadMeta} />
    );

  if (standalone) {
    return (
      <div className="acc-standalone">
        <div className="acc-standalone__inner">
          <header className="acc-standalone__brand">
            <span className="acc-standalone__mark" aria-hidden="true">
              Т
            </span>
            <span className="acc-standalone__title">Текст по-человечески</span>
          </header>
          {content}
          <p className="acc-standalone__foot">
            Вход нужен, чтобы открыть редактор: так проекты и история привязаны к вашему аккаунту.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScreenShell
      title="Личный кабинет"
      subtitle="Ваши файлы, история действий и статистика. Тексты документов на сервер не отправляются"
    >
      {content}
    </ScreenShell>
  );
}
