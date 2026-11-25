/* ============================================================================
   Ribbon.tsx — лента E1 (design.md §5.2).
   Группы: Файл · Обработка · Правки · Вид · Проект.
   Кнопки компактные (иконка + подсказка), чтобы лента умещалась на экране
   без горизонтальной прокрутки; при нехватке ширины группы переносятся.
   ========================================================================== */

import {
  ClipboardPaste,
  FileDown,
  FileUp,
  FilePlus2,
  FolderOpen,
  Play,
  Pause,
  Square,
  Check,
  CheckCheck,
  X,
  Shield,
  Eye,
  Search,
  Type,
  Columns2,
  History,
  Settings,
  ListChecks,
  Menu,
  ArrowUp,
  ArrowDown,
  UserRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../../state/AppStore';
import { Button, IconButton } from '../ui/Button';
import './Ribbon.css';

export interface RibbonProps {
  onPaste: () => void;
  onImport: () => void;
  onNewProject: () => void;
  onExport: () => void;
  onRun: () => void;
  onPause: () => void;
  onStop: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptCurrent: () => void;
  onRejectCurrent: () => void;
  onNextParagraph: () => void;
  onPrevParagraph: () => void;
  onToggleSearch: () => void;
  onToggleLargeFont: () => void;
  onTogglePanel: () => void;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon__group">
      <div className="ribbon__group-body">{children}</div>
      <span className="ribbon__group-label">{label}</span>
    </div>
  );
}

export function Ribbon(props: RibbonProps) {
  const { project, ui, setUi, batch, createSnapshot, logEvent } = useStore();
  const hasProject = Boolean(project && project.paragraphs.length > 0);
  const hasResult = Boolean(project?.paragraphs.some((p) => p.status !== 'original'));

  return (
    <header className="ribbon">
      <div className="ribbon__brand">
        <IconButton label="Свернуть или развернуть панель настроек" onClick={props.onTogglePanel}>
          <Menu size={18} />
        </IconButton>
        <div className="ribbon__logo" aria-hidden="true">
          <span className="ribbon__logo-mark">Т</span>
          <span className="ribbon__logo-text">Текст по-человечески</span>
        </div>
      </div>

      <div className="ribbon__groups">
        <Group label="Файл">
          <Button variant="ghost" size="sm" icon={<ClipboardPaste size={16} />} onClick={props.onPaste}>
            Вставить
          </Button>
          <IconButton label="Импорт DOCX" onClick={props.onImport}>
            <FileUp size={16} />
          </IconButton>
          <IconButton label="Экспорт" onClick={props.onExport} disabled={!hasProject}>
            <FileDown size={16} />
          </IconButton>
          <IconButton
            label="Новый файл: закрыть проект и загрузить другой"
            onClick={props.onNewProject}
            disabled={!hasProject}
          >
            <FilePlus2 size={16} />
          </IconButton>
        </Group>

        <Group label="Обработка">
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={16} />}
            onClick={props.onRun}
            disabled={!hasProject || batch.running}
          >
            Запустить
          </Button>
          <IconButton
            label={batch.paused ? 'Продолжить обработку' : 'Пауза'}
            onClick={props.onPause}
            disabled={!batch.running}
            active={batch.paused}
          >
            {batch.paused ? <Play size={16} /> : <Pause size={16} />}
          </IconButton>
          <IconButton label="Стоп (Esc)" onClick={props.onStop} disabled={!batch.running}>
            <Square size={16} />
          </IconButton>
        </Group>

        <Group label="Правки">
          <IconButton label="Предыдущий абзац" onClick={props.onPrevParagraph} disabled={!hasResult}>
            <ArrowUp size={16} />
          </IconButton>
          <IconButton label="Следующий абзац" onClick={props.onNextParagraph} disabled={!hasResult}>
            <ArrowDown size={16} />
          </IconButton>
          <IconButton label="Принять текущий абзац (Ctrl+Y)" onClick={props.onAcceptCurrent} disabled={!hasResult}>
            <Check size={16} />
          </IconButton>
          <IconButton
            label="Принять всё (Ctrl+Shift+Y)"
            onClick={props.onAcceptAll}
            disabled={!hasResult}
          >
            <CheckCheck size={16} />
          </IconButton>
          <IconButton label="Отклонить всё" onClick={props.onRejectAll} disabled={!hasResult}>
            <X size={16} />
          </IconButton>
        </Group>

        <Group label="Вид">
          <IconButton
            label="Было / стало"
            active={ui.viewMode === 'compare'}
            onClick={() => setUi({ viewMode: ui.viewMode === 'compare' ? 'edit' : 'compare' })}
            disabled={!hasResult}
          >
            <Columns2 size={16} />
          </IconButton>
          <IconButton
            label={ui.viewMode === 'result' ? 'Показать с правками' : 'Только результат'}
            active={ui.viewMode === 'result'}
            onClick={() => setUi({ viewMode: ui.viewMode === 'result' ? 'edit' : 'result' })}
          >
            <Eye size={16} />
          </IconButton>
          <IconButton label="Крупный шрифт" active={ui.largeFont} onClick={props.onToggleLargeFont}>
            <Type size={16} />
          </IconButton>
          <IconButton label="Поиск по тексту (Ctrl+F)" active={ui.searchOpen} onClick={props.onToggleSearch}>
            <Search size={16} />
          </IconButton>
        </Group>

        <Group label="Проект">
          <IconButton
            label="Защищённые фрагменты"
            onClick={() => setUi({ screen: 'protection' })}
            disabled={!hasProject}
          >
            <Shield size={16} />
          </IconButton>
          <IconButton label="Отчёт смысла" onClick={() => setUi({ screen: 'sense' })} disabled={!hasResult}>
            <ListChecks size={16} />
          </IconButton>
          <IconButton
            label="История версий"
            onClick={() => {
              setUi({ screen: 'history' });
              createSnapshot('manual', 'Открытие истории');
            }}
            disabled={!hasProject}
          >
            <History size={16} />
          </IconButton>
          <IconButton label="Журнал действий" onClick={() => setUi({ screen: 'audit' })}>
            <FolderOpen size={16} />
          </IconButton>
          <IconButton label="Личный кабинет" onClick={() => setUi({ screen: 'account' })}>
            <UserRound size={16} />
          </IconButton>
          <IconButton
            label="Настройки"
            onClick={() => {
              setUi({ screen: 'settings' });
              logEvent({ event: 'settings', object: 'Настройки', engine: '—', param: 'открытие', result: 'ok' });
            }}
          >
            <Settings size={16} />
          </IconButton>
        </Group>
      </div>
    </header>
  );
}
