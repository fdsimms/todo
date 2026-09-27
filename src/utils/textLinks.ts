/**
 * Splits free text into plain runs and web links, so a note can draw the links
 * as tappable. Only http(s): an app scheme in a note is rare, and a stray
 * "note://" typed as prose shouldn't turn into something that opens an app.
 *
 * Trailing sentence punctuation stays outside the link ("see
 * https://tiles.example.com." links without the period), the same trim quick
 * add's own URL pick-up applies.
 */
export interface TextSegment {
  text: string;
  /** Set when this run is a link; the text is the link as written. */
  url?: string;
}

const LINK = /https?:\/\/[^\s<>"]+/gi;
const TRAILING = /[.,;:!?)\]'"]+$/;

export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    let url = match[0];
    const trailing = url.match(TRAILING)?.[0] ?? '';
    if (trailing) url = url.slice(0, url.length - trailing.length);
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: url, url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
