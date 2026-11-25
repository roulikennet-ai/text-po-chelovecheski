/* ============================================================================
   ExportScreen.tsx — E9 «Экспорт» (design.md §6).
   В экспорт не попадают служебные метки (FR-9.5).
   ========================================================================== */

import { useMemo, useState } from 'react';
import { FileText, FileType, FileCode2, Download, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { exportDocx, exportMarkdown, exportTxt } from '../core/exporters';
import './ExportScreen.css';

type Format = 'docx' | 'txt' | 'md';

const FORMATS: Array<{
  id: Format;
  icon: typeof FileText;
  name: string;
  desc: string;
  bullets: string[];
}> = [
  {
    id: 'docx',
    icon: FileType,
    name: 'DOCX',
    desc: 'Документ Word, готовый к вставке в работу',
    bullets: ['Шрифт Times New Roman 14 pt', 'Интерлиньяж 1,5', 'Стили заголовков и списков', 'Поля по ГОСТ'],
  },
  {
    id: 'txt',
    icon: FileText,
    name: 'Чистый текст',
    desc: 'Только текст, без оформления',
    bullets: ['Абзацы через пустую строку', 'Кодировка UTF-8', 'Удобно для вставки куда угодно'],
  },
  {
    id: 'md',
    icon: FileCode2,
    name: 'Markdown',
    desc: 'Для вики, заметок и GitHub',
    bullets: ['Заголовки через #', 'Списки и цитаты', 'Совместимо с большинством редакторов'],
  },
];

export function ExportScreen() {
  const { project, runSettings, createSnapshot, logEvent, pushToast } = useStore();
  const [format, setFormat] = useState<Format>('docx');
  const [badOpen, setBadOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const paragraphs = project?.paragraphs ?? [];
  const badParagraphs = useMemo(
    () => paragraphs.filter((p) => p.sense?.level === 'bad' && p.status !== 'accepted'),
    [paragraphs],
  );
  const accepted = paragraphs.filter((p) => p.status === 'accepted').length;

  if (paragraphs.length === 0) {
    return (
      <ScreenShell title="Экспорт" subtitle="Сохранить результат">
        <EmptyState
          illustration="doc-empty"
          title="Нечего экспортировать"
          description="Сначала загрузите и обработайте текст."
        />
      </ScreenShell>
    );
  }

  const doExport = async (force = false) => {
    if (!project) return;
    // FR-7.5: экспорт с 🔴 возможен только после подтверждения.
    if (badParagraphs.length > 0 && !force) {
      setBadOpen(true);
      return;
    }
    setBusy(true);
    try {
      createSnapshot('export', `Экспорт ${format.toUpperCase()}`);
      const title = project.title || 'документ';
      if (format === 'docx') {
        await exportDocx(paragraphs, title);
      } else if (format === 'txt') {
        exportTxt(paragraphs, title);
      } else {
        exportMarkdown(paragraphs, title);
      }
      logEvent({
        event: 'export',
        object: `проект ${project.id.slice(-4)}`,
        engine: runSettings.engine,
        param: format.toUpperCase(),
        result: badParagraphs.length > 0 ? `с ${badParagraphs.length} 🔴 (подтверждено)` : 'ок',
      });
      pushToast({ kind: 'ok', message: `Файл ${format.toUpperCase()} сохранён.` });
      setBadOpen(false);
    } catch (e) {
      pushToast({ kind: 'bad', message: `Ошибка экспорта: ${(e as Error).message}` });
      logEvent({ event: 'error', object: 'экспорт', engine: runSettings.engine, param: format, result: 'ошибка' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenShell
      title="Экспорт"
      subtitle="В файл попадает только текст: подсветка правок и статусы не экспортируются"
      actions={
        <Chip kind={accepted > 0 ? 'ok' : 'neutral'}>
          принято абзацев: {accepted} из {paragraphs.length}
        </Chip>
      }
    >
      {badParagraphs.length > 0 && (
        <div className="export-warn">
          <AlertTriangle size={18} />
          <div>
            <strong>{badParagraphs.length} абзацев с потерей фактов</strong>
            <p>
              Экспорт заблокирован до вашего решения. Откройте отчёт смысла и примите абзацы осознанно либо повторите их.
            </p>
          </div>
        </div>
      )}

      <div className="export-formats">
        {FORMATS.map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.id}
              className={`export-card${format === f.id ? ' export-card--active' : ''}`}
              onClick={() => setFormat(f.id)}
              aria-pressed={format === f.id}
            >
              <span className="export-card__icon">
                <Icon size={24} />
              </span>
              <span className="export-card__name">{f.name}</span>
              <span className="export-card__desc">{f.desc}</span>
              <ul className="export-card__bullets">
                {f.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <div className="export-preview">
        <div className="export-preview__head">
          <h2 className="export-preview__title">Предпросмотр</h2>
          <span className="export-preview__note">
            <ShieldCheck size={14} /> служебные метки скрыты
          </span>
        </div>
        <div className="export-preview__sheet">
          {paragraphs.slice(0, 12).map((p) => (
            <p key={p.id} className={`export-preview__p export-preview__p--${p.blockKind}`}>
              {p.status === 'rejected' ? p.original : p.current}
            </p>
          ))}
          {paragraphs.length > 12 && <p className="export-preview__more">…и ещё {paragraphs.length - 12} абзацев</p>}
        </div>
      </div>

      <div className="export-actions">
        <Button
          variant="primary"
          size="lg"
          icon={<Download size={18} />}
          onClick={() => void doExport()}
          disabled={busy}
        >
          Скачать {FORMATS.find((f) => f.id === format)?.name}
        </Button>
      </div>

      <Modal
        open={badOpen}
        title="В файле есть абзацы с потерей фактов"
        onClose={() => setBadOpen(false)}
        icon={<AlertTriangle size={20} />}
        tone="bad"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBadOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={() => void doExport(true)}>
              Экспортировать всё равно
            </Button>
          </>
        }
      >
        <p>
          В {badParagraphs.length} абзацах не найдены числа или имена из исходника. Это может быть ошибка проверки, но
          может быть и реальная потеря данных. Проверьте их в отчёте смысла перед сдачей работы.
        </p>
        <ul className="export-bad-list">
          {badParagraphs.slice(0, 5).map((p) => (
            <li key={p.id}>{p.sense?.issues[0]?.message ?? 'Проверьте абзац вручную'}</li>
          ))}
        </ul>
      </Modal>
    </ScreenShell>
  );
}
