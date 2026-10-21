import { format } from 'date-fns/format';
import type { Exercise, ExerciseEquipment, WorkoutSession, WorkoutSet, WorkoutSetKind } from '../types';
import { buildCatalog, catalogExercise, type CatalogExercise } from './exerciseCatalog';
import { cleanWorkoutName, exerciseNameKey, machineParent, weightToDisplay } from './workoutData';
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
 * `Z` or an offset is honoured as the instant it names. A time inside a DST gap
 * is accepted and lands on the shifted instant rather than losing the workout.
 *
 * **An import is idempotent without any new column.** A session's id is a hash
 * of its source and the file's own date text (`importSessionId`), never the
 * computed instant or the title, so the same file read in another time zone, or
 * re-exported after a workout was renamed, names the same ids. A session already
 * in the log is skipped too when it started at the same time (`ExistingIndex`):
 * to the second, or to the minute for a source that only writes minutes (Hevy),
 * since the app's own export truncates to whole seconds while a session keeps
 * its milliseconds. The title is ignored.
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
  /** How finely the file states a start (1000 or 60000 ms), for matching against the log. */
  startPrecisionMs: number;
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
      /** Rows left out, in total and by reason. */
      skippedRows: number;
      skipped: SkippedRows;
    }
  | { ok: false; reason: 'empty' | 'unknown' | 'noRows' };

/** Why rows were left out of a file, counted per reason. */
export interface SkippedRows {
  restTimers: number;
  /** A set with no weight, reps, time or distance. */
  emptySets: number;
  /** A row whose date this reader doesn't know. */
  badDates: number;
  /** A row with no exercise name. */
  noExercise: number;
  /** A note row with no text, or for an exercise with no set in that workout. */
  looseNotes: number;
}

const sumSkipped = (k: SkippedRows) => k.restTimers + k.emptySets + k.badDates + k.noExercise + k.looseNotes;

/** "3 rest timers, 2 sets with nothing recorded and 1 row with a date that couldn't be read": only the reasons that occurred. */
export function describeSkipped(k: SkippedRows): string {
  const part = (n: number, one: string, many: string) => (n === 0 ? null : `${n.toLocaleString()} ${n === 1 ? one : many}`);
  const parts = [
    part(k.restTimers, 'rest timer', 'rest timers'),
    part(k.emptySets, 'set with nothing recorded', 'sets with nothing recorded'),
    part(k.badDates, 'row with a date that couldn’t be read', 'rows with a date that couldn’t be read'),
    part(k.noExercise, 'row with no exercise name', 'rows with no exercise name'),
    part(k.looseNotes, 'note with no set to attach to', 'notes with no set to attach to'),
  ].filter((x): x is string => x !== null);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface ParseOptions {
  /** The unit a file with no unit in it is read in. Default kilograms. */
  fallbackUnit?: WeightUnit;
}

// ==== CSV reading ====

/**
 * Rows of cells. A leading byte-order mark is dropped, quotes may hold commas,
 * doubled quotes and line breaks, and CRLF, LF and bare CR all end a row. The
 * delimiter is the comma unless the header line has more semicolons (Strong's
 * Android and newer exports). Rows with no content at all are left out.
 *
 * **A quote inside a quoted field is read leniently.** Strong's Android export
 * wraps text in quotes without doubling the ones inside (`"Bench "paused""`), so
 * a quote closes the field only when a delimiter, a line break or the end of the
 * file follows it; any other quote is part of the text. A doubled quote that is
 * followed by a delimiter is the inner quote and then the closing one.
 */
export function parseCsv(text: string): string[][] {
  return readCsv(text).rows;
}

/** `parseCsv` and the delimiter it chose, which the number reader needs (a comma decimal only in a semicolon file). */
export function readCsv(text: string): { rows: string[][]; delimiter: ',' | ';' } {
  const src = text.replace(/^\uFEFF/, '');
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
  const endsField = (at: number) => {
    const c = src[at];
    return c === undefined || c === delimiter || c === '\n' || c === '\r';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (src[i + 1] === '"') {
        // A doubled quote is one literal quote, unless the field ends right after the pair,
        // where it is an unescaped quote followed by the closing one.
        cell += '"';
        i++;
        if (endsField(i + 1)) quoted = false;
      } else if (endsField(i + 1)) {
        quoted = false;
      } else {
        cell += '"';
      }
    } else if (ch === '"' && cell === '') {
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
  return { rows, delimiter };
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

/**
 * A date built from parts, or null when the parts name a day or a time that
 * doesn't exist (Feb 31, 25:00). A wall-clock time inside a DST gap is real
 * to the person who wrote it, so it is accepted and lands on the shifted
 * instant (`new Date` moves it forward) rather than losing the workout.
 */
function localDate(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  if (h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo, d, h, mi, s);
  const ok = date.getFullYear() === y && date.getMonth() === mo && date.getDate() === d;
  return ok ? date : null;
}

/** An hour on a 12-hour clock as 0 to 23, or null when it isn't one (0 or 13 with am/pm). */
function hour24(h: number, meridiem: string | undefined): number | null {
  if (!meridiem) return h;
  if (h < 1 || h > 12) return null;
  return (h % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
}

/**
 * A date as either app writes it, all local wall-clock times read from their
 * parts:
 * - Strong: "2024-01-09 18:30:12", and the 12-hour "2025-01-30 12:34:56 pm"
 *   (the space before am/pm may be a no-break space or a narrow one);
 * - Hevy, day first: "9 Jan 2024, 18:30" or "26 Feb 2024, 08:00";
 * - Hevy, month first: "Oct 1, 2026, 8:28 PM".
 * An ISO value with a zone ("…T18:30:12Z", "+01:00") is an instant and is read
 * as one. Anything else is null, so a row with a date this reader doesn't know
 * is counted as skipped and never guessed at (3/4/2024 is March or April).
 */
export function parseImportDate(raw: string): Date | null {
  const s = raw.replace(/[\u00a0\u202f]/g, ' ').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(am|pm)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0', meridiem, zone] = iso;
    if (zone && !meridiem) {
      const instant = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
      return Number.isNaN(instant.getTime()) ? null : instant;
    }
    const hour = hour24(+h, meridiem);
    return hour === null ? null : localDate(+y, +mo - 1, +d, hour, +mi, +sec);
  }
  const dayFirst = /^(\d{1,2}) ([A-Za-z]{3})[A-Za-z]*\.?,? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (dayFirst) {
    const [, d, mon, y, h, mi, sec = '0', meridiem] = dayFirst;
    const month = MONTHS[mon.toLowerCase()];
    const hour = hour24(+h, meridiem);
    return month === undefined || hour === null ? null : localDate(+y, month, +d, hour, +mi, +sec);
  }
  const monthFirst = /^([A-Za-z]{3})[A-Za-z]*\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (monthFirst) {
    const [, mon, d, y, h, mi, sec = '0', meridiem] = monthFirst;
    const month = MONTHS[mon.toLowerCase()];
    const hour = hour24(+h, meridiem);
    return month === undefined || hour === null ? null : localDate(+y, month, +d, hour, +mi, +sec);
  }
  return null;
}

/** The date text as a file wrote it, tidied only for spacing and case: what a session's id is hashed from. */
export const rawDateKey = (raw: string): string => raw.replace(/[\s\u00a0\u202f]+/g, ' ').trim().toLowerCase();

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

/**
 * A non-negative finite number from a cell, or null when empty or not a number.
 * A comma decimal ("82,5") is read only in a semicolon-delimited file, where a
 * comma can't be the delimiter; in a comma file a comma inside a number is a
 * thousands separator ("1,000").
 */
function num(raw: string | undefined, commaDecimal = false): number | null {
  let s = (raw ?? '').trim();
  s = commaDecimal ? s.replace(/^(\d+),(\d+)$/, '$1.$2') : s.replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const round = (n: number, places: number) => Number(n.toFixed(places));

const M_PER_MILE = 1609.344;

/** A unit word as written: lowercased, and "mi." or "lbs." without the trailing period. */
const unitWord = (raw: string) => raw.trim().toLowerCase().replace(/\.+$/, '');

function distanceMeters(value: number | null, unit: string): number | null {
  if (value === null) return null;
  const u = unitWord(unit);
  if (u === 'km' || u === 'kilometers' || u === 'kilometres') return round(value * 1000, 1);
  if (u === 'mi' || u === 'mile' || u === 'miles') return round(value * M_PER_MILE, 1);
  if (u === 'ft' || u === 'feet') return round(value * 0.3048, 1);
  if (u === 'yd' || u === 'yards') return round(value * 0.9144, 1);
  return round(value, 1);
}

const unitFromWord = (raw: string): WeightUnit | null => {
  const u = unitWord(raw);
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

function strongKind(order: string): WorkoutSetKind | 'rest' | 'note' {
  const o = order.trim().toLowerCase();
  if (o === 'w') return 'warmup';
  if (o === 'd') return 'drop';
  if (o === 'f') return 'amrap';
  if (o === 'note') return 'note';
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
 * The id an imported session is stored under, from the source and the file's
 * own date text. The same file read twice names the same ids, which is most of
 * the import's idempotence, and because the text (not the instant it comes to
 * in this time zone, and not the title) is what is hashed, the same file read
 * in another zone, or re-exported after a rename, names them the same too.
 */
export function importSessionId(source: ImportSource, rawDate: string): string {
  return `imp-${source}-${hash(`${source}|${rawDateKey(rawDate)}`)}`;
}

interface Draft {
  title: string;
  rawDate: string;
  start: Date;
  end: Date | null;
  durationSeconds: number | null;
  notes: string;
  sets: ImportedSet[];
  /** For ordering an exercise's sets: the file's own index, or null where it has none. */
  order: (number | null)[];
  /** A Strong "Note" row's text, by exercise name key, until it is attached to that exercise's first set. */
  exerciseNotes: Map<string, string[]>;
}

export function parseWorkoutCsv(text: string, options: ParseOptions = {}): CsvParseResult {
  const { rows, delimiter } = readCsv(text);
  if (rows.length === 0) return { ok: false, reason: 'empty' };
  const source = detectFormat(rows[0]);
  if (!source) return { ok: false, reason: 'unknown' };
  const header = rows[0].map(headerKey);
  const fallback = options.fallbackUnit ?? 'kg';
  const commaDecimal = delimiter === ';';
  const n = (raw: string | undefined) => num(raw, commaDecimal);

  const hasWeightUnitColumn = header.includes('weight unit');
  const hasKgHeader = header.includes('weight kg');
  const hasLbHeader = header.includes('weight lbs') || header.includes('weight lb');
  const hasAnyWeightColumn = header.includes('weight') || hasKgHeader || hasLbHeader;
  const hasDistanceUnitColumn = header.includes('distance unit');
  const distanceHeader = ['distance', 'distance km', 'distance miles', 'distance mi', 'distance m', 'distance meters']
    .find(h => header.includes(h));
  let sawWeight = false;
  let sawUnit = false;
  let sawBareDistance = false;
  const skipped: SkippedRows = { restTimers: 0, emptySets: 0, badDates: 0, noExercise: 0, looseNotes: 0 };
  const drafts = new Map<string, Draft>();

  for (const row of rows.slice(1)) {
    const c = cellReader(header, row);
    const isStrong = source === 'strong';
    const title = cleanWorkoutName(isStrong ? c('workout name') : c('title'));
    const rawDate = isStrong ? c('date') : c('start time');
    const start = parseImportDate(rawDate);
    const exerciseName = cleanWorkoutName(isStrong ? c('exercise name') : c('exercise title'));
    if (!start) { skipped.badDates++; continue; }
    if (!exerciseName) { skipped.noExercise++; continue; }

    let kind: WorkoutSetKind | 'note';
    let setIndex: number | null = null;
    if (isStrong) {
      const k = strongKind(c('set order'));
      if (k === 'rest') { skipped.restTimers++; continue; }
      kind = k;
      if (/^\d+$/.test(c('set order'))) setIndex = Number(c('set order'));
    } else {
      kind = hevyKind(c('set type'));
      setIndex = n(c('set index'));
    }

    const key = rawDateKey(rawDate);
    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        title,
        rawDate,
        start,
        end: isStrong ? null : parseImportDate(c('end time')),
        durationSeconds: isStrong ? parseImportDuration(c('duration') || c('duration sec') || c('workout duration')) : null,
        notes: isStrong ? c('workout notes') : c('description'),
        sets: [],
        order: [],
        exerciseNotes: new Map(),
      };
      drafts.set(key, draft);
    }

    if (kind === 'note') {
      const noteText = c('notes');
      if (!noteText) { skipped.looseNotes++; continue; }
      const nk = exerciseNameKey(exerciseName);
      draft.exerciseNotes.set(nk, [...(draft.exerciseNotes.get(nk) ?? []), noteText]);
      continue;
    }

    // The unit this row's weight is in: its own column, else the header's, else the fallback.
    let unit: WeightUnit = fallback;
    let rawWeight: number | null;
    if (!isStrong && (hasKgHeader || hasLbHeader)) {
      const kg = n(c('weight kg'));
      const lb = n(c('weight lbs')) ?? n(c('weight lb'));
      if (kg !== null && kg !== 0) { unit = 'kg'; rawWeight = kg; sawUnit = true; }
      else if (lb !== null && lb !== 0) { unit = 'lb'; rawWeight = lb; sawUnit = true; }
      else rawWeight = null;
    } else if (isStrong && (hasKgHeader || hasLbHeader)) {
      unit = hasKgHeader ? 'kg' : 'lb';
      rawWeight = n(c(hasKgHeader ? 'weight kg' : header.includes('weight lbs') ? 'weight lbs' : 'weight lb'));
      sawUnit = true;
    } else {
      rawWeight = n(c('weight'));
      if (hasWeightUnitColumn) {
        // A unit column is the file saying its unit: "lbs", or blank for kilograms.
        unit = unitFromWord(c('weight unit')) ?? 'kg';
        sawUnit = true;
      }
    }
    if (rawWeight !== null && rawWeight !== 0) sawWeight = true;

    // Distance: a header that names its unit, a unit column, or neither (then the person's unit).
    let distanceUnit = '';
    if (distanceHeader === 'distance km') distanceUnit = 'km';
    else if (distanceHeader === 'distance miles' || distanceHeader === 'distance mi') distanceUnit = 'mi';
    else if (distanceHeader === 'distance' && hasDistanceUnitColumn) distanceUnit = c('distance unit');
    else if (distanceHeader === 'distance') distanceUnit = fallback === 'lb' ? 'mi' : 'km';
    const distance = distanceHeader ? distanceMeters(n(c(distanceHeader)), distanceUnit) : null;
    if (distance !== null && distance !== 0 && distanceHeader === 'distance' && !hasDistanceUnitColumn) sawBareDistance = true;

    const seconds = n(isStrong ? c('seconds') : c('duration seconds'));
    const reps = n(c('reps'));
    const set: ImportedSet = {
      exerciseName,
      kind,
      weightKg: weightKg(rawWeight, unit),
      reps: reps === null || reps === 0 ? null : Math.round(reps),
      durationSeconds: seconds === null || seconds === 0 ? null : Math.round(seconds),
      distanceM: distance === null || distance === 0 ? null : distance,
      rpe: (() => { const r = n(c('rpe')); return r !== null && r >= 1 && r <= 10 ? r : null; })(),
      note: (isStrong ? c('notes') : c('exercise notes')) || null,
      supersetKey: !isStrong && c('superset id') ? `ss-${c('superset id')}` : null,
    };
    if (set.weightKg === null && !set.reps && set.durationSeconds === null && set.distanceM === null) {
      skipped.emptySets++;
      continue;
    }
    draft.sets.push(set);
    draft.order.push(setIndex);
  }

  const sessions: ImportedSession[] = [];
  for (const d of drafts.values()) {
    if (d.sets.length === 0) {
      // A workout whose every row was a rest timer or nothing: its notes have nothing to hang on.
      for (const notes of d.exerciseNotes.values()) skipped.looseNotes += notes.length;
      continue;
    }
    const title = d.title || 'Workout';
    const startedAt = d.start.toISOString();
    let end = d.end ?? (d.durationSeconds !== null ? new Date(d.start.getTime() + d.durationSeconds * 1000) : d.start);
    if (end.getTime() < d.start.getTime()) end = d.start;
    const sets = orderSets(d.sets, d.order, source === 'hevy');
    // A Strong "Note" row is an exercise's note, and a set is where this app keeps one:
    // it goes on that exercise's first set, ahead of the set's own note.
    for (const [noteKey, notes] of d.exerciseNotes) {
      const first = sets.find(s => exerciseNameKey(s.exerciseName) === noteKey);
      if (!first) { skipped.looseNotes += notes.length; continue; }
      first.note = [...notes, ...(first.note ? [first.note] : [])].join('\n');
    }
    sessions.push({
      id: importSessionId(source, d.rawDate),
      source,
      title,
      startedAt,
      startPrecisionMs: source === 'hevy' ? 60_000 : 1000,
      endedAt: end.toISOString(),
      notes: d.notes,
      sets,
    });
  }
  sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (sessions.length === 0) return { ok: false, reason: 'noRows' };

  return {
    ok: true,
    source,
    sessions,
    unitAssumed: (hasAnyWeightColumn && sawWeight && !sawUnit) || sawBareDistance,
    skippedRows: sumSkipped(skipped),
    skipped,
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

/**
 * How a name was matched. `exact` and `words` are decided by the app: the same
 * name, or the same words in another order. `suggest` is only a guess, the best
 * candidate for a name the app won't decide on (a typo, an extra word, a
 * different variant), so the review sheet lists it under "Needs a choice" with
 * that candidate ready to confirm in one tap. `none` has no candidate at all.
 */
export type AutoMatch = { kind: 'exact' | 'words'; exerciseId: string; exerciseName: string };
export type SuggestedMatch = { kind: 'suggest'; exerciseId: string; exerciseName: string };
export type NameMatch = AutoMatch | SuggestedMatch | { kind: 'none' };

/** Whether the app decides this match itself, rather than asking. */
export const isAutoMatch = (m: NameMatch): m is AutoMatch => m.kind === 'exact' || m.kind === 'words';

/**
 * Words of a name for comparing: lowercased, hyphens and punctuation as
 * spaces, a plural "s" dropped, and the parenthesised equipment Strong and
 * Hevy append ("Bench Press (Barbell)") as just more words. So that name and
 * the library's "Barbell bench press" come out as the same set.
 */
export function nameWords(name: string): string[] {
  return aliasPhrases(name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/**
 * Other apps' wordings of a movement the library names another way, as a
 * phrase swapped for the library's before the words are compared. Both sides go
 * through it, so a pair only has to agree after it. Each is the same exercise,
 * not a near one ("bicep curl" is a curl, a "chest fly" is a fly).
 */
const PHRASE_ALIASES: [RegExp, string][] = [
  [/\bbiceps? curl/g, 'curl'],
  [/\bchest fly\b/g, 'fly'],
  [/\boverhead press\b/g, 'shoulder press'],
  [/\bskullcrusher/g, 'skull crusher'],
  [/\bpull ?aparts?\b/g, 'pull apart'],
  [/\bbanded\b/g, 'band'],
  [/\bstraight arm lat pulldown\b/g, 'straight arm pulldown'],
  [/\bfly crossovers?\b/g, 'fly'],
  [/^treadmill$/g, 'treadmill run'],
  [/\bfarmer[\u2019']?s (walk|carry)\b/g, 'farmer carry'],
];
const aliasPhrases = (lower: string) => PHRASE_ALIASES.reduce((t, [re, to]) => t.replace(re, to), lower);

/** The equipment words a library name spells out, which the file keeps in brackets instead. */
const EQUIPMENT_WORDS: Partial<Record<ExerciseEquipment, string[]>> = {
  barbell: ['barbell'], dumbbell: ['dumbbell'], kettlebell: ['kettlebell'], machine: ['machine'],
  cable: ['cable'], smith_machine: ['smith', 'machine'], ez_bar: ['ez', 'bar'], trap_bar: ['trap', 'bar'],
  band: ['band'], bodyweight: ['bodyweight'],
};
const BRACKET_EQUIPMENT: Record<string, ExerciseEquipment> = {
  barbell: 'barbell', dumbbell: 'dumbbell', kettlebell: 'kettlebell', machine: 'machine', cable: 'cable',
  'smith machine': 'smith_machine', 'ez bar': 'ez_bar', 'trap bar': 'trap_bar', band: 'band', bodyweight: 'bodyweight',
};

/** A bent-over row is the library's row on that equipment, which names it another way. Keyed by equipment and the sorted words. */
const MOVEMENT_ALIASES: Record<string, string> = {
  'dumbbell|bent over row': 'two arm row',
  'barbell|bent over row': 'row',
  'machine|press seated shoulder': 'shoulder press',
  'dumbbell|delt fly rear reverse': 'bent over fly reverse',
};

/** "Hammer Curl (Dumbbell)" as its words without the equipment, and the equipment. Null when no bracket names one. */
function splitEquipment(name: string): { base: string[]; equipment: ExerciseEquipment } | null {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
  const equipment = m && BRACKET_EQUIPMENT[nameWords(m[2]).join(' ')];
  if (!m || !equipment) return null;
  const base = [...new Set(nameWords(m[1]))].sort();
  const alias = MOVEMENT_ALIASES[`${equipment}|${base.join(' ')}`];
  return { base: alias ? alias.split(' ').sort() : base, equipment };
}

const sortedWords = (name: string) => [...new Set(nameWords(name))].sort();

/** A suggestion has to share at least this fraction of the words (shared over all distinct words), or be one letter out. */
const SUGGEST_MIN_OVERLAP = 0.8;

/**
 * The catalog exercise a file's name means, or the closest candidate to offer.
 *
 * Only two things are decided for the person: the exact name key, and the same
 * words in any order (so "Bench Press (Barbell)" is "Barbell bench press" and
 * "pull up" is "Pull-up"). Everything fuzzier is a `suggest`: one letter out on
 * the whole name, or most of the words shared. A one-letter difference is often
 * a different exercise ("Back squat" and "Hack squat"), and most of the words
 * shared is often a different variant ("Decline bench press (Smith machine)" and
 * "Smith machine bench press"), and either would be written into history. So the
 * best candidate is preselected on the sheet and the person confirms it with a
 * tap. Nothing is remembered: the matching is the same every time, and only what
 * the person confirms is saved.
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
  // Two exercises with the same words are two variants to choose between.
  if (sameWords.length > 1) return { kind: 'suggest', exerciseId: sameWords[0].id, exerciseName: sameWords[0].name };

  // Hevy and Strong write the equipment in brackets and the library often leaves
  // it out of the name when it is the usual one ("Hammer curl" is a dumbbell
  // lift, "Lat pulldown" a cable one). The movement's own words matching and the
  // equipment agreeing is the same exercise; the movement matching on another
  // piece of equipment is only offered.
  const split = splitEquipment(name);
  let onOtherEquipment: CatalogExercise | undefined;
  if (split) {
    const sameMovement = live.filter(e => {
      const drop = EQUIPMENT_WORDS[e.equipment] ?? EQUIPMENT_WORDS[machineParent(e.equipment) ?? e.equipment] ?? [];
      const w = sortedWords(e.name).filter(x => !drop.includes(x));
      return w.length === split.base.length && w.every((x, i) => x === split.base[i]);
    });
    // A file's "(Machine)" is every strength machine here, since the library files each under its own.
    const agreeing = sameMovement.filter(e => e.equipment === split.equipment || machineParent(e.equipment) === split.equipment);
    if (agreeing.length === 1) return { kind: 'words', exerciseId: agreeing[0].id, exerciseName: agreeing[0].name };
    // Only offered when nothing closer turns up below ("Squat (Barbell)" has a better candidate than the bodyweight squat).
    onOtherEquipment = agreeing[0] ?? sameMovement[0];
  }

  // A name holding every word of the file's name ("Back Squat" in "Barbell back
  // squat") is offered ahead of anything scored by overlap or a one-letter typo,
  // fewest extra words first: the file's name is usually the library's with the
  // equipment left off, and a typo match is the one most likely to be a
  // different lift ("Hack squat").
  const compact = words.join('');
  const best = live
    .map(e => {
      const w = sortedWords(e.name);
      const shared = w.filter(x => words.includes(x)).length;
      const overlap = shared / (new Set([...w, ...words]).size);
      const typo = compact.length >= MIN_SIMILAR_LENGTH && withinOneEdit(compact, w.join(''));
      // One word ("Press") is held by half the library, so it says nothing.
      const extra = words.length >= 2 && shared === words.length ? w.length - words.length : null;
      return { e, extra, score: typo ? Math.max(overlap, 0.9) : overlap };
    })
    .filter(x => x.extra !== null || x.score >= SUGGEST_MIN_OVERLAP)
    .sort((a, b) =>
      (a.extra === null ? 1 : 0) - (b.extra === null ? 1 : 0)
      || (a.extra ?? 0) - (b.extra ?? 0)
      || b.score - a.score
      || a.e.name.localeCompare(b.e.name))[0];
  if (!best) {
    return onOtherEquipment
      ? { kind: 'suggest', exerciseId: onOtherEquipment.id, exerciseName: onOtherEquipment.name }
      : { kind: 'none' };
  }
  return { kind: 'suggest', exerciseId: best.e.id, exerciseName: best.e.name };
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
  /** How finely the file states the start (1000 or 60000 ms), for matching against the log. */
  startPrecisionMs: number;
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
 * The sessions already in the log, indexed for "have I got this one?": by id,
 * and by start time at each precision a file can state (whole seconds, whole
 * minutes). The title is deliberately not part of it: a workout renamed since
 * it was exported is still the same workout, and the app's own export truncates
 * a start to the second while the session keeps its milliseconds.
 */
export interface ExistingIndex {
  ids: Set<string>;
  seconds: Set<number>;
  minutes: Set<number>;
}

const slot = (iso: string, precisionMs: number) => Math.floor(new Date(iso).getTime() / precisionMs);

export function indexExisting(existing: readonly Pick<WorkoutSession, 'id' | 'startedAt'>[]): ExistingIndex {
  const index: ExistingIndex = { ids: new Set(), seconds: new Set(), minutes: new Set() };
  for (const s of existing) indexAdd(index, s.id, s.startedAt);
  return index;
}

export function indexAdd(index: ExistingIndex, id: string, startedAt: string): void {
  index.ids.add(id);
  index.seconds.add(slot(startedAt, 1000));
  index.minutes.add(slot(startedAt, 60_000));
}

/** Whether the log has this session already: the same id, or a start at the same second (or minute, for a source that only writes minutes). */
export function indexHas(
  index: ExistingIndex,
  session: { id: string; startedAt: string; startPrecisionMs: number },
): boolean {
  if (index.ids.has(session.id)) return true;
  return session.startPrecisionMs >= 60_000
    ? index.minutes.has(slot(session.startedAt, 60_000))
    : index.seconds.has(slot(session.startedAt, 1000));
}

/** The sessions the log doesn't have yet, and how many it already had (same id, or same start time). */
export function splitDuplicates(
  sessions: readonly ImportedSession[],
  existing: readonly Pick<WorkoutSession, 'id' | 'startedAt'>[],
): { fresh: ImportedSession[]; duplicates: number } {
  const index = indexExisting(existing);
  const fresh = sessions.filter(s => !indexHas(index, s));
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

/**
 * What an import will write, from the sessions in a file, what the person
 * decided for each name, and the sessions already in the log.
 *
 * A name with no decision is treated as skipped here; the sheet holds its
 * Import button until every name has one, so this never runs on a gap. A
 * session is a duplicate when the log has its id or one that started at the
 * same time (`indexHas`), whatever it is called.
 */
export function buildImportPlan(
  sessions: readonly ImportedSession[],
  resolutions: Readonly<Record<string, NameResolution | undefined>>,
  existing: readonly Pick<WorkoutSession, 'id' | 'startedAt'>[],
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
      startPrecisionMs: session.startPrecisionMs,
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
