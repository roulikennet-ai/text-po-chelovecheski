/* ============================================================================
   paragraphs.ts — разбор текста на абзацы и определение типа блока (FR-9.1).
   ========================================================================== */

import type { Paragraph } from './types';

let counter = 0;
/** Устойчивый id (не зависит от crypto.randomUUID для совместимости с WebView2). */
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const LIST_MARKER_RE = /^\s*(?:[-–—•*·▪◦●]|\d{1,3}[.)]|[а-яёa-z][.)])\s+/i;
const HEADING_RE = /^\s*(?:#{1,6}\s+|(?:ГЛАВА|Глава|РАЗДЕЛ|Раздел|ПАРАГРАФ|Параграф)\s+[\dIVXLCА-Я]+)/;
const QUOTE_RE = /^\s*>/;

/** Строка похожа на заголовок без явного маркера: короткая, без точки в конце. */
function looksLikePlainHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (/[.!?;:,]$/.test(t)) return false;
  if (/[.!?]\s/.test(t)) return false; // внутри есть законченное предложение
  const words = t.split(/\s+/);
  if (words.length > 8) return false;
  return /^[А-ЯЁA-Z0-9]/.test(t);
}

/** Определить тип блока по тексту строки. */
export function detectBlockKind(line: string): { kind: Paragraph['blockKind']; headingLevel?: number; listLevel?: number } {
  const headingMatch = /^\s*(#{1,6})\s+/.exec(line);
  if (headingMatch) {
    return { kind: 'heading', headingLevel: headingMatch[1].length };
  }
  if (HEADING_RE.test(line)) {
    return { kind: 'heading', headingLevel: 1 };
  }
  if (QUOTE_RE.test(line)) {
    return { kind: 'quote' };
  }
  if (LIST_MARKER_RE.test(line)) {
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    return { kind: 'list-item', listLevel: Math.min(3, Math.floor(indent / 2)) };
  }
  if (looksLikePlainHeading(line)) {
    return { kind: 'heading', headingLevel: 2 };
  }
  return { kind: 'paragraph' };
}

/** Убрать маркер списка из строки (для обработки содержимого). */
export function stripListMarker(line: string): string {
  return line.replace(LIST_MARKER_RE, '');
}

/**
 * Разбить текст на абзацы.
 * Правило: пустая строка — разделитель. Строки внутри одного блока склеиваются.
 * Для DOCX-импорта разбиение задаётся структурой документа (см. docx.ts).
 */
export function splitIntoParagraphs(raw: string): Paragraph[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const blocks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join('\n').trim();
    if (joined) blocks.push(joined);
    buffer = [];
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    const kind = detectBlockKind(line);
    // Заголовок, элемент списка и цитата всегда начинают новый блок.
    if (kind.kind !== 'paragraph' && buffer.length > 0) {
      flush();
    }
    buffer.push(line);
  }
  flush();

  return blocks.map((block) => {
    const kind = detectBlockKind(block);
    const content = kind.kind === 'list-item' ? stripListMarker(block) : block;
    return {
      id: uid('p'),
      original: content,
      current: content,
      variants: [],
      status: 'original' as const,
      protectedSpans: [],
      blockKind: kind.kind,
      headingLevel: kind.headingLevel,
      listLevel: kind.listLevel,
    };
  });
}

/** Собрать абзацы обратно в текст (для экспорта TXT). */
export function joinParagraphs(paragraphs: Paragraph[], useCurrent = true): string {
  return paragraphs
    .map((p) => {
      const body = useCurrent ? p.current : p.original;
      if (p.blockKind === 'heading') {
        return `${'#'.repeat(Math.min(6, p.headingLevel ?? 1))} ${body}`;
      }
      if (p.blockKind === 'list-item') {
        return `- ${body}`;
      }
      if (p.blockKind === 'quote') {
        return `> ${body}`;
      }
      return body;
    })
    .join('\n\n');
}

/** Подсчёт знаков: с пробелами и без (FR-11.1). */
export function countChars(text: string): { withSpaces: number; withoutSpaces: number } {
  return {
    withSpaces: text.length,
    withoutSpaces: text.replace(/\s/g, '').length,
  };
}

/** Страницы по 1800 знаков (ТЗ §6.2). */
export const CHARS_PER_PAGE = 1800;

export function pagesOf(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_PAGE));
}

/** Есть ли в абзаце маркированный список (для H1). */
export function isListParagraph(p: Paragraph): boolean {
  return p.blockKind === 'list-item';
}
