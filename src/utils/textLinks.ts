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

/**
 * A typed or pasted link, read as a label and a url: "Booking
 * https://air.example.com/r/123" is labelled "Booking", a bare url has no
 * label, and a bare domain ("tiles.example.com/sale") gets its https://.
 * Null when there's no link in it at all.
 */
export function parseLabelledLink(raw: string): { label: string; url: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const linked = splitLinks(text);
  const first = linked.findIndex(s => s.url);
  if (first >= 0) {
    // The words around the first link, with any further links left out: a
    // second URL is not part of the first one's name.
    const label = linked
      .filter(s => !s.url)
      .map(s => s.text)
      .join('')
      .replace(/\s+/g, ' ')
      .replace(/[\s:–-]+$/, '')
      .trim();
    return { label, url: linked[first].url! };
  }
  // No scheme: a single word that ends in a real top-level domain, optionally
  // with a path. The list is what keeps "Node.js", "v1.2" and "3.14" as the
  // words they are rather than links to nowhere.
  const bare = text.match(/^((?:[a-z0-9-]+\.)+([a-z]{2,}))(\/\S*)?$/i);
  if (bare && BARE_TLDS.has(bare[2].toLowerCase())) return { label: '', url: `https://${text}` };
  return null;
}

/** Top-level domains a bare "example.com" may end in to be read as a link. */
const BARE_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'app', 'dev', 'me', 'info', 'biz',
  'shop', 'store', 'blog', 'site', 'online', 'tv', 'ly', 'gl', 'ai',
  'us', 'uk', 'ca', 'au', 'nz', 'ie', 'de', 'fr', 'es', 'it', 'nl', 'be', 'ch', 'at',
  'se', 'no', 'dk', 'fi', 'pt', 'pl', 'jp', 'kr', 'in', 'mx', 'br',
]);

/** What a link is called when it has no label: its host, without "www.". */
export function linkHost(url: string): string {
  const match = url.match(/^[a-z]+:\/\/([^/?#]+)/i);
  return (match ? match[1] : url).replace(/^www\./i, '');
}
