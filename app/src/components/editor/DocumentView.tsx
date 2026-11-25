/* ============================================================================
   DocumentView.tsx — область документа E1 (design.md §4.2, §5.13).
   Показывает текст крупным читаемым шрифтом, маркеры правок и защиты.
   ========================================================================== */

import { useMemo, type ReactNode } from 'react';
import type { Paragraph } from '../../core/types';
import './DocumentView.css';

export interface DocumentViewProps {
  paragraphs: Paragraph[];
  mode: 'edit' | 'result';
  fontSize: number;
  searchQuery: string;
  focusedId: string | null;
  showProtection: boolean;
  onFocusParagraph: (id: string) => void;
  onSelectText: (paragraphId: string, start: number, end: number, text: string) => void;
}

/** Подсветить совпадения поиска. */
function highlightSearch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (;;) {
    const idx = lower.indexOf(needle, from);
    if (idx === -1) {
      parts.push(text.slice(from));
      break;
    }
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark key={`m${key++}`} className="doc__mark">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    from = idx + q.length;
  }
  return parts;
}

/** Отрисовать текст с инлайн-маркерами защиты. */
function renderWithProtection(text: string, spans: Paragraph['protectedSpans'], enabled: boolean): ReactNode {
  if (!enabled || spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((s, i) => {
    if (s.start < cursor || s.end > text.length) return;
    if (s.start > cursor) nodes.push(text.slice(cursor, s.start));
    nodes.push(
      <span key={`p${i}`} className={`doc__protected doc__protected--${s.cls}`} title={`Защищено: ${s.text}`}>
        {text.slice(s.start, s.end)}
      </span>,
    );
    cursor = s.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function DocumentView({
  paragraphs,
  mode,
  fontSize,
  searchQuery,
  focusedId,
  showProtection,
  onFocusParagraph,
  onSelectText,
}: DocumentViewProps) {
  const handleMouseUp = (p: Paragraph) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString();
    if (!text.trim()) return;
    const range = sel.getRangeAt(0);
    const anchor = range.startContainer;
    const el = (anchor?.nodeType === 1 ? (anchor as HTMLElement) : anchor?.parentElement)?.closest(
      '[data-paragraph-id]',
    ) as HTMLElement | null;
    if (!el || el.dataset.paragraphId !== p.id) return;
    // Точное смещение выделения внутри абзаца (учитывая вложенные маркеры).
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    onSelectText(p.id, start, start + text.length, text);
  };

  const content = useMemo(
    () =>
      paragraphs.map((p) => {
        const body = mode === 'result' ? p.current : p.original;
        const isFocused = focusedId === p.id;
        let inner: ReactNode;
        if (searchQuery.trim()) {
          inner = highlightSearch(body, searchQuery);
        } else {
          inner = renderWithProtection(body, p.protectedSpans, showProtection);
        }
        return (
          <div
            key={p.id}
            data-paragraph-id={p.id}
            className={[
              'doc__block',
              `doc__block--${p.blockKind}`,
              isFocused ? 'doc__block--focused' : '',
              p.sense?.level === 'bad' ? 'doc__block--bad' : '',
              p.sense?.level === 'warn' ? 'doc__block--warn' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onFocusParagraph(p.id)}
            onMouseUp={() => handleMouseUp(p)}
          >
            {inner}
          </div>
        );
      }),
    [paragraphs, mode, focusedId, showProtection, searchQuery, onFocusParagraph],
  );

  return (
    <div className="doc" style={{ ['--doc-size' as string]: `${fontSize}px` }}>
      <div className="doc__sheet">{content}</div>
    </div>
  );
}
