/**
 * Arithmetic typed into an amount field: "120 - 50" for an apple weighed before
 * and after eating it, "100 + 35" for two things on one scale.
 *
 * Only `+`, `-` and `*` (or `x`/`×`) are read. `/` is deliberately not an
 * operator, because "1/2 cup" is a fraction the quantity parser already reads
 * exactly and 0.5 would lose "1/3". A result that is not above zero leaves the
 * text alone, so a range like "2-3" still reaches the quantity parser as a
 * range rather than becoming -1.
 */

type Token = number | '+' | '-' | '*';

function tokenize(text: string): Token[] | null {
  const out: Token[] = [];
  const pattern = /\s*(?:(\d+(?:[.,]\d+)?|[.,]\d+)|([+\-*x×−–]))/gy;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while (consumed < text.length && (match = pattern.exec(text)) !== null) {
    consumed = pattern.lastIndex;
    if (match[1] !== undefined) out.push(Number(match[1].replace(',', '.')));
    else {
      const op = match[2];
      out.push(op === '+' ? '+' : op === '-' || op === '−' || op === '–' ? '-' : '*');
    }
  }
  return text.slice(consumed).trim() === '' ? out : null;
}

/**
 * The result of an arithmetic expression as plain number text, or `text`
 * unchanged when it is not one (a plain number, a unit, a fraction, a range).
 */
export function resolveAmountMath(text: string): string {
  const tokens = tokenize(text.trim());
  if (!tokens || tokens.length < 3 || typeof tokens[0] !== 'number') return text;

  // Products first, then a left-to-right sum.
  const terms: number[] = [];
  const signs: number[] = [];
  let sign = 1;
  let product = tokens[0];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const next = tokens[i + 1];
    if (typeof op === 'number' || typeof next !== 'number') return text;
    if (op === '*') { product *= next; continue; }
    terms.push(product);
    signs.push(sign);
    sign = op === '+' ? 1 : -1;
    product = next;
  }
  terms.push(product);
  signs.push(sign);

  const total = terms.reduce((sum, term, i) => sum + signs[i] * term, 0);
  if (!Number.isFinite(total) || !(total > 0)) return text;
  return String(Math.round(total * 100) / 100);
}
