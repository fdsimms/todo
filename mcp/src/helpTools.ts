/**
 * `app_help`: what the app can do and where its settings are, for an agent
 * explaining the app to the person using it.
 *
 * An agent's picture of this app otherwise comes from tool descriptions and
 * from its own guesses, and a guessed feature is one it will cheerfully walk
 * somebody through on a screen that does not exist. The app already has two
 * written records of itself that are kept true by other means, so this reads
 * those rather than adding a third:
 *
 * - **The Settings index** (`src/utils/settingsIndex.ts`), through the same
 *   search the app's own Settings field runs, with the person's own gates
 *   applied: a row the kitchen switch or simplified mode has taken away is not
 *   offered. `settingsIndex.test.ts` keeps it in step with the screens.
 * - **The patch notes** (`src/patchNotes/entries/`), one plain-language line
 *   per user-facing change since the app began, dated. The app ships only the
 *   newest few hundred (see `scripts/build-patch-notes.js`); the server has the
 *   checkout, so it reads all of them. They are written for the person rather
 *   than for a developer, which is exactly the register an explanation wants.
 *
 * Bug-fix notes are left out by default. "Fixed the timer skipping a second"
 * answers no question about how to do something, and there are a great many of
 * them; `includeFixes` brings them back for "why did it do that".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Replica, SettingsHit } from './replica';

export interface PatchNote {
  date: string;
  message: string;
}

/** The checkout's own fragments. `mcp/src` → `src/patchNotes/entries`. */
export const PATCH_NOTES_DIR = join(__dirname, '..', '..', 'src', 'patchNotes', 'entries');

let cached: PatchNote[] | null = null;

/**
 * Every fragment, newest first. Read once per process: they change only with a
 * deploy. A fragment that will not parse is skipped rather than taking the tool
 * down, since the build script already refuses one before it can ship.
 */
export function loadPatchNotes(dir = PATCH_NOTES_DIR): PatchNote[] {
  if (cached && dir === PATCH_NOTES_DIR) return cached;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const notes: PatchNote[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Partial<PatchNote>;
      if (typeof data.message === 'string' && typeof data.date === 'string') {
        notes.push({ date: data.date, message: data.message });
      }
    } catch {
      // See above.
    }
  }
  notes.sort((a, b) => b.date.localeCompare(a.date));
  if (dir === PATCH_NOTES_DIR) cached = notes;
  return notes;
}

/** "Fixed …", and the roundups ("Several small fixes: …", "More fixes: …"). */
const FIX = /^((several|more|small|a few|other|two|three)\s+)*(fixed|fixes|fix)\b/i;

export function isFixNote(note: PatchNote): boolean {
  return FIX.test(note.message.trim());
}

/**
 * Words a question is phrased in rather than about. An agent passes the
 * person's own words more often than keywords, and "how do I make it so that"
 * matches every note there is.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'about', 'any', 'app', 'be', 'can', 'change', 'could', 'do', 'does', 'edit', 'feature',
  'for', 'from', 'get', 'have', 'how', 'in', 'into', 'is', 'it', 'its', 'make', 'me', 'my', 'of', 'on', 'option', 'or',
  'set', 'setting', 'settings', 'so', 'some', 'task', 'tasks', 'that', 'the', 'there', 'this', 'to', 'turn', 'use',
  'want', 'way', 'what', 'when', 'where', 'which', 'why', 'with', 'would', 'you', 'your',
]);

/**
 * Matches a term at the start of a word, so "pin" finds "pinned" and not
 * "shopping". Prefix rather than whole-word because the term is the stem the
 * person typed and the text has the inflection ("repeat" → "repeating").
 */
function wordStart(term: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
}

/**
 * A trailing plural "s" dropped, so "starts" finds "day start". Substring
 * matching then finds the plural from the singular for free, which is the only
 * direction that needed help. Not a stemmer: "ss" is left alone ("class").
 */
function stem(term: string): string {
  return term.length > 4 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term;
}

function termsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(t => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/**
 * Notes matching every term, best first. When no note matches every term, the
 * ones matching the most of them, so a question phrased with one word the notes
 * never use still finds something rather than nothing.
 *
 * Substring rather than fuzzy, for `searchSettings`' reason: these are fixed
 * sentences the app wrote, and subsequence matching over two thousand of them
 * returns noise.
 */
export function searchPatchNotes(notes: readonly PatchNote[], query: string, limit = 10): { matched: number; notes: PatchNote[] } {
  const terms = termsOf(query);
  if (terms.length === 0) return { matched: 0, notes: [] };

  // A rare word says more about what was asked than a common one: in "repeat
  // every other week", "repeat" is the question and "every" is in hundreds of
  // notes. So a matched term counts by how few notes carry it.
  const patterns = new Map(terms.map(term => [term, wordStart(term)]));
  const has = new Map(terms.map(term => [term, notes.map(n => patterns.get(term)!.test(n.message))]));
  const weight = new Map(terms.map(term => {
    const df = has.get(term)!.filter(Boolean).length;
    return [term, Math.log((notes.length + 1) / (df + 1)) + 1];
  }));

  const scored = notes.map((_, index) => {
    let hits = 0;
    let score = 0;
    for (const term of terms) {
      if (!has.get(term)![index]) continue;
      hits++;
      score += weight.get(term)!;
    }
    return { note: notes[index], index, hits, score };
  });

  const best = Math.max(0, ...scored.map(s => s.hits));
  // Half the terms at least, so a long question does not match on one word.
  const floor = best === terms.length ? terms.length : Math.max(best, Math.ceil(terms.length / 2));
  const kept = scored
    .filter(s => s.hits >= floor && s.hits > 0)
    // Then by how telling the matched words are, then newest (the list is newest first).
    .sort((a, b) => b.hits - a.hits || b.score - a.score || a.index - b.index);

  return { matched: kept.length, notes: kept.slice(0, limit).map(s => s.note) };
}

export interface AppHelpInput {
  query: string;
  limit?: number;
  includeFixes?: boolean;
}

export interface AppHelpResult {
  query: string;
  /** Settings rows that match, with the path a person would tap through to reach each. */
  settings: SettingsHit[];
  /** Patch notes that match, newest first among equals. Later notes supersede earlier ones. */
  features: PatchNote[];
  /** How many notes matched, when more than were returned. */
  moreFeatures?: number;
}

export const DEFAULT_HELP_LIMIT = 10;
const MAX_HELP_LIMIT = 40;

export function appHelp(replica: Replica, input: AppHelpInput, notes: readonly PatchNote[] = loadPatchNotes()): AppHelpResult {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_HELP_LIMIT, 1), MAX_HELP_LIMIT);
  const pool = input.includeFixes ? notes : notes.filter(n => !isFixNote(n));
  const found = searchPatchNotes(pool, input.query, limit);

  // The settings search wants every term to match something, so a whole
  // question ("when does my day start") rarely matches as one. Each term is
  // searched alone and a row ranks by how many of them found it, then by how
  // high each search placed it.
  const ranked = new Map<string, { hit: SettingsHit; terms: number; score: number }>();
  for (const term of termsOf(input.query)) {
    // The app's settings search matches anywhere in a word; held to word starts
    // here for the reason `wordStart` gives.
    const pattern = wordStart(term);
    const hits = replica.searchSettings(term).filter(hit => pattern.test(hit.matchedVia ?? hit.label));
    hits.forEach((hit, rank) => {
      const entry = ranked.get(hit.path) ?? { hit, terms: 0, score: 0 };
      entry.terms++;
      entry.score += 1 / (rank + 1);
      ranked.set(hit.path, entry);
    });
  }
  const settings = [...ranked.values()]
    .sort((a, b) => b.terms - a.terms || b.score - a.score)
    .map(e => e.hit);

  return {
    query: input.query,
    settings: settings.slice(0, limit),
    features: found.notes,
    ...(found.matched > found.notes.length ? { moreFeatures: found.matched - found.notes.length } : {}),
  };
}
