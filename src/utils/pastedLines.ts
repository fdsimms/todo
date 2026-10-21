/**
 * A pasted list's lines, without the bullets it often carries ("- ", "• ",
 * "1. ", "[ ] "), and with blank lines dropped. Every field that turns a
 * pasted list into one row per line reads it through this, so a list copied
 * from Notes comes out the same wherever it lands.
 */
export function cleanPastedLines(raw: string[]): string[] {
  return raw.map(l => l.replace(/^\s*(?:[-*•◦▪]|\d+[.)]|\[[ xX]?\])\s+/, '').trim()).filter(Boolean);
}
