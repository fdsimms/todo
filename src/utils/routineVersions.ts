// Routine and program history (docs/arch/workouts.md, "Routine and program
// history"). The rows are stored (a plan that is overwritten is gone, so this
// can't be derived from the workouts the way progress is); everything said
// about them is worked out here: their numbers, which version a workout
// counts toward, what changed between two, and how each went.
//
// Three rules hold it together:
//   - A version is what was trained on. A save made after a workout on the
//     current version is a new one; a save made before any is an amendment
//     (`routineVersionTrained` is the question the editor asks before saving).
//   - Numbers are positions in time order, never stored, so two devices that
//     each added one keep both rather than meeting on two "version 5"s.
//   - A routine or program with no rows yet has one implicit first version,
//     whose id every device derives the same way (`spawnSeed`), so a workout
//     can name it before the row is written.
import type {
  ProgressionScheme,
  WorkoutProgram,
  WorkoutProgramVersion,
  WorkoutRoutine,
  WorkoutRoutineItem,
  WorkoutRoutineVersion,
  WorkoutSession,
} from '../types';
import { derivedId, spawnSeed } from './syncIds';
import { itemShape, PROGRESSION_LABELS } from './workoutRoutine';
import { formatRestSeconds, formatWeightWithUnit } from './workoutData';
import type { WeightUnit } from './weightLog';
import { format } from 'date-fns/format';

// ==== the versions of one routine ====

export function initialRoutineVersionId(routineId: string): string {
  return derivedId(spawnSeed.routineVersionInitial(routineId));
}

export function initialProgramVersionId(programId: string): string {
  return derivedId(spawnSeed.programVersionInitial(programId));
}

const byTime = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The version a routine saved before versions were kept stands for: its content now, dated when it was made. */
export function implicitRoutineVersion(routine: WorkoutRoutine): WorkoutRoutineVersion {
  return {
    id: initialRoutineVersionId(routine.id),
    routineId: routine.id,
    createdAt: routine.createdAt,
    name: routine.name,
    notes: routine.notes,
    items: routine.items,
    source: 'initial',
    label: null,
  };
}

/** One routine's versions, oldest first, with the implicit first one standing in when none is stored. */
export function routineVersionsOf(
  routine: WorkoutRoutine,
  all: readonly WorkoutRoutineVersion[],
): WorkoutRoutineVersion[] {
  const own = all.filter(v => v.routineId === routine.id).sort(byTime);
  return own.length > 0 ? own : [implicitRoutineVersion(routine)];
}

/** The version the routine is on: the one it names, or its newest when it names none this device has. */
export function currentRoutineVersion(
  routine: WorkoutRoutine,
  versions: readonly WorkoutRoutineVersion[],
): WorkoutRoutineVersion {
  return versions.find(v => v.id === routine.currentVersionId) ?? versions[versions.length - 1];
}

/** A version's number: its place in time order, from 1. Zero for an id not in the list. */
export function versionNumber(versions: readonly { id: string }[], id: string): number {
  return versions.findIndex(v => v.id === id) + 1;
}

/** The version in effect at an instant: the newest made by then, or the first when none was. */
export function versionAt<T extends { createdAt: string }>(versions: readonly T[], at: string): T | undefined {
  let pick = versions[0];
  for (const v of versions) if (v.createdAt <= at) pick = v;
  return pick;
}

/**
 * The version a workout counts toward: the one it recorded at its start, or,
 * for one from before versions were kept (or naming a version this device
 * hasn't received), the version in effect when it started.
 */
export function sessionVersionId(
  session: Pick<WorkoutSession, 'routineVersionId' | 'startedAt'>,
  versions: readonly WorkoutRoutineVersion[],
): string | null {
  if (session.routineVersionId && versions.some(v => v.id === session.routineVersionId)) return session.routineVersionId;
  return versionAt(versions, session.startedAt)?.id ?? null;
}

/** A routine's finished workouts, oldest first, each with the version it counts toward. */
export function routineSessionsByVersion(
  routine: WorkoutRoutine,
  versions: readonly WorkoutRoutineVersion[],
  sessions: readonly WorkoutSession[],
): Map<string, WorkoutSession[]> {
  const out = new Map<string, WorkoutSession[]>(versions.map(v => [v.id, []]));
  const own = sessions
    .filter(s => s.routineId === routine.id && s.endedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  for (const s of own) {
    const id = sessionVersionId(s, versions);
    if (id) out.get(id)?.push(s);
  }
  return out;
}

/**
 * Whether a finished workout was done on the routine's current version, which
 * is what makes the next save a question: start a new version, or change the
 * one those workouts were done on. A routine nobody has trained on just saves.
 */
export function routineVersionTrained(
  routine: WorkoutRoutine,
  allVersions: readonly WorkoutRoutineVersion[],
  sessions: readonly WorkoutSession[],
): boolean {
  const versions = routineVersionsOf(routine, allVersions);
  const current = currentRoutineVersion(routine, versions);
  return (routineSessionsByVersion(routine, versions, sessions).get(current.id) ?? []).length > 0;
}

/** Whether a save changes what a version holds. The name alone doesn't: renaming is not a new plan. */
export function routineContentChanged(
  a: Pick<WorkoutRoutine, 'notes' | 'items'>,
  b: Pick<WorkoutRoutine, 'notes' | 'items'>,
): boolean {
  return a.notes.trim() !== b.notes.trim() || JSON.stringify(a.items) !== JSON.stringify(b.items);
}

// ==== what changed between two versions ====

/** One difference in one exercise. Weights are one dumbbell's kilograms, as stored; rest is resolved. */
export type ItemChange =
  | { field: 'sets'; from: number; to: number }
  | { field: 'reps'; from: string | null; to: string | null }
  | { field: 'weight'; from: number | null; to: number | null }
  | { field: 'rest'; from: number; to: number }
  | { field: 'warmup'; from: WarmupKind; to: WarmupKind }
  | { field: 'progression'; from: ProgressionScheme | null; to: ProgressionScheme | null }
  | { field: 'superset'; from: boolean; to: boolean };

/** How an item warms up: the ramp, a number of warm-up sets, or none. */
export type WarmupKind = 'ramp' | 'none' | number;

export type ItemDiff =
  | { status: 'same'; exerciseId: string }
  | { status: 'changed'; exerciseId: string; changes: ItemChange[] }
  | { status: 'added'; exerciseId: string; sets: number }
  | { status: 'removed'; exerciseId: string }
  | { status: 'swapped'; exerciseId: string; fromExerciseId: string };

export interface RoutineDiff {
  /** The newer side's exercises in its order, each marked; removed ones follow, in the older side's order. */
  items: ItemDiff[];
  notesChanged: boolean;
  /** The exercises both sides hold come in a different order. */
  orderChanged: boolean;
}

function repRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min == null || max == null || min === max) return String(min ?? max);
  return `${min}-${max}`;
}

function warmupOf(item: WorkoutRoutineItem): WarmupKind {
  if (item.warmupRamp) return 'ramp';
  const n = itemShape(item).warmups;
  return n > 0 ? n : 'none';
}

const setsOf = (item: WorkoutRoutineItem) => item.targets.filter(t => t.kind !== 'warmup').length;

function itemChanges(a: WorkoutRoutineItem, b: WorkoutRoutineItem, defaultRestSeconds: number): ItemChange[] {
  const out: ItemChange[] = [];
  const sa = itemShape(a);
  const sb = itemShape(b);
  if (setsOf(a) !== setsOf(b)) out.push({ field: 'sets', from: setsOf(a), to: setsOf(b) });
  const ra = repRange(sa.repsMin, sa.repsMax);
  const rb = repRange(sb.repsMin, sb.repsMax);
  if (ra !== rb) out.push({ field: 'reps', from: ra, to: rb });
  if ((sa.weightKg ?? null) !== (sb.weightKg ?? null)) out.push({ field: 'weight', from: sa.weightKg ?? null, to: sb.weightKg ?? null });
  const resta = a.restSeconds ?? defaultRestSeconds;
  const restb = b.restSeconds ?? defaultRestSeconds;
  if (resta !== restb) out.push({ field: 'rest', from: resta, to: restb });
  const wa = warmupOf(a);
  const wb = warmupOf(b);
  if (wa !== wb) out.push({ field: 'warmup', from: wa, to: wb });
  const pa = a.progression?.scheme ?? null;
  const pb = b.progression?.scheme ?? null;
  if (pa !== pb) out.push({ field: 'progression', from: pa, to: pb });
  if (Boolean(a.supersetKey) !== Boolean(b.supersetKey)) out.push({ field: 'superset', from: Boolean(a.supersetKey), to: Boolean(b.supersetKey) });
  return out;
}

/** Each item keyed by its exercise and which occurrence of it this is, so a routine holding one twice still pairs. */
function keyed(items: readonly WorkoutRoutineItem[]): { key: string; item: WorkoutRoutineItem; index: number }[] {
  const seen = new Map<string, number>();
  return items.map((item, index) => {
    const n = seen.get(item.exerciseId) ?? 0;
    seen.set(item.exerciseId, n + 1);
    return { key: `${item.exerciseId}#${n}`, item, index };
  });
}

/**
 * What changed from one version to another. An exercise taken out and another
 * put in its place (the same position, nothing else between) reads as a swap,
 * the way the finish summary words one.
 */
export function diffRoutines(
  from: Pick<WorkoutRoutineVersion, 'items' | 'notes'>,
  to: Pick<WorkoutRoutineVersion, 'items' | 'notes'>,
  defaultRestSeconds: number,
): RoutineDiff {
  const a = keyed(from.items);
  const b = keyed(to.items);
  const inA = new Map(a.map(e => [e.key, e]));
  const inB = new Set(b.map(e => e.key));
  const removed = a.filter(e => !inB.has(e.key));
  const swappedOut = new Set<string>();
  const items: ItemDiff[] = b.map(e => {
    const was = inA.get(e.key);
    if (was) {
      const changes = itemChanges(was.item, e.item, defaultRestSeconds);
      return changes.length > 0
        ? { status: 'changed', exerciseId: e.item.exerciseId, changes }
        : { status: 'same', exerciseId: e.item.exerciseId };
    }
    const partner = removed.find(r => r.index === e.index && !swappedOut.has(r.key));
    if (partner) {
      swappedOut.add(partner.key);
      return { status: 'swapped', exerciseId: e.item.exerciseId, fromExerciseId: partner.item.exerciseId };
    }
    return { status: 'added', exerciseId: e.item.exerciseId, sets: setsOf(e.item) };
  });
  for (const r of removed) if (!swappedOut.has(r.key)) items.push({ status: 'removed', exerciseId: r.item.exerciseId });
  const commonA = a.filter(e => inB.has(e.key)).map(e => e.key);
  const commonB = b.filter(e => inA.has(e.key)).map(e => e.key);
  return {
    items,
    notesChanged: from.notes.trim() !== to.notes.trim(),
    orderChanged: commonA.join('|') !== commonB.join('|'),
  };
}

/** Whether a diff holds anything at all. */
export function diffIsEmpty(diff: RoutineDiff): boolean {
  return !diff.notesChanged && !diff.orderChanged && diff.items.every(i => i.status === 'same');
}

/** How a change reads, split so the old value can be drawn struck through beside the new one. */
export interface ChangeParts {
  label: string;
  from: string;
  to: string;
}

function warmupText(w: WarmupKind): string {
  if (w === 'ramp') return 'Ramp';
  if (w === 'none') return 'None';
  return w === 1 ? '1 set' : `${w} sets`;
}

/**
 * A change in words. `scale` is how many dumbbells a weight is shown for (2
 * for a pair total), as everywhere a dumbbell weight is shown.
 */
export function changeParts(c: ItemChange, unit: WeightUnit, scale = 1): ChangeParts {
  switch (c.field) {
    case 'sets':
      return { label: 'Sets', from: String(c.from), to: String(c.to) };
    case 'reps':
      return { label: 'Reps', from: c.from ?? 'Any', to: c.to ?? 'Any' };
    case 'weight': {
      const w = (kg: number | null) => (kg == null ? 'As last time' : formatWeightWithUnit(kg * scale, unit));
      return { label: 'Weight', from: w(c.from), to: w(c.to) };
    }
    case 'rest':
      return { label: 'Rest', from: formatRestSeconds(c.from), to: formatRestSeconds(c.to) };
    case 'warmup':
      return { label: 'Warm-up', from: warmupText(c.from), to: warmupText(c.to) };
    case 'progression': {
      const p = (s: ProgressionScheme | null) => (s ? PROGRESSION_LABELS[s] : 'None');
      return { label: 'Progression', from: p(c.from), to: p(c.to) };
    }
    case 'superset':
      return { label: 'Superset', from: c.from ? 'Yes' : 'No', to: c.to ? 'Yes' : 'No' };
  }
}

/** A change as a short clause for a one-line summary ("3 → 4 sets", "rest 2:00 → 1:30"). */
function changeClause(c: ItemChange, unit: WeightUnit, scale: number): string {
  if (c.field === 'sets') return `${c.from} → ${c.to} sets`;
  const p = changeParts(c, unit, scale);
  return `${p.label.toLowerCase()} ${p.from} → ${p.to}`;
}

/**
 * The one line under a version in History: what it changed from the one
 * before, the first few things and how many more. Null when nothing did.
 */
export function summarizeDiff(
  diff: RoutineDiff,
  nameOf: (exerciseId: string) => string,
  unit: WeightUnit,
  scaleOf: (exerciseId: string) => number = () => 1,
  max = 2,
): string | null {
  const parts: string[] = [];
  for (const d of diff.items) {
    if (d.status === 'changed') {
      parts.push(`${nameOf(d.exerciseId)} ${d.changes.map(c => changeClause(c, unit, scaleOf(d.exerciseId))).join(', ')}`);
    } else if (d.status === 'added') parts.push(`added ${nameOf(d.exerciseId)}`);
    else if (d.status === 'removed') parts.push(`removed ${nameOf(d.exerciseId)}`);
    else if (d.status === 'swapped') parts.push(`${nameOf(d.fromExerciseId)} swapped for ${nameOf(d.exerciseId)}`);
  }
  if (diff.orderChanged) parts.push('new order');
  if (diff.notesChanged) parts.push('notes changed');
  if (parts.length === 0) return null;
  const shown = parts.slice(0, max);
  const more = parts.length - shown.length;
  const line = shown.join('; ') + (more > 0 ? `; and ${more} more` : '');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// ==== a routine's history, as listed ====

export interface RoutineVersionEntry {
  version: WorkoutRoutineVersion;
  /** From 1, oldest first. */
  number: number;
  current: boolean;
  /** When it took over, and when the next one did (null while it is the newest). */
  from: string;
  until: string | null;
  /** Its finished workouts, oldest first. */
  sessions: WorkoutSession[];
  /** The version before it, for "what changed"; null for the first. */
  previous: WorkoutRoutineVersion | null;
}

/** A routine's history, newest first. */
export function routineHistory(
  routine: WorkoutRoutine,
  allVersions: readonly WorkoutRoutineVersion[],
  sessions: readonly WorkoutSession[],
): RoutineVersionEntry[] {
  const versions = routineVersionsOf(routine, allVersions);
  const current = currentRoutineVersion(routine, versions);
  const bySession = routineSessionsByVersion(routine, versions, sessions);
  return versions
    .map((version, i) => ({
      version,
      number: i + 1,
      current: version.id === current.id,
      from: version.createdAt,
      until: versions[i + 1]?.createdAt ?? null,
      sessions: bySession.get(version.id) ?? [],
      previous: versions[i - 1] ?? null,
    }))
    .reverse();
}

export interface VersionStats {
  workouts: number;
  /** Mean lifted volume over its workouts that lifted any; null when none did. */
  avgVolumeKg: number | null;
  lastAt: string | null;
}

/** How a version went, in plain figures. Nothing here ranks one version above another. */
export function versionStats(
  sessions: readonly WorkoutSession[],
  volumeKgBySession: Readonly<Record<string, number>>,
): VersionStats {
  const volumes = sessions.map(s => volumeKgBySession[s.id] ?? 0).filter(v => v > 0);
  return {
    workouts: sessions.length,
    avgVolumeKg: volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null,
    lastAt: sessions.length > 0 ? sessions[sessions.length - 1].startedAt : null,
  };
}

/**
 * When a version was the one in use, for its row in History: "Since Oct 14"
 * while it is the newest, "Sep 1 to Sep 21" once another took over (the day
 * before the next began), and one day for a version replaced the day it was
 * made. The year shows only when it isn't this one.
 */
export function versionSpanText(from: string, until: string | null, now: Date = new Date()): string {
  const start = new Date(from);
  const day = (d: Date) => format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
  if (until === null) return `Since ${day(start)}`;
  const next = new Date(until);
  const end = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return end <= startDay ? day(start) : `${day(start)} to ${day(end)}`;
}

/** "3 workouts", "1 workout", "No workouts". */
export function workoutCountText(n: number): string {
  return n === 0 ? 'No workouts' : n === 1 ? '1 workout' : `${n} workouts`;
}

/**
 * The line under the finish summary's "Update {routine}?" card: what Save
 * will do to the routine's versions with what is selected. `old` is the
 * version the workout was done on when that isn't the current one.
 */
export function finishVersionText(input: {
  current: number;
  old: number | null;
  restoring: boolean;
  changes: number;
  inProgram: boolean;
}): string {
  const { current, old, restoring, changes, inProgram } = input;
  const program = inProgram ? ' The program uses the same routine.' : '';
  if (old !== null) {
    if (!restoring) return `With nothing selected, the routine stays on version ${current}, and this workout counts toward version ${old}.`;
    const what = changes > 0 ? `Version ${old} with ${changes === 1 ? 'this change' : 'these changes'}` : `Version ${old}`;
    return `${what} becomes version ${current + 1}, the newest. Version ${current} stays in History.${program}`;
  }
  if (changes === 0) return `With nothing selected, the routine stays on version ${current}. Your logged workout is kept either way.`;
  return `Saving makes ${changes === 1 ? 'this' : 'these'} version ${current + 1}. Version ${current} stays in History, and this workout counts toward it.${program}`;
}

/** What follows a name copied by hand to start over: "v2", "version 3", "(2)", "2", "copy", "new". */
const COPY_SUFFIX = /^[-–:]?\s*(v(ersion)?\s*\d+|\(\d+\)|#?\d+|copy|new|updated)$/i;

/**
 * Pairs of routines where one looks like a copy of the other made to start a
 * new version by hand ("HW Day One" and "HW Day One v2"): what Merge in
 * History is for. A name only, so it is a suggestion to look, never acted on.
 */
export function likelyRoutineCopies(
  routines: readonly Pick<WorkoutRoutine, 'id' | 'name'>[],
): { originalId: string; copyId: string }[] {
  const out: { originalId: string; copyId: string }[] = [];
  for (const a of routines) {
    const base = a.name.trim().toLowerCase();
    if (!base) continue;
    for (const b of routines) {
      if (a.id === b.id) continue;
      const other = b.name.trim().toLowerCase();
      if (other.length > base.length && other.startsWith(base) && COPY_SUFFIX.test(other.slice(base.length).trim())) {
        out.push({ originalId: a.id, copyId: b.id });
      }
    }
  }
  return out;
}

/** The name a version copied out to a routine of its own starts with. */
export function versionCopyName(routineName: string, number: number): string {
  return `${routineName} (version ${number})`;
}

// ==== programs ====

/** What a program version holds, and what a save compares to decide whether it changed. */
export type ProgramStructure = Pick<WorkoutProgram, 'name' | 'weeks' | 'rotation' | 'scheme'>;

export function implicitProgramVersion(program: WorkoutProgram): WorkoutProgramVersion {
  return {
    id: initialProgramVersionId(program.id),
    programId: program.id,
    createdAt: program.createdAt,
    name: program.name,
    weeks: program.weeks,
    rotation: program.rotation,
    scheme: program.scheme,
    routineVersionIds: {},
    label: null,
  };
}

export function programVersionsOf(
  program: WorkoutProgram,
  all: readonly WorkoutProgramVersion[],
): WorkoutProgramVersion[] {
  const own = all.filter(v => v.programId === program.id).sort(byTime);
  return own.length > 0 ? own : [implicitProgramVersion(program)];
}

export function currentProgramVersion(
  program: WorkoutProgram,
  versions: readonly WorkoutProgramVersion[],
): WorkoutProgramVersion {
  return versions.find(v => v.id === program.currentVersionId) ?? versions[versions.length - 1];
}

/**
 * Whether a save changes the program's structure: its rotation, length or
 * scheme. A rename is not a new block, as a routine's isn't, and training
 * maxes, the start date and archiving aren't structure.
 */
export function programStructureChanged(a: ProgramStructure, b: ProgramStructure): boolean {
  return a.weeks !== b.weeks || a.scheme !== b.scheme || a.rotation.join('|') !== b.rotation.join('|');
}

/** What changed in a program's structure from one version to another. */
export interface ProgramDiff {
  /** Routines the newer rotation holds more times than the older (once each per extra slot). */
  added: string[];
  removed: string[];
  /** The routines both hold come round in a different order. */
  orderChanged: boolean;
  weeks: { from: number | null; to: number | null } | null;
  scheme: { from: ProgressionScheme | null; to: ProgressionScheme | null } | null;
}

/** Counts each routine's slots, so a routine done twice a cycle compares as two. */
function slotCounts(rotation: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of rotation) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

export function diffPrograms(
  from: Pick<WorkoutProgramVersion, 'rotation' | 'weeks' | 'scheme'>,
  to: Pick<WorkoutProgramVersion, 'rotation' | 'weeks' | 'scheme'>,
): ProgramDiff {
  const a = slotCounts(from.rotation);
  const b = slotCounts(to.rotation);
  const added: string[] = [];
  const removed: string[] = [];
  for (const id of new Set(to.rotation)) for (let i = a.get(id) ?? 0; i < b.get(id)!; i++) added.push(id);
  for (const id of new Set(from.rotation)) for (let i = b.get(id) ?? 0; i < a.get(id)!; i++) removed.push(id);
  const common = (list: readonly string[], other: Map<string, number>) => list.filter(id => other.has(id));
  return {
    added,
    removed,
    orderChanged: common(from.rotation, b).join('|') !== common(to.rotation, a).join('|') && added.length === 0 && removed.length === 0,
    weeks: from.weeks !== to.weeks ? { from: from.weeks, to: to.weeks } : null,
    scheme: from.scheme !== to.scheme ? { from: from.scheme, to: to.scheme } : null,
  };
}

export function programDiffIsEmpty(d: ProgramDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && !d.orderChanged && !d.weeks && !d.scheme;
}

/** "8 weeks", or "No end" for an open-ended program. */
export function programWeeksText(weeks: number | null): string {
  return weeks ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : 'No end';
}

/** A progression scheme's name, or "None" for a program that proposes nothing. */
export function programSchemeText(scheme: ProgressionScheme | null): string {
  return scheme ? PROGRESSION_LABELS[scheme] : 'None';
}

/** A program diff as one line, the way `summarizeDiff` words a routine's. Null when nothing changed. */
export function summarizeProgramDiff(d: ProgramDiff, nameOf: (routineId: string) => string): string | null {
  const parts = [
    ...d.added.map(id => `added ${nameOf(id)}`),
    ...d.removed.map(id => `removed ${nameOf(id)}`),
    ...(d.orderChanged ? ['new order'] : []),
    ...(d.weeks ? [`${programWeeksText(d.weeks.from)} → ${programWeeksText(d.weeks.to)}`.replace(/^No end/, 'no end').replace(/→ No end$/, '→ no end')] : []),
    ...(d.scheme ? [`progression ${programSchemeText(d.scheme.from)} → ${programSchemeText(d.scheme.to)}`] : []),
  ];
  if (parts.length === 0) return null;
  const line = parts.join('; ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Whether a workout was finished in the program since its current version took over. */
export function programVersionTrained(
  program: WorkoutProgram,
  allVersions: readonly WorkoutProgramVersion[],
  sessions: readonly WorkoutSession[],
): boolean {
  const versions = programVersionsOf(program, allVersions);
  const current = currentProgramVersion(program, versions);
  // A workout from before the first version counts toward the first, as a
  // routine's does (`sessionVersionId`): one logged after the fact for a day
  // before the program was saved was still done in it.
  const from = current.id === versions[0].id ? '' : current.createdAt;
  return sessions.some(s => s.programId === program.id && s.endedAt !== null && s.startedAt >= from);
}

export interface ProgramRoutineSpan {
  routineId: string;
  /** The routine's version numbers when the block began and when it ended (or now). Null for a routine since deleted. */
  startNumber: number | null;
  endNumber: number | null;
}

export interface ProgramVersionEntry {
  version: WorkoutProgramVersion;
  number: number;
  current: boolean;
  from: string;
  until: string | null;
  workouts: number;
  routines: ProgramRoutineSpan[];
}

/**
 * A program's history, newest first. Each entry is a block: the structure it
 * ran, its workouts, and for each routine in its rotation the version it
 * started on (as the program recorded it) and the one it ended on, so a
 * routine changed partway through a block shows as "version 4 to 5".
 */
export function programHistory(
  program: WorkoutProgram,
  allProgramVersions: readonly WorkoutProgramVersion[],
  routines: readonly WorkoutRoutine[],
  allRoutineVersions: readonly WorkoutRoutineVersion[],
  sessions: readonly WorkoutSession[],
): ProgramVersionEntry[] {
  const versions = programVersionsOf(program, allProgramVersions);
  const current = currentProgramVersion(program, versions);
  const routineById = new Map(routines.map(r => [r.id, r]));
  return versions
    .map((version, i) => {
      const until = versions[i + 1]?.createdAt ?? null;
      const spans: ProgramRoutineSpan[] = [...new Set(version.rotation)].map(routineId => {
        const routine = routineById.get(routineId);
        if (!routine) return { routineId, startNumber: null, endNumber: null };
        const rv = routineVersionsOf(routine, allRoutineVersions);
        const recorded = version.routineVersionIds[routineId];
        const start = recorded && rv.some(v => v.id === recorded) ? recorded : versionAt(rv, version.createdAt)?.id;
        const end = until === null
          ? currentRoutineVersion(routine, rv).id
          : (rv.filter(v => v.createdAt < until).pop() ?? rv[0]).id;
        return {
          routineId,
          startNumber: start ? versionNumber(rv, start) : null,
          endNumber: end ? versionNumber(rv, end) : null,
        };
      });
      return {
        version,
        number: i + 1,
        current: version.id === current.id,
        from: version.createdAt,
        until,
        workouts: sessions.filter(s =>
          s.programId === program.id && s.endedAt !== null && (i === 0 || s.startedAt >= version.createdAt)
          && (until === null || s.startedAt < until)
        ).length,
        routines: spans,
      };
    })
    .reverse();
}
