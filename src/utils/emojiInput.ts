/**
 * "One emoji" is not "one character".
 *
 * A category's emoji stands in for it everywhere — a task row, a stack header,
 * the Logbook — all of which reserve room for a single glyph. But an emoji is
 * a *grapheme cluster*, not a code point: 👍🏽 is a base plus a skin tone,
 * ❤️ is a base plus a variation selector, 🧑‍💻 is two bases joined by a
 * zero-width joiner, and 🇬🇧 is a pair of regional indicators. So a JS-length
 * cap can't tell "one emoji" from "two" — `maxLength={4}` let 🔥🧺 through
 * (2 UTF-16 units each) while cutting 🧑‍💻 in half.
 *
 * `firstEmoji()` is the cap instead: it walks code points, finds the first one
 * that starts an emoji, consumes exactly that cluster, and drops everything
 * else — including plain text, so a stray keystroke from the letter keyboard
 * never lands in the field.
 *
 * The ranges below are deliberately hand-rolled rather than `\p{Extended_Pictographic}`:
 * Hermes doesn't carry the full Unicode property tables, and a regex it can't
 * compile is a startup crash, not a failed match.
 */

const VARIATION_SELECTOR_16 = 0xfe0f;
const VARIATION_SELECTOR_15 = 0xfe0e;
const ZERO_WIDTH_JOINER = 0x200d;
const COMBINING_KEYCAP = 0x20e3;

/** Blocks whose code points can begin an emoji, in ascending order. */
const PICTOGRAPHIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00a9, 0x00a9], // ©
  [0x00ae, 0x00ae], // ®
  [0x203c, 0x203c], // ‼
  [0x2049, 0x2049], // ⁉
  [0x2122, 0x2122], // ™
  [0x2139, 0x2139], // ℹ
  [0x2194, 0x21aa], // arrows
  [0x231a, 0x231b], // ⌚ ⌛
  [0x2328, 0x2328], // ⌨
  [0x23cf, 0x23cf],
  [0x23e9, 0x23f3], // media controls, ⏳
  [0x23f8, 0x23fa],
  [0x24c2, 0x24c2], // Ⓜ
  [0x25aa, 0x25ab],
  [0x25b6, 0x25b6],
  [0x25c0, 0x25c0],
  [0x25fb, 0x25fe],
  [0x2600, 0x27bf], // misc symbols + dingbats
  [0x2934, 0x2935],
  [0x2b00, 0x2bff],
  [0x3030, 0x3030],
  [0x303d, 0x303d],
  [0x3297, 0x3297],
  [0x3299, 0x3299],
  [0x1f000, 0x1faff], // the pictograph planes
  [0x1fc00, 0x1fffd], // room for blocks newer than this file
];

const isPictographic = (cp: number): boolean =>
  PICTOGRAPHIC_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

const isSkinTone = (cp: number): boolean => cp >= 0x1f3fb && cp <= 0x1f3ff;
const isRegionalIndicator = (cp: number): boolean => cp >= 0x1f1e6 && cp <= 0x1f1ff;
/** Tag characters, used by subdivision flags like 🏴󠁧󠁢󠁳󠁣󠁴󠁿. */
const isTag = (cp: number): boolean => cp >= 0xe0020 && cp <= 0xe007f;
const isVariationSelector = (cp: number): boolean =>
  cp === VARIATION_SELECTOR_16 || cp === VARIATION_SELECTOR_15;
/** `0`–`9`, `#` and `*` — emoji only when a combining keycap follows. */
const isKeycapBase = (cp: number): boolean =>
  (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a;

/**
 * The first complete emoji in `text`, or `''` if there isn't one.
 *
 * Everything before and after that one cluster is discarded, so this doubles as
 * "reject anything that isn't an emoji" for a text field.
 */
export function firstEmoji(text: string | null | undefined): string {
  if (!text) return '';
  const cps = Array.from(text).map(ch => ch.codePointAt(0)!);

  for (let i = 0; i < cps.length; i++) {
    const cluster = clusterAt(cps, i);
    if (cluster.length > 0) return String.fromCodePoint(...cluster);
  }
  return '';
}

/** True when `text` is exactly one emoji and nothing else. */
export function isSingleEmoji(text: string | null | undefined): boolean {
  const trimmed = (text ?? '').trim();
  return trimmed.length > 0 && firstEmoji(trimmed) === trimmed;
}

/** The cluster starting at `i`, or `[]` if nothing emoji-ish starts there. */
function clusterAt(cps: number[], i: number): number[] {
  const cp = cps[i];

  // Keycaps (1️⃣) — only an emoji when the keycap actually follows, otherwise
  // a typed "1" would read as one.
  if (isKeycapBase(cp)) {
    let j = i + 1;
    if (cps[j] === VARIATION_SELECTOR_16) j++;
    if (cps[j] !== COMBINING_KEYCAP) return [];
    return cps.slice(i, j + 1);
  }

  // Flags — a pair of regional indicators; a lone one is half a flag, so take
  // it only when its partner is there.
  if (isRegionalIndicator(cp)) {
    if (!isRegionalIndicator(cps[i + 1])) return [];
    return cps.slice(i, i + 2);
  }

  if (!isPictographic(cp)) return [];

  let end = i + 1;
  for (;;) {
    while (
      end < cps.length &&
      (isVariationSelector(cps[end]) || isSkinTone(cps[end]) || isTag(cps[end]))
    ) {
      end++;
    }
    // A ZWJ only extends the cluster if something joinable follows it —
    // a trailing joiner is left behind rather than swallowed.
    if (
      cps[end] === ZERO_WIDTH_JOINER &&
      end + 1 < cps.length &&
      (isPictographic(cps[end + 1]) || isRegionalIndicator(cps[end + 1]))
    ) {
      end += 2;
      continue;
    }
    break;
  }
  return cps.slice(i, end);
}
