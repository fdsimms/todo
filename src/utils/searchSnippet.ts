/**
 * The part of a written entry a Search result is allowed to show: the word that
 * matched, with a little of the text either side that the row draws as a solid
 * block (see `SearchSnippet`). Search results are visible to anyone glancing at
 * the phone, and the journal is the most private text in the app, so a hit
 * says what it matched and nothing else.
 */
export interface HiddenSnippet {
  /** Text before the match, drawn hidden. Starts with "…" when the entry goes on before it. */
  before: string;
  /** The matched word, as it was written. The only part shown. */
  match: string;
  /** Text after the match, drawn hidden. Ends with "…" when the entry goes on after it. */
  after: string;
}

/** How many characters either side of the match are kept. */
export const SNIPPET_CONTEXT = 24;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The first place any of `terms` (lowercase, as `menuSearchTerms` returns
 * them) appears in `text`, or null when none does. A null is a real answer:
 * the caller read the entry through `journalPlainText`, which replaces a
 * `||spoiler||` with "[hidden]", so a word that matched only inside a spoiler
 * is not in `text` and must not be shown.
 */
export function hiddenSnippet(text: string, terms: readonly string[], context: number = SNIPPET_CONTEXT): HiddenSnippet | null {
  const wanted = terms.filter(t => t.length > 0);
  if (wanted.length === 0) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  const found = new RegExp(wanted.map(escapeRegExp).join('|'), 'i').exec(flat);
  if (!found) return null;
  const start = found.index;
  const end = start + found[0].length;
  return {
    before: `${start > context ? '…' : ''}${flat.slice(Math.max(0, start - context), start)}`,
    match: found[0],
    after: `${flat.slice(end, end + context)}${end + context < flat.length ? '…' : ''}`,
  };
}
