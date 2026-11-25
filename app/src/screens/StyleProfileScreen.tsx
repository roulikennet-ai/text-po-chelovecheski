/* ============================================================================
   StyleProfileScreen.tsx — E7 «Профиль стиля» (design.md §6, S16).
   Строится из ≥3 загруженных текстов (FR-8.1). Хранится локально.
   ========================================================================== */

import { useRef, useState } from 'react';
import { RefreshCw, Download, Trash2, FileUp, Info } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { splitSentences } from '../core/ruleEngine';
import { readFileText } from '../core/docxImport';
import { downloadBlob } from '../core/exporters';
import type { StyleProfile } from '../core/types';
import './StyleProfileScreen.css';

const MIN_SOURCES = 3;
const STOP_WORDS = new Set(
  'и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это которые которая который которые'.split(
    ' ',
  ),
);

export function StyleProfileScreen() {
  const { profile, setProfile, pushToast, logEvent } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [building, setBuilding] = useState(false);

  const addSources = async (files: FileList) => {
    setBuilding(true);
    try {
      const added: StyleProfile['sources'] = [];
      const texts: string[] = [];
      for (const file of Array.from(files)) {
        if (!/\.(txt|md|docx)$/i.test(file.name)) continue;
        const text = await readFileText(file).catch(() => '');
        if (!text.trim()) continue;
        texts.push(text);
        added.push({ id: `src_${Date.now()}_${added.length}`, title: file.name, chars: text.length, addedAt: Date.now() });
      }
      if (added.length === 0) {
        pushToast({ kind: 'warn', message: 'Не удалось прочитать тексты. Поддерживаются TXT, MD.' });
        return;
      }

      const sources = [...(profile?.sources ?? []), ...added];
      const newProfile = buildProfile(sources, texts, profile);
      setProfile(newProfile);
      logEvent({
        event: 'style-profile-change',
        object: 'профиль стиля',
        engine: '—',
        param: `+${added.length} текстов, всего ${sources.length}`,
        result: 'пересчитан',
      });
      pushToast({
        kind: 'ok',
        message:
          sources.length >= MIN_SOURCES
            ? `Профиль построен по ${sources.length} текстам.`
            : `Добавлено ${sources.length} из ${MIN_SOURCES} нужных текстов.`,
      });
    } finally {
      setBuilding(false);
    }
  };

  const rebuild = () => {
    if (!profile) return;
    setProfile({ ...profile, builtAt: Date.now() });
    pushToast({ kind: 'ok', message: 'Профиль пересчитан.' });
  };

  const exportProfile = () => {
    if (!profile) return;
    downloadBlob(JSON.stringify(profile, null, 2), 'style-profile.json', 'application/json');
    logEvent({ event: 'style-profile-change', object: 'профиль стиля', engine: '—', param: 'экспорт', result: 'ок' });
  };

  const sourcesCount = profile?.sources.length ?? 0;
  const ready = sourcesCount >= MIN_SOURCES;

  return (
    <ScreenShell
      title="Профиль стиля автора"
      subtitle="Приложение пишет вашей лексикой, а не усреднённым языком модели. Профиль хранится только локально."
      actions={
        <>
          <Button variant="secondary" size="sm" icon={<FileUp size={16} />} onClick={() => fileRef.current?.click()}>
            Загрузить тексты
          </Button>
          {profile && (
            <>
              <Button variant="ghost" size="sm" icon={<RefreshCw size={16} />} onClick={rebuild}>
                Пересчитать
              </Button>
              <Button variant="ghost" size="sm" icon={<Download size={16} />} onClick={exportProfile}>
                Экспорт профиля
              </Button>
              <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={() => setResetOpen(true)}>
                Сбросить
              </Button>
            </>
          )}
        </>
      }
    >
      {!ready ? (
        <EmptyState
          illustration="style-profile"
          title={`Загрузите ещё ${MIN_SOURCES - sourcesCount} ${plural(MIN_SOURCES - sourcesCount, 'текст', 'текста', 'текстов')}, чтобы я писал вашими словами`}
          description="Нужны ваши исходные тексты до обработки: главы, статьи, методички. Профиль не удаляется вместе с проектом."
          actions={
            <>
              <Button variant="primary" icon={<FileUp size={18} />} onClick={() => fileRef.current?.click()} disabled={building}>
                Загрузить тексты
              </Button>
              <Button variant="ghost" onClick={() => pushToast({ kind: 'info', message: 'Профиль можно включить позже.' })}>
                Пропустить
              </Button>
            </>
          }
        />
      ) : (
        <>
          <div className="profile-summary">
            <div className="profile-stat">
              <span className="profile-stat__value">{sourcesCount}</span>
              <span className="profile-stat__label">текстов в основе</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat__value">{profile?.avgSentenceLength ?? 0}</span>
              <span className="profile-stat__label">слов в предложении (среднее)</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat__value">{Math.round((profile?.complexShare ?? 0) * 100)}%</span>
              <span className="profile-stat__label">сложных предложений</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat__value">
                {profile?.targetRange[0]}–{profile?.targetRange[1]}
              </span>
              <span className="profile-stat__label">целевой диапазон длины</span>
            </div>
          </div>

          <div className="profile-grid">
            <section className="profile-card">
              <h2 className="profile-card__title">Слова-маркеры автора</h2>
              <p className="profile-card__desc">Топ слов, которые вы используете чаще среднего. Размер чипа — частота.</p>
              <div className="profile-cloud">
                {(profile?.topWords ?? []).slice(0, 80).map((w) => {
                  const max = profile?.topWords[0]?.count ?? 1;
                  const scale = 0.85 + (w.count / max) * 0.9;
                  return (
                    <span
                      key={w.word}
                      className="profile-word"
                      style={{ fontSize: `${scale}rem`, opacity: 0.55 + (w.count / max) * 0.45 }}
                      title={`${w.count} раз`}
                    >
                      {w.word}
                    </span>
                  );
                })}
              </div>
            </section>

            <section className="profile-card">
              <h2 className="profile-card__title">Вводные конструкции</h2>
              <p className="profile-card__desc">Обороты, которые встречаются в ваших текстах чаще всего.</p>
              <div className="profile-phrases">
                {(profile?.introPhrases ?? []).map((p) => (
                  <Chip key={p} kind="neutral">
                    {p}
                  </Chip>
                ))}
              </div>

              <h2 className="profile-card__title profile-card__title--gap">Источники</h2>
              <ul className="profile-sources">
                {(profile?.sources ?? []).map((s) => (
                  <li key={s.id} className="profile-source">
                    <span className="profile-source__name">{s.title}</span>
                    <span className="profile-source__meta">{s.chars.toLocaleString('ru-RU')} зн.</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <p className="profile-note">
            <Info size={14} /> Профиль не применяется к пресету F2 в части лексики: там приоритет — сокращение. К ритму
            предложений профиль применяется всегда.
          </p>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md"
        multiple
        className="visually-hidden"
        onChange={(e) => {
          if (e.target.files?.length) void addSources(e.target.files);
          e.target.value = '';
        }}
      />

      <Modal
        open={resetOpen}
        title="Сбросить профиль стиля?"
        onClose={() => setResetOpen(false)}
        icon={<Trash2 size={20} />}
        tone="bad"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setProfile(null);
                setResetOpen(false);
                logEvent({ event: 'style-profile-change', object: 'профиль стиля', engine: '—', param: 'сброс', result: 'ок' });
                pushToast({ kind: 'info', message: 'Профиль стиля сброшен.' });
              }}
            >
              Сбросить профиль
            </Button>
          </>
        }
      >
        <p>Профиль будет удалён, но тексты проектов останутся. Профиль можно построить заново из исходных текстов.</p>
      </Modal>
    </ScreenShell>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Построить/обновить профиль из текстов. */
function buildProfile(
  sources: StyleProfile['sources'],
  newTexts: string[],
  previous: StyleProfile | null,
): StyleProfile {
  const allText = newTexts.join('\n\n');
  const sentences = splitSentences(allText);
  const lengths = sentences.map((s) => s.split(/\s+/).length).filter((n) => n > 0);
  const avg = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const complex = lengths.filter((n) => n > 20).length;
  const complexShare = lengths.length > 0 ? complex / lengths.length : 0;

  const words = allText
    .toLowerCase()
    .replace(/[^а-яёa-z\s-]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200)
    .map(([word, count]) => ({ word, count }));

  const introPhrases = [
    'важно отметить',
    'следует подчеркнуть',
    'на наш взгляд',
    'как показывает практика',
    'в частности',
    'по мнению автора',
    'таким образом',
    'в связи с этим',
  ].filter((p) => allText.toLowerCase().includes(p));

  // Объединяем с предыдущим профилем, чтобы не терять статистику.
  const mergedTop = mergeTopWords(previous?.topWords ?? [], topWords);
  const mergedIntro = Array.from(new Set([...(previous?.introPhrases ?? []), ...introPhrases]));

  return {
    sources,
    avgSentenceLength: Math.round(avg * 10) / 10,
    complexShare,
    topWords: mergedTop,
    introPhrases: mergedIntro,
    targetRange: [Math.max(8, Math.round(avg * 0.7)), Math.round(avg * 1.4)],
    builtAt: Date.now(),
  };
}

function mergeTopWords(a: StyleProfile['topWords'], b: StyleProfile['topWords']): StyleProfile['topWords'] {
  const map = new Map<string, number>();
  for (const w of a) map.set(w.word, w.count);
  for (const w of b) map.set(w.word, (map.get(w.word) ?? 0) + w.count);
  return [...map.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 200)
    .map(([word, count]) => ({ word, count }));
}
