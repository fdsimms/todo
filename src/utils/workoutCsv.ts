import { format } from 'date-fns/format';
import type { Exercise, ExerciseEquipment, WorkoutSession, WorkoutSet, WorkoutSetKind } from '../types';
import { buildCatalog, catalogExercise, type CatalogExercise } from './exerciseCatalog';
import { cleanWorkoutName, exerciseNameKey, weightToDisplay } from './workoutData';
import { csvCell } from './moodExport';
import { unitToKg, type WeightUnit } from './weightLog';
import { MIN_SIMILAR_LENGTH, withinOneEdit } from './textSimilar';

/**
 * Workouts in and out as CSV: importing a Strong or Hevy export, and writing
 * the person's own log as a file. See docs/arch/workouts.md (phase 7).
 *
 * Everything here is pure; the file picker, the share sheet and the writes are
 * the screen's and the store's.
 *
 * **Both formats are read by header name, never by position.** Each has changed
 * its columns between app versions (Strong added a weight-unit column, Hevy
 * moved between kg and lbs headers), so a header is matched case-insensitively
 * with punctuation ignored, an optional column that is missing reads as empty,
 * and a file with an extra column still imports.
 *
 * **Weights are converted to kilograms here, at the edge**, like every weight
 * in the app. A file that gives no unit at all (an older Strong export) is read
 * in `fallbackUnit` and says so (`unitAssumed`), so the review sheet can ask.
 *
 * **Dates are local wall-clock times.** Neither app writes a zone, so "2024-01-09
 * 18:30" is 18:30 wherever the person was, and is built from its parts with
 * `new Date(y, m, d, h, mi, s)`, never parsed as UTC. A value that does carry a
 * `Z` or an offset is honoured as the instant it names.
 *
 * **An import is idempotent without any new column.** A session's id is a hash
 * of its source, start time and title (`importSessionId`), so reading the same
 * file again names the same ids; a session already in the log with the same
 * start and title is skipped too, which covers one the person kept after
 * renaming the id's source (a restore, a sync from another device).
 */

export type ImportSource = 'strong' | 'hevy';

/** One set read from a file, before its exercise name is matched to anything. */
export interface ImportedSet {
  exerciseName: string;
  kind: WorkoutSetKind;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  rpe: number | null;
  note: string | null;
  supersetKey: string | null;
}

/** One workout read from a file. Sets are in the order they were done. */
export interface ImportedSession {
  id: string;
  source: ImportSource;
  title: string;
  startedAt: string;
  endedAt: string;
  notes: string;
  sets: ImportedSet[];
}

export type CsvParseResult =
  | {
      ok: true;
      source: ImportSource;
      sessions: ImportedSession[];
      /** The file has weights and no unit anywhere, so `fallbackUnit` was used. */
      unitAssumed: boolean;
      /** Rows left out: a rest timer, a set with nothing recorded, a row with no exercise or date. */
      skippedRows: number;
    }
  | { ok: false; reason: 'empty' | 'unknown' | 'noRows' };

export interface ParseOptions {
  /** The unit a file with no unit in it is read in. Default kilograms. */
  fallbackUnit?: WeightUnit;
}

// ==== CSV reading ====

/**
 * Rows of cells. A leading byte-order mark is dropped, quotes may hold commas,
 * doubled quotes and line breaks, and CRLF, LF and bare CR all end a row. The
 * delimiter is the comma unless the header line has more semicolons (a file
 * saved by a spreadsheet in a comma-decimal locale). Rows with no content at
 * all are left out.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const delimiter = count(firstLine, ';') > count(firstLine, ',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some(c => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

/** "Weight (kg)", "weight_kg" and "WEIGHT KG" are one header. */
const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ==== Dates ====

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** A date built from parts, or null when the parts name a day that doesn't exist (Feb 31). */
function localDate(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  const date = new Date(y, mo, d, h, mi, s);
  const ok = date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d
    && date.getHours() === h && date.getMinutes() === mi;
  return ok ? date : null;
}

/**
 * A date as either app writes it: Strong's "2024-01-09 18:30:12" and Hevy's
 * "9 Jan 2024, 18:30" are local wall-clock times, read from their parts. An
 * ISO value with a zone ("…T18:30:12Z", "+01:00") is an instant and is read as
 * one. Anything else is null, so a row with a date this reader doesn't know is
 * counted as skipped and never guessed at (3/4/2024 is March or April).
 */
export function parseImportDate(raw: string): Date | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0', zone] = iso;
    if (zone) {
      const instant = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return Number.isNaN(instant.getTime()) ? null : instant;
    }
    return localDate(+y, +mo - 1, +d, +h, +mi, +sec);
  }
  const words = /^(\d{1,2}) ([A-Za-z]{3})[A-Za-z]*\.?,? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (words) {
    const [, d, mon, y, h, mi, sec = '0', meridiem] = words;
    const month = MONTHS[mon.toLowerCase()];
    if (month === undefined) return null;
    let hour = +h;
    if (meridiem) hour = (hour % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    return localDate(+y, month, +d, hour, +mi, +sec);
  }
  return null;
}

/** "1h 15m", "45m", "50m 30s", "1h": Strong's duration, in seconds. Null for anything else. */
export function parseImportDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const parts = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/.exec(s);
  if (!parts || (parts[1] === undefined && parts[2] === undefined && parts[3] === undefined)) {
    return /^\d+$/.test(s) ? Number(s) : null;
  }
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
}

// ==== Numbers and units ====

/** A non-negative finite number from a cell ("82.5", "82,5"), or null when empty or not a number. */
function num(raw: string | undefined): number | null {
  const s = (raw ?? '').trim().replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const round = (n: number, places: number) => Number(n.toFixed(places));

const M_PER_MILE = 1609.344;

function distanceMeters(value: number | null, unit: string): number | null {
  if (value === null) return null;
  const u = unit.trim().toLowerCase();
  if (u === 'km' || u === 'kilometers' || u === 'kilometres') return round(value * 1000, 1);
  if (u === 'mi' || u === 'mile' || u === 'miles') return round(value * M_PER_MILE, 1);
  if (u === 'ft' || u === 'feet') return round(value * 0.3048, 1);
  if (u === 'yd' || u === 'yards') return round(value * 0.9144, 1);
  return round(value, 1);
}

const unitFromWord = (raw: string): WeightUnit | null => {
  const u = raw.trim().toLowerCase();
  if (u === 'kg' || u === 'kgs' || u === 'kilograms') return 'kg';
  if (u === 'lb' || u === 'lbs' || u === 'pounds') return 'lb';
  return null;
};

/** The weight cell as kilograms, or null for none. A 0 is no load (a bodyweight set), not a weight. */
function weightKg(value: number | null, unit: WeightUnit): number | null {
  if (value === null || value === 0) return null;
  return round(unitToKg(value, unit), 3);
}

// ==== Set markers ====

function strongKind(order: string): WorkoutSetKind | 'rest' {
  const o = order.trim().toLowerCase();
  if (o === 'w') return 'warmup';
  if (o === 'd') return 'drop';
  if (o === 'f') return 'amrap';
  if (o.includes('rest')) return 'rest';
  return 'working';
}

function hevyKind(type: string): WorkoutSetKind {
  const t = type.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (t === 'warmup') return 'warmup';
  if (t === 'dropset' || t === 'drop') return 'drop';
  if (t === 'failure') return 'amrap';
  return 'working';
}

// ==== Reading a file ====

type Cells = (name: string) => string;

/** A header-name lookup over one row: the first of `names` the file has, else empty. */
function cellReader(header: string[], row: string[]): Cells {
  const index = new Map<string, number>();
  header.forEach((h, i) => { if (!index.has(h)) index.set(h, i); });
  return (name: string) => {
    const i = index.get(name);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
}

export function detectFormat(headerCells: readonly string[]): ImportSource | null {
  const keys = new Set(headerCells.map(headerKey));
  if (keys.has('exercise title') && keys.has('start time')) return 'hevy';
  if (keys.has('exercise name') && keys.has('workout name') && keys.has('date')) return 'strong';
  return null;
}

const hash = (s: string): string => {
  // cyrb53: a short, well-spread, deterministic 53-bit hash. Not a secret.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

/**
 * The id an imported session is stored under. The same file read twice names
 * the same ids, which is the whole of the import's idempotence: the second
 * pass finds them already there. A hash of the source, the start instant and
 * the title key, so a re-export that changes nothing about a workout names it
 * the same.
 */
export function importSessionId(source: ImportSource, startedAtIso: string, title: string): string {
  return `imp-${source}-${hash(`${source}|${startedAtIso}|${exerciseNameKey(title)}`)}`;
}

interface Draft {
  title: string;
  start: Date;
  end: Date | null;
  durationSeconds: number | null;
  notes: string;
  sets: ImportedSet[];
  /** For ordering an exercise's sets: the file's own index, or null where it has none. */
  order: (number | null)[];
}

export function parseWorkoutCsv(text: string, options: ParseOptions = {}): CsvParseResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { ok: false, reason: 'empty' };
  const source = detectFormat(rows[0]);
  if (!source) return { ok: false, reason: 'unknown' };
  const header = rows[0].map(headerKey);
  const fallback = options.fallbackUnit ?? 'kg';

  const hasWeightUnitColumn = header.includes('weight unit');
  const hasKgHeader = header.includes('weight kg');
  const hasLbHeader = header.includes('weight lbs') || header.includes('weight lb');
  const hasAnyWeightColumn = header.includes('weight') || hasKgHeader || hasLbHeader;
  let sawWeight = false;
  let sawUnit = false;
  let skipped = 0;
  const drafts = new Map<string, Draft>();

  for (const row of rows.slice(1)) {
    const c = cellReader(header, row);
    const isStrong = source === 'strong';
    const title = cleanWorkoutName(isStrong ? c('workout name') : c('title'));
    const start = parseImportDate(isStrong ? c('date') : c('start time'));
    const exerciseName = cleanWorkoutName(isStrong ? c('exercise name') : c('exercise title'));
    if (!start || !exerciseName) { skipped++; continue; }

    let kind: WorkoutSetKind;
    let setIndex: number | null = null;
    if (isStrong) {
      const k = strongKind(c('set order'));
      if (k === 'rest') { skipped++; continue; }
      kind = k;
      if (/^\d+$/.test(c('set order'))) setIndex = Number(c('set order'));
    } else {
      kind = hevyKind(c('set type'));
      const idx = num(c('set index'));
      setIndex = idx;
    }

    // The unit this row's weight is in: its own column, else the header's, else the fallback.
    let unit: WeightUnit = fallback;
    let rawWeight: number | null;
    if (!isStrong && (hasKgHeader || hasLbHeader)) {
      const kg = num(c('weight kg'));
      const lb = num(c('weight lbs')) ?? num(c('weight lb'));
      if (kg !== null && kg !== 0) { unit = 'kg'; rawWeight = kg; sawUnit = true; }
      else if (lb !== null && lb !== 0) { unit = 'lb'; rawWeight = lb; sawUnit = true; }
      else rawWeight = null;
    } else if (isStrong && (hasKgHeader || hasLbHeader)) {
      unit = hasKgHeader ? 'kg' : 'lb';
      rawWeight = num(c(hasKgHeader ? 'weight kg' : header.includes('weight lbs') ? 'weight lbs' : 'weight lb'));
      sawUnit = true;
    } else {
      rawWeight = num(c('weight'));
      const named = hasWeightUnitColumn ? unitFromWord(c('weight unit')) : null;
      if (named) { unit = named; sawUnit = true; }
    }
    if (rawWeight !== null && rawWeight !== 0) sawWeight = true;

    const distanceHeader = ['distance', 'distance km', 'distance miles', 'distance mi', 'distance m', 'distance meters']
      .find(h => header.includes(h));
    let distanceUnit = '';
    if (distanceHeader === 'distance km') distanceUnit = 'km';
    else if (distanceHeader === 'distance miles' || distanceHeader === 'distance mi') distanceUnit = 'mi';
    else if (distanceHeader === 'distance') distanceUnit = c('distance unit');
    const distance = distanceHeader ? distanceMeters(num(c(distanceHeader)), distanceUnit) : null;

    const seconds = num(isStrong ? c('seconds') : c('duration seconds'));
    const reps = num(c('reps'));
    const set: ImportedSet = {
      exerciseName,
      kind,
      weightKg: weightKg(rawWeight, unit),
      reps: reps === null || reps === 0 ? null : Math.round(reps),
      durationSeconds: seconds === null || seconds === 0 ? null : Math.round(seconds),
      distanceM: distance === null || distance === 0 ? null : distance,
      rpe: (() => { const r = num(c('rpe')); return r !== null && r >= 1 && r <= 10 ? r : null; })(),
      note: (isStrong ? c('notes') : c('exercise notes')) || null,
      supersetKey: !isStrong && c('superset id') ? `ss-${c('superset id')}` : null,
    };
    if (set.weightKg === null && !set.reps && set.durationSeconds === null && set.distanceM === null) {
      skipped++;
      continue;
    }

    const startIso = start.toISOString();
    const key = `${startIso}|${exerciseNameKey(title)}`;
    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        title,
        start,
        end: isStrong ? null : parseImportDate(c('end time')),
        durationSeconds: isStrong ? parseImportDuration(c('duration') || c('workout duration')) : null,
        notes: isStrong ? c('workout notes') : c('description'),
        sets: [],
        order: [],
      };
      drafts.set(key, draft);
    }
    draft.sets.push(set);
    draft.order.push(setIndex);
  }

  const sessions: ImportedSession[] = [];
  for (const d of drafts.values()) {
    const title = d.title || 'Workout';
    const startedAt = d.start.toISOString();
    let end = d.end ?? (d.durationSeconds !== null ? new Date(d.start.getTime() + d.durationSeconds * 1000) : d.start);
    if (end.getTime() < d.start.getTime()) end = d.start;
    sessions.push({
      id: importSessionId(source, startedAt, title),
      source,
      title,
      startedAt,
      endedAt: end.toISOString(),
      notes: d.notes,
      sets: orderSets(d.sets, d.order, source === 'hevy'),
    });
  }
  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (sessions.length === 0) return { ok: false, reason: 'noRows' };

  return {
    ok: true,
    source,
    sessions,
    unitAssumed: hasAnyWeightColumn && sawWeight && !sawUnit,
    skippedRows: skipped,
  };
}

/**
 * Exercises in order of first appearance, and (for Hevy, which numbers its
 * sets) each exercise's sets by that number, so a file whose rows were
 * re-sorted still reads set 1 before set 2. Strong's rows are already in the
 * order they were done and its warm-up and drop markers carry no number.
 */
function orderSets(sets: ImportedSet[], order: (number | null)[], byIndex: boolean): ImportedSet[] {
  const first = new Map<string, number>();
  sets.forEach(s => { if (!first.has(s.exerciseName)) first.set(s.exerciseName, first.size); });
  return sets
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const ex = first.get(a.s.exerciseName)! - first.get(b.s.exerciseName)!;
      if (ex !== 0) return ex;
      if (byIndex && order[a.i] !== null && order[b.i] !== null && order[a.i] !== order[b.i]) {
        return order[a.i]! - order[b.i]!;
      }
      return a.i - b.i;
    })
    .map(x => x.s);
}

// ==== Names ====

/** One distinct exercise name in a file and how much of the file uses it. */
export interface ExerciseNameUse {
  name: string;
  key: string;
  sets: number;
  sessions: number;
}

/** Every distinct exercise name in the sessions, most used first. Two spellings of case or spacing are one. */
export function distinctExerciseNames(sessions: readonly ImportedSession[]): ExerciseNameUse[] {
  const byKey = new Map<string, ExerciseNameUse & { seen: Set<string> }>();
  for (const session of sessions) {
    for (const set of session.sets) {
      const key = exerciseNameKey(set.exerciseName);
      let use = byKey.get(key);
      if (!use) {
        use = { name: set.exerciseName, key, sets: 0, sessions: 0, seen: new Set() };
        byKey.set(key, use);
      }
      use.sets++;
      if (!use.seen.has(session.id)) { use.seen.add(session.id); use.sessions++; }
    }
  }
  return [...byKey.values()]
    .map(({ seen: _seen, ...use }) => use)
    .sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name));
}

/** How a name was matched: the same name, the same words in another order, or one clear near match. */
export type NameMatch =
  | { kind: 'exact' | 'words' | 'close'; exerciseId: string; exerciseName: string }
  | { kind: 'none' };

/**
 * Words of a name for comparing: lowercased, hyphens and punctuation as
 * spaces, a plural "s" dropped, and the parenthesised equipment Strong and
 * Hevy append ("Bench Press (Barbell)") as just more words. So that name and
 * the library's "Barbell bench press" come out as the same set.
 */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

const sortedWords = (name: string) => [...new Set(nameWords(name))].sort();

/** A fuzzy match has to share at least this fraction of the words (shared over all distinct words). */
const CLOSE_MIN_OVERLAP = 0.8;
/** And beat the next best by this much, or two exercises are plausible and a person decides. */
const CLOSE_MARGIN = 0.15;

/**
 * The catalog exercise a file's name means, or none.
 *
 * Three tiers, each stricter about what it will decide for the person:
 * the exact name key; the same words in any order (so "Bench Press (Barbell)"
 * is "Barbell bench press" and "pull up" is "Pull-up"); and a single near match
 * (one word more or less, or one letter out on a whole name). Two candidates
 * within `CLOSE_MARGIN` of each other, or one word shared between two long
 * names, are not a match: the review sheet asks. Nothing is remembered: the
 * matching is the same every time, and only what the person confirms is saved.
 *
 * `catalog` is `buildCatalog(rows)`: the exact tier looks at every exercise,
 * archived ones included (an archived custom exercise still owns its name),
 * the other two only at ones on offer.
 */
export function matchExerciseName(name: string, catalog: readonly CatalogExercise[]): NameMatch {
  const key = exerciseNameKey(name);
  const exact = catalog.find(e => exerciseNameKey(e.name) === key);
  if (exact) return { kind: 'exact', exerciseId: exact.id, exerciseName: exact.name };

  const live = catalog.filter(e => !e.archived);
  const words = sortedWords(name);
  if (words.length === 0) return { kind: 'none' };
  const sameWords = live.filter(e => {
    const w = sortedWords(e.name);
    return w.length === words.length && w.every((x, i) => x === words[i]);
  });
  if (sameWords.length === 1) return { kind: 'words', exerciseId: sameWords[0].id, exerciseName: sameWords[0].name };
  if (sameWords.length > 1) return { kind: 'none' };

  const compact = words.join('');
  const scored = live
    .map(e => {
      const w = sortedWords(e.name);
      const shared = w.filter(x => words.includes(x)).length;
      const overlap = shared / (new Set([...w, ...words]).size);
      const typo = compact.length >= MIN_SIMILAR_LENGTH && withinOneEdit(compact, w.join(''));
      return { e, score: typo ? Math.max(overlap, 0.9) : overlap };
    })
    .filter(x => x.score >= CLOSE_MIN_OVERLAP)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { kind: 'none' };
  if (scored.length > 1 && scored[0].score - scored[1].score < CLOSE_MARGIN) return { kind: 'none' };
  return { kind: 'close', exerciseId: scored[0].e.id, exerciseName: scored[0].e.name };
}

/** The matches for every name in a file, by name key. Pure over the catalog, so the sheet can call it per render. */
export function matchAll(names: readonly ExerciseNameUse[], rows: readonly Exercise[]): Record<string, NameMatch> {
  const catalog = buildCatalog(rows);
  const out: Record<string, NameMatch> = {};
  for (const n of names) out[n.key] = matchExerciseName(n.name, catalog);
  return out;
}

/** What a custom exercise made from a file's name records, read off the sets that used it. */
export function inferExerciseKind(sets: readonly Pick<ImportedSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>[]):
  'weight_reps' | 'bodyweight_reps' | 'duration' | 'distance' | 'weight_distance' {
  const any = (f: (s: (typeof sets)[number]) => boolean) => sets.some(f);
  const distance = any(s => s.distanceM !== null);
  const weight = any(s => s.weightKg !== null);
  if (distance) return weight ? 'weight_distance' : 'distance';
  if (any(s => s.reps !== null && s.reps > 0)) return weight ? 'weight_reps' : 'bodyweight_reps';
  if (any(s => s.durationSeconds !== null)) return 'duration';
  return weight ? 'weight_reps' : 'bodyweight_reps';
}

// ==== Planning an import ====

/** What the person decided for one name. */
export type NameResolution =
  | { kind: 'exercise'; exerciseId: string }
  | { kind: 'create' }
  | { kind: 'skip' };

/** The reference a planned set uses for an exercise the import will create: `new:` and the name key. */
export const NEW_EXERCISE_PREFIX = 'new:';

export interface PlannedImportSet {
  /** An exercise id, or `new:<name key>` for one the import creates. */
  exerciseRef: string;
  kind: WorkoutSetKind;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  rpe: number | null;
  note: string | null;
  supersetKey: string | null;
}

export interface PlannedImportSession {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string;
  notes: string;
  sets: PlannedImportSet[];
}

export interface ImportPlan {
  sessions: PlannedImportSession[];
  /** The name keys the import creates a custom exercise for. */
  createKeys: string[];
  /** Workouts left out because the log already has them. */
  duplicates: number;
  /** Workouts left out because every set in them was skipped. */
  emptied: number;
  /** Sets left out because their exercise was skipped. */
  skippedSets: number;
}

/**
 * What an import will write, from the sessions in a file, what the person
 * decided for each name, and the sessions already in the log.
 *
 * A name with no decision is treated as skipped here; the sheet holds its
 * Import button until every name has one, so this never runs on a gap. A
 * session is a duplicate when the log has its id, or has one with the same
 * start instant and title key (a restore or a sync from another device
 * brought it back under another id).
 */
/** The sessions the log doesn't have yet, and how many it already had (same id, or same start and title). */
export function splitDuplicates(
  sessions: readonly ImportedSession[],
  existing: readonly Pick<WorkoutSession, 'id' | 'startedAt' | 'title'>[],
): { fresh: ImportedSession[]; duplicates: number } {
  const ids = new Set(existing.map(s => s.id));
  const starts = new Set(existing.map(s => `${s.startedAt}|${exerciseNameKey(s.title)}`));
  const fresh = sessions.filter(s => !ids.has(s.id) && !starts.has(`${s.startedAt}|${exerciseNameKey(s.title)}`));
  return { fresh, duplicates: sessions.length - fresh.length };
}

/** The equipment a file's name says in its words ("Squat (Barbell)"), for the custom exercise made from it. */
export function guessEquipment(name: string): ExerciseEquipment {
  const w = nameWords(name);
  const has = (...words: string[]) => words.some(x => w.includes(x));
  if (has('smith')) return 'smith_machine';
  if (has('barbell')) return 'barbell';
  if (has('dumbbell')) return 'dumbbell';
  if (has('kettlebell')) return 'kettlebell';
  if (has('cable')) return 'cable';
  if (has('machine', 'lever', 'plate')) return 'machine';
  if (has('band')) return 'band';
  if (has('ez')) return 'ez_bar';
  if (has('bodyweight')) return 'bodyweight';
  return 'other';
}

export function buildImportPlan(
  sessions: readonly ImportedSession[],
  resolutions: Readonly<Record<string, NameResolution | undefined>>,
  existing: readonly Pick<WorkoutSession, 'id' | 'startedAt' | 'title'>[],
): ImportPlan {
  const { fresh, duplicates } = splitDuplicates(sessions, existing);
  const create = new Set<string>();
  const planned: PlannedImportSession[] = [];
  let emptied = 0;
  let skippedSets = 0;

  for (const session of fresh) {
    const sets: PlannedImportSet[] = [];
    const wanted = new Set<string>();
    for (const s of session.sets) {
      const key = exerciseNameKey(s.exerciseName);
      const resolution = resolutions[key];
      if (!resolution || resolution.kind === 'skip') { skippedSets++; continue; }
      const exerciseRef = resolution.kind === 'exercise' ? resolution.exerciseId : `${NEW_EXERCISE_PREFIX}${key}`;
      if (resolution.kind === 'create') wanted.add(key);
      sets.push({
        exerciseRef,
        kind: s.kind,
        weightKg: s.weightKg,
        reps: s.reps,
        durationSeconds: s.durationSeconds,
        distanceM: s.distanceM,
        rpe: s.rpe,
        note: s.note,
        supersetKey: s.supersetKey,
      });
    }
    if (sets.length === 0) { emptied++; continue; }
    wanted.forEach(k => create.add(k));
    planned.push({
      id: session.id,
      title: session.title,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      notes: session.notes,
      sets,
    });
  }
  return { sessions: planned, createKeys: [...create], duplicates, emptied, skippedSets };
}

/** How many workouts and sets a file holds, and the first and last start, for the review sheet. */
export function importSummary(sessions: readonly ImportedSession[]): {
  sessions: number; sets: number; from: string | null; to: string | null;
} {
  let sets = 0;
  let from: string | null = null;
  let to: string | null = null;
  for (const s of sessions) {
    sets += s.sets.length;
    if (from === null || s.startedAt < from) from = s.startedAt;
    if (to === null || s.startedAt > to) to = s.startedAt;
  }
  return { sessions: sessions.length, sets, from, to };
}

// ==== Export ====

/** The columns of the file, Strong's own order, with the unit the weights are in spelled in the header. */
export function workoutExportColumns(unit: WeightUnit): string[] {
  return [
    'Date', 'Workout Name', 'Duration', 'Exercise Name', 'Set Order', `Weight (${unit})`, 'Reps',
    'Distance (m)', 'Seconds', 'Notes', 'Workout Notes', 'RPE',
  ];
}

export interface ExportedWorkout {
  session: WorkoutSession;
  sets: readonly WorkoutSet[];
}

/** "1h 5m", "45m", "30s": a length of time the way Strong writes it. Empty for none. */
export function exportDuration(seconds: number): string {
  if (!(seconds > 0)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

const SET_MARK: Record<WorkoutSetKind, string> = { warmup: 'W', working: '', drop: 'D', amrap: 'F' };

/**
 * The person's workouts as a CSV, oldest first, one row per set done.
 *
 * The columns are Strong's (`workoutExportColumns`), so the file opens in a
 * spreadsheet as it is and `parseWorkoutCsv` reads it back. Weights are in
 * `unit`, named in the header, since "100" on a page says nothing; distance is
 * meters. Set Order counts the sets that aren't warm-ups from 1, and a warm-up,
 * drop or to-failure set carries Strong's W, D or F in its place. A planned set
 * never done, and a workout still in progress, are left out: this is a record
 * of what happened. Nothing is derived (no volume, no estimated 1RM).
 */
export function workoutExportCsv(
  workouts: readonly ExportedWorkout[],
  exercises: readonly Exercise[],
  unit: WeightUnit,
): string {
  const lines = [workoutExportColumns(unit).map(csvCell).join(',')];
  const sorted = workouts
    .filter(w => w.session.endedAt !== null)
    .sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt));
  for (const { session, sets } of sorted) {
    const started = new Date(session.startedAt);
    const seconds = (new Date(session.endedAt!).getTime() - started.getTime()) / 1000;
    const date = format(started, 'yyyy-MM-dd HH:mm:ss');
    const done = sets
      .filter(s => s.completedAt !== null)
      .sort((a, b) => a.position - b.position || a.setIndex - b.setIndex);
    let order = 0;
    let lastExercise = '';
    for (const set of done) {
      if (set.exerciseId !== lastExercise) { order = 0; lastExercise = set.exerciseId; }
      let mark = SET_MARK[set.kind];
      if (!mark) { order++; mark = String(order); }
      const first = set === done[0];
      const cells = [
        date,
        session.title,
        exportDuration(seconds),
        catalogExercise(exercises, set.exerciseId)?.name ?? 'Unknown exercise',
        mark,
        set.weightKg === null ? '' : String(weightToDisplay(set.weightKg, unit)),
        set.reps === null ? '' : String(set.reps),
        set.distanceM === null ? '' : String(set.distanceM),
        set.durationSeconds === null ? '' : String(set.durationSeconds),
        set.note ?? '',
        first ? session.notes : '',
        set.rpe === null ? '' : String(set.rpe),
      ];
      lines.push(cells.map(csvCell).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function workoutExportFileName(exportedAt: Date): string {
  return `workouts-${format(exportedAt, 'yyyy-MM-dd')}.csv`;
}

/** "12 workouts, 310 sets" for the export sheet's line. */
export function workoutExportSummary(workouts: readonly ExportedWorkout[]): string {
  const done = workouts.filter(w => w.session.endedAt !== null);
  const sets = done.reduce((n, w) => n + w.sets.filter(s => s.completedAt !== null).length, 0);
  if (done.length === 0) return 'No finished workouts in this range.';
  return `${done.length} ${done.length === 1 ? 'workout' : 'workouts'}, ${sets} ${sets === 1 ? 'set' : 'sets'}`;
}
