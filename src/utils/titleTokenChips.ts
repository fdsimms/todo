/**
 * What to offer on the keyboard bar once a sigil is typed at the end of a
 * quick-add title: "!" offers the four priority words, "#" the categories and
 * tags, "+" the live projects and "~" a few common estimates. Tapping one
 * finishes the token, so the word never has to be typed.
 *
 * Every chip is something the matching parser already resolves
 * (`parsePriorityInput`, `parseCategoryAndTagsInput`, `parseProjectInput`,
 * `parseEstimateInput`), which is why a name that can't be written as one
 * token is left out rather than offered and then ignored: those parsers read
 * a single `[a-z][\w-]*` word after the sigil. A project is written as its
 * hyphenated name ("Kitchen Reno" -> "+kitchen-reno"), which `parseProjectInput`
 * reads back as an exact match because it ignores case, spaces and punctuation.
 *
 * Only the trailing token is considered, with the caret taken to be at the end
 * of the title: the caret lives in a ref and never re-renders, so a chip row
 * built on it would show whatever the previous keystroke left behind.
 *
 * Pure and store-free, like the parsers it mirrors; the caller passes the names.
 */

import { chipUseKey, rankByUse, type ChipUses } from './chipUses';

export type TokenChipKind = 'priority' | 'category' | 'project' | 'estimate';

export interface TokenChip {
  /** What the button shows. */
  label: string;
  /** What replaces the typed part of the word. */
  value: string;
}

export interface TokenChipSet {
  kind: TokenChipKind;
  /** Index just after the sigil, where the word being typed begins. */
  from: number;
  chips: TokenChip[];
}

export interface TokenChipSources {
  categories: readonly string[];
  tags: readonly string[];
  /**
   * A category's emoji by name. It prefixes the chip's label only; the value
   * stays the bare word, since `parseCategoryAndTagsInput` reads `[a-z][\w-]*`.
   */
  categoryEmoji?: Readonly<Record<string, string>>;
  /** Live projects only, and none at all when the sheet is already inside one. */
  projects: readonly string[];
  /**
   * How often each category, tag and project was chosen from quick add (see
   * `chipUses.ts`). Reorders the `#` and `+` rows, most used first, with ties
   * left in the order the names arrived in. Omitted, nothing is reordered.
   */
  uses?: ChipUses;
}

/** Past this many a row is a list to scroll rather than a shortcut. */
export const MAX_TOKEN_CHIPS = 10;

const TRAILING_TOKEN = /(?<![\w+])([#!+~])([\w-]*)$/;

// Most urgent first: it is the one a person reaching for "!" is most likely
// to want, and the order the row reads in.
const PRIORITY_CHIPS = ['urgent', 'high', 'medium', 'low'];
const ESTIMATE_CHIPS = ['5m', '15m', '30m', '1h'];

/** One word after a sigil, as every token pattern in `parseTaskInput` reads it. */
const TYPABLE_WORD = /^[a-z][\w-]*$/i;

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The typable names, most used first. Done before narrowing, so the cap keeps the favorites. */
function ranked(named: { name: string; key: string }[], uses: ChipUses = {}): string[] {
  return rankByUse(named.filter(n => TYPABLE_WORD.test(n.name)), uses, n => n.key).map(n => n.name);
}

/** Chips whose value starts with what is typed so far, minus one already complete. */
function narrow(values: string[], typed: string, emoji: Readonly<Record<string, string>> = {}): TokenChip[] {
  const lower = typed.toLowerCase();
  const seen = new Set<string>();
  const out: TokenChip[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key) || !key.startsWith(lower) || key === lower) continue;
    seen.add(key);
    out.push({ label: emoji[value] ? `${emoji[value]} ${value}` : value, value });
  }
  return out.slice(0, MAX_TOKEN_CHIPS);
}

export function tokenChipsFor(title: string, sources: TokenChipSources): TokenChipSet | null {
  const match = title.match(TRAILING_TOKEN);
  if (!match || match.index === undefined) return null;
  const [, sigil, typed] = match;
  const from = match.index + 1;

  let kind: TokenChipKind;
  let values: string[];
  switch (sigil) {
    case '!':
      kind = 'priority';
      values = PRIORITY_CHIPS;
      break;
    case '~':
      kind = 'estimate';
      values = ESTIMATE_CHIPS;
      break;
    case '#':
      kind = 'category';
      // Categories first, in the user's own order, then tags; a name with a
      // space can't be written as one token, so it is not offered.
      values = ranked([
        ...sources.categories.map(name => ({ name, key: chipUseKey('category', name) })),
        ...sources.tags.map(name => ({ name, key: chipUseKey('tag', name) })),
      ], sources.uses);
      break;
    default:
      kind = 'project';
      values = ranked(
        sources.projects.map(title => ({ name: slug(title), key: chipUseKey('project', title) })),
        sources.uses,
      );
      break;
  }

  const chips = narrow(values, typed, kind === 'category' ? sources.categoryEmoji : undefined);
  return chips.length > 0 ? { kind, from, chips } : null;
}

/** The title with the typed word replaced by the chip, and a space after it. */
export function applyTokenChip(title: string, set: TokenChipSet, chip: TokenChip): string {
  return `${title.slice(0, set.from)}${chip.value} `;
}
