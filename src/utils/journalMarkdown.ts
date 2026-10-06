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
