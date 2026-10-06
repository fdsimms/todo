/**
 * The small slice of Markdown a journal entry is drawn with — see
 * `docs/arch/journal.md`.
 *
 * Entries are stored as the plain text typed, so search, sync, export and the
 * MCP tools never see anything but what the person wrote; this only decides
 * how that text is drawn when read back. It is deliberately a slice rather
 * than a Markdown implementation: headings (`#`, `##`), bullets (`-`, `*`),
 * numbered items (`1.`), quotes (`>`), `**bold**` and `*italics*` (or
 * `_italics_`). Anything else is left as the characters typed, which is the
 * right failure: a stray asterisk shows as an asterisk, never as text that
 * vanished into a style.
 */

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type JournalBlock =
  | { type: 'heading'; level: 1 | 2; spans: InlineSpan[] }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'quote'; spans: InlineSpan[] }
  | { type: 'bullet'; spans: InlineSpan[] }
  | { type: 'numbered'; number: number; spans: InlineSpan[] };

/**
 * `**bold**`, `*italic*` and `_italic_` within one line. A marker with no
 * closing partner on the line is ordinary text, and so is one wrapped round
 * nothing but spaces.
 */
export function parseInline(line: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let plain = '';
  const flush = () => {
    if (plain) spans.push({ text: plain });
    plain = '';
  };
  let i = 0;
  while (i < line.length) {
    const marker = line.startsWith('**', i) ? '**' : line[i] === '*' || line[i] === '_' ? line[i] : null;
    if (marker) {
      const close = line.indexOf(marker, i + marker.length);
      const inner = close === -1 ? '' : line.slice(i + marker.length, close);
      // An underscore inside a word (snake_case) is not emphasis.
      const midWord = marker === '_' && i > 0 && /\w/.test(line[i - 1]);
      if (close !== -1 && inner.trim() && inner === inner.trim() && !midWord) {
        flush();
        spans.push(marker === '**' ? { text: inner, bold: true } : { text: inner, italic: true });
        i = close + marker.length;
        continue;
      }
    }
    plain += line[i];
    i++;
  }
  flush();
  return spans;
}

/**
 * The text as blocks, one per line, except that consecutive plain lines join
 * into one paragraph (with the line break kept) and a blank line ends it.
 */
export function parseJournalMarkdown(text: string): JournalBlock[] {
  const blocks: JournalBlock[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', spans: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };
  for (const line of text.split('\n')) {
    let m: RegExpExecArray | null;
    if (!line.trim()) { endParagraph(); continue; }
    if ((m = /^(#{1,2})\s+(.*)$/.exec(line))) {
      endParagraph();
      blocks.push({ type: 'heading', level: m[1].length as 1 | 2, spans: parseInline(m[2]) });
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      endParagraph();
      blocks.push({ type: 'bullet', spans: parseInline(m[1]) });
    } else if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) {
      endParagraph();
      blocks.push({ type: 'numbered', number: Number(m[1]), spans: parseInline(m[2]) });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      endParagraph();
      blocks.push({ type: 'quote', spans: parseInline(m[1]) });
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  return blocks;
}

/**
 * The text with its markers taken out, for anywhere drawing styles is wrong:
 * a screen reader's label, and a clipped preview (`numberOfLines`) where a
 * half-shown list would read worse than a line of prose.
 */
export function journalPlainText(text: string): string {
  return parseJournalMarkdown(text)
    .map(block => {
      const words = block.spans.map(s => s.text).join('');
      if (block.type === 'bullet') return `• ${words}`;
      if (block.type === 'numbered') return `${block.number}. ${words}`;
      return words;
    })
    .join('\n');
}

// ==== editing: what the formatting bar's buttons do to the text ====

/** A selection over the text, in the shape `TextInput` reports one. */
export interface EditSelection {
  start: number;
  end: number;
}

export interface FormatEdit {
  text: string;
  selection: EditSelection;
}

function clamp(selection: EditSelection, length: number): EditSelection {
  const a = Math.min(Math.max(selection.start, 0), length);
  const b = Math.min(Math.max(selection.end, 0), length);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * Bold or italic around the selection, as the bar's B and I buttons do.
 *
 * - **Text selected:** wrapped in the marker and left selected, so a second
 *   tap undoes it. Already wrapped (the markers sit just outside or just
 *   inside the selection) unwraps instead.
 * - **Nothing selected:** the pair is inserted with the caret between them,
 *   ready to type into. A caret already between an empty pair removes it.
 *
 * Spaces at the edges of a selection stay outside the markers, since
 * `parseInline` refuses emphasis wrapped round a space (a double-tap on a word
 * often takes the space after it too).
 */
export function toggleWrap(text: string, selection: EditSelection, marker: '**' | '*'): FormatEdit {
  const { start, end } = clamp(selection, text.length);
  const n = marker.length;
  // The other marker shares this one's character, so "*" must not read the
  // inner star of a "**" as its own.
  const isMarker = (at: number) =>
    text.slice(at, at + n) === marker && (marker === '**' || (text[at - 1] !== '*' && text[at + 1] !== '*'));

  if (start === end) {
    // An empty pair is matched as a whole: for "*" it reads like a bold marker.
    if (start >= n && text.slice(start - n, start + n) === marker + marker) {
      return { text: text.slice(0, start - n) + text.slice(start + n), selection: { start: start - n, end: start - n } };
    }
    return { text: text.slice(0, start) + marker + marker + text.slice(start), selection: { start: start + n, end: start + n } };
  }

  // Already wrapped, the markers outside the selection.
  if (start >= n && isMarker(start - n) && isMarker(end)) {
    return {
      text: text.slice(0, start - n) + text.slice(start, end) + text.slice(end + n),
      selection: { start: start - n, end: end - n },
    };
  }
  // Already wrapped, the markers selected along with the words.
  const picked = text.slice(start, end);
  if (picked.length > n * 2 && isMarker(start) && isMarker(end - n)) {
    const inner = picked.slice(n, -n);
    return { text: text.slice(0, start) + inner + text.slice(end), selection: { start, end: start + inner.length } };
  }

  const lead = picked.length - picked.trimStart().length;
  const trail = picked.length - picked.trimEnd().length;
  const from = start + lead;
  const to = end - trail;
  if (from >= to) return { text, selection: { start, end } };
  return {
    text: text.slice(0, from) + marker + text.slice(from, to) + marker + text.slice(to),
    selection: { start: from + n, end: to + n },
  };
}

export type LineFormat = 'heading' | 'bullet' | 'numbered' | 'quote';

const LINE_PREFIX = /^(#{1,2}\s+|\s*[-*]\s+|\s*\d{1,3}[.)]\s+|>\s?)/;

function prefixKind(line: string): LineFormat | null {
  const m = LINE_PREFIX.exec(line);
  if (!m) return null;
  if (m[1].startsWith('#')) return 'heading';
  if (m[1].startsWith('>')) return 'quote';
  return /\d/.test(m[1]) ? 'numbered' : 'bullet';
}

/**
 * A heading, bullet, numbered item or quote on every line the selection
 * touches, as the bar's line buttons do.
 *
 * If every touched line already has that format, it comes off all of them;
 * otherwise each line gets it, replacing whatever line format it had (a bullet
 * turned into a numbered item, not "1. - walk"). Numbered lines are numbered
 * from 1 in order. A blank line inside the selection is left blank. The
 * selection is kept over the same words.
 */
export function toggleLinePrefix(text: string, selection: EditSelection, format: LineFormat): FormatEdit {
  const { start, end } = clamp(selection, text.length);
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const touched = lines.filter(l => l.trim());
  const allHave = touched.length > 0 && touched.every(l => prefixKind(l) === format);

  let number = 0;
  let shift = 0; // how far the original start moved
  const out = lines.map((line, i) => {
    const existing = LINE_PREFIX.exec(line)?.[1] ?? '';
    const body = line.slice(existing.length);
    let prefix = '';
    if (line.trim() && !allHave) {
      if (format === 'heading') prefix = '# ';
      else if (format === 'bullet') prefix = '- ';
      else if (format === 'quote') prefix = '> ';
      else prefix = `${++number}. `;
    }
    const replaced = line.trim() ? prefix + body : line;
    if (i === 0) shift = replaced.length - line.length;
    return replaced;
  });
  const block = out.join('\n');
  const delta = block.length - (lineEnd - lineStart);
  const newStart = Math.max(lineStart, start + shift);
  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    selection: { start: newStart, end: Math.max(newStart, end + delta) },
  };
}
