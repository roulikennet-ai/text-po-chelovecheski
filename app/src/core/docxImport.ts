/* ============================================================================
   docxImport.ts — импорт DOCX (FR-9.1) и текстовых файлов.
   Разбирает word/document.xml: заголовки по стилям, списки, цитаты.
   Полноценный round-trip — этап MVP; здесь — корректное чтение структуры.
   ========================================================================== */

import type { Paragraph } from './types';
import { uid } from './paragraphs';

/** Прочитать файл как ArrayBuffer. */
export function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/** Прочитать файл как текст (UTF-8 с BOM или без). */
export function readFileText(file: File): Promise<string> {
  return file.text().then((t) => t.replace(/^\uFEFF/, ''));
}

/** Разбор ZIP (stored + deflate) для извлечения word/document.xml. */
async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const files = new Map<string, Uint8Array>();

  // Найти End of Central Directory.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Файл не является корректным DOCX (ZIP).');

  const entryCount = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // Local header.
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compData = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      files.set(name, compData);
    } else if (method === 8) {
      try {
        files.set(name, await inflateRaw(compData));
      } catch {
        /* пропускаем нечитаемые части */
      }
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

/** Распаковка raw deflate через DecompressionStream. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Извлечь текст из <w:t>, разбить на абзацы <w:p>. */
function parseDocumentXml(xml: string): Paragraph[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const paragraphs = Array.from(doc.getElementsByTagNameNS(ns, 'p'));
  const result: Paragraph[] = [];

  for (const pEl of paragraphs) {
    const runs = Array.from(pEl.getElementsByTagNameNS(ns, 't'));
    const text = runs.map((t) => t.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    // Стиль абзаца.
    const pPr = pEl.getElementsByTagNameNS(ns, 'pPr')[0];
    const styleEl = pPr?.getElementsByTagNameNS(ns, 'pStyle')[0];
    const styleId = styleEl?.getAttributeNS(ns, 'val') ?? '';
    const numPr = pPr?.getElementsByTagNameNS(ns, 'numPr')[0];
    const isList = Boolean(numPr);

    let blockKind: Paragraph['blockKind'] = 'paragraph';
    let headingLevel: number | undefined;

    const headingMatch = /^Heading(\d)$/i.exec(styleId) ?? /^heading\s*(\d)$/i.exec(styleId);
    if (headingMatch) {
      blockKind = 'heading';
      headingLevel = Number(headingMatch[1]);
    } else if (/Заголовок|Title/i.test(styleId)) {
      blockKind = 'heading';
      headingLevel = 1;
    } else if (isList) {
      blockKind = 'list-item';
    } else if (/Quote|Цитата/i.test(styleId)) {
      blockKind = 'quote';
    } else if (/^\d+([.)])\s/.test(text) || /^[-–—•*·▪◦●]\s/.test(text)) {
      blockKind = 'list-item';
    }

    result.push({
      id: uid('p'),
      original: text,
      current: text,
      variants: [],
      status: 'original',
      protectedSpans: [],
      blockKind,
      headingLevel,
      listLevel: 0,
      ordered: false,
    });
  }

  return result;
}

/** Импорт DOCX → абзацы. */
export async function importDocx(file: File): Promise<{ paragraphs: Paragraph[]; base64: string }> {
  const buffer = await readFileBuffer(file);
  const files = await unzip(buffer);
  const docXmlBytes = files.get('word/document.xml');
  if (!docXmlBytes) {
    throw new Error('В файле нет word/document.xml — это не DOCX.');
  }
  const xml = new TextDecoder('utf-8').decode(docXmlBytes);
  const paragraphs = parseDocumentXml(xml);
  const base64 = await bufferToBase64(buffer);
  return { paragraphs, base64 };
}

/** ArrayBuffer → base64 (для хранения неизменяемого эталона). */
export async function bufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Поддерживаемые расширения. */
export const SUPPORTED_EXTENSIONS = ['.docx', '.txt', '.md'] as const;

export function isSupportedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
