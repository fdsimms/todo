/**
 * The tools that work at an agent's scale rather than a tap's.
 *
 * A person edits one task at a time because that is what a finger does. An
 * agent asked to "move everything tagged errand to Saturday" or "add these
 * twelve things" would otherwise make twelve calls, any of which can fail
 * halfway and leave the list half-changed with nobody having seen the whole
 * of it first. So these share two rules:
 *
 * - **Preview by default.** `batch_update_tasks` and `quick_add` describe what
 *   they would do and write nothing unless `apply: true`. The person sees the
 *   whole change before any of it happens, which is the only point at which
 *   "no, not that one" is free.
 * - **All or nothing at the check.** A batch with any change that would be
 *   refused is refused whole, before a single write, and says which change and
 *   why. Every individual write still goes through the single-task path
 *   (`updateTask`, `completeTask`, `deferTask` in tools.ts), so a batch can do
 *   nothing a single call could not.
 *
 * `plan_day` and `rebalance_week` only propose. Applying a plan is a batch, so
 * there is one way to change several tasks and it always has a preview.
 */
import { addDays } from 'date-fns/addDays';
import type { Task, TaskDraft } from '../../src/types';
import type { Replica } from './replica';
import type { SerializedTask } from './serialize';
import type { TaskFieldsInput } from './taskFields';
import { describeRepeat, type RepeatInput } from './taskFields';
import { completeTask, deferTask, getTask, updateTask } from './tools';
import { localDateInput } from './timeZone';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ---------------------------------------------------------------------------
// batch_update_tasks
// ---------------------------------------------------------------------------

export const MAX_BATCH = 100;

export type BatchChange =
  | { id: string; action: 'update'; fields: TaskFieldsInput }
  | { id: string; action: 'complete'; deliverableValue?: string | null }
  | { id: string; action: 'defer'; date: string | null };

export interface BatchRow {
  id: string;
  title?: string;
  action: BatchChange['action'];
  /** For an edit: each field that changes, before and after. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  /** For a move: the day asked for, or null for "no date". */
  to?: string | null;
  /** Why this change cannot be made. Any one of these refuses the whole batch. */
  problem?: string;
  /** After applying: what the change produced. */
  result?: unknown;
}

export interface BatchResult {
  applied: boolean;
  rows: BatchRow[];
  /** Present when nothing was written, saying why and what to do. */
  note?: string;
  /** When applying stopped partway (a write failed after the check passed): how many went through first. */
  appliedBeforeFailure?: number;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Check one change without writing it. */
function vet(replica: Replica, change: BatchChange): BatchRow {
  const task = replica.taskById(change.id);
  const row: BatchRow = { id: change.id, action: change.action, ...(task ? { title: replica.displayTitle(task) } : {}) };
  if (!task) return { ...row, problem: `No task with id ${change.id}.` };

  switch (change.action) {
    case 'update': {
      if (task.completed || task.archived) return { ...row, problem: 'That task is completed or archived, so it cannot be edited.' };
      try {
        const patch = replica.taskPatch(change.fields ?? {}, task, !!task.parentId);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const [key, to] of Object.entries(patch)) {
          const from = (task as unknown as Record<string, unknown>)[key];
          if (!same(from, to)) changes[key] = { from: from ?? null, to: to ?? null };
        }
        if (Object.keys(changes).length === 0) return { ...row, problem: 'Nothing would change.' };
        return { ...row, changes };
      } catch (e) {
        return { ...row, problem: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'complete': {
      const options = 'deliverableValue' in change ? { deliverableValue: change.deliverableValue } : undefined;
      const problem = replica.completionProblem(change.id, options);
      return problem ? { ...row, problem } : row;
    }
    case 'defer': {
      if (task.completed) return { ...row, problem: 'That task is already completed.' };
      if (change.date !== null && Number.isNaN(Date.parse(localDateInput(change.date)))) {
        return { ...row, problem: `"${change.date}" is not a date. Use YYYY-MM-DD.` };
      }
      return { ...row, to: change.date };
    }
  }
}

export function batchUpdateTasks(replica: Replica, input: { changes: BatchChange[]; apply?: boolean }): BatchResult {
  const changes = input.changes ?? [];
  if (changes.length === 0) throw new Error('No changes given.');
  if (changes.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} changes in one batch.`);

  const seen = new Set<string>();
  const rows = changes.map(change => {
    const row = vet(replica, change);
    if (seen.has(change.id) && !row.problem) row.problem = 'This task appears twice in the batch. Combine the changes into one.';
    seen.add(change.id);
    return row;
  });

  if (rows.some(r => r.problem)) {
    return { applied: false, rows, note: 'Nothing was changed. Fix or drop the rows with a problem and send the batch again.' };
  }
  if (!input.apply) {
    return { applied: false, rows, note: 'This is a preview. Show it to the person, then send the same changes with apply: true.' };
  }

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    try {
      rows[i].result =
        change.action === 'update' ? updateTask(replica, change.id, change.fields).task
        : change.action === 'complete'
          ? completeTask(replica, change.id, 'deliverableValue' in change ? { deliverableValue: change.deliverableValue } : undefined).spawned
          : deferTask(replica, change.id, change.date);
    } catch (e) {
      rows[i].problem = e instanceof Error ? e.message : String(e);
      return { applied: i > 0, rows, appliedBeforeFailure: i };
    }
  }
  return { applied: true, rows };
}

// ---------------------------------------------------------------------------
// quick_add
// ---------------------------------------------------------------------------

export const MAX_QUICK_ADD = 50;

export interface QuickAddRow {
  line: string;
  title: string;
  dueDate?: string;
  deadline?: string;
  timeSegments?: string[];
  window?: { start?: string; end?: string };
  repeat?: RepeatInput;
  category?: string;
  tags?: string[];
  priority?: number;
  project?: string;
  estimatedMinutes?: number;
  reminderTime?: string;
  /** Anything in the line that was read but not used, so nothing is dropped unsaid. */
  notes?: string[];
  /** After applying: the task as created. */
  task?: SerializedTask;
  problem?: string;
}

/**
 * One line through the app's own quick-add grammar: `#category`/`#tag`,
 * `!priority`, `+project`, an estimate ("~30m", "takes an hour"), then the
 * schedule phrase ("tmrw 5p", "every other monday"). The same parsers the quick-add sheet
 * runs, so a line reads here exactly as it would typed into the app.
 */
function readLine(replica: Replica, line: string): { row: QuickAddRow; draft: Partial<TaskDraft> | null } {
  const lib = replica.lib();
  const p = lib.parse;
  const { dayResetTime } = replica.settings();
  const notes: string[] = [];
  const draft: Partial<TaskDraft> = {};

  const remind = p.stripRemindPrefix(line);
  let text = (remind ?? line).trim();

  // The sigils first, then the date phrase: the app's sheet peels each off as
  // it is typed, and the date reader expects the phrase without them.
  const categories = replica.categories().map(c => c.name);
  const tags = [...new Set([...replica.tagRegistry(), ...replica.tasks().flatMap(t => t.tags)])];
  const ct = p.parseCategoryAndTagsInput(text, categories, tags);
  if (ct) {
    text = ct.cleanTitle;
    if (ct.category) draft.category = ct.category;
    if (ct.tags.length > 0) draft.tags = ct.tags;
  }
  const pr = p.parsePriorityInput(text);
  if (pr) {
    text = pr.cleanTitle;
    draft.priority = pr.priority;
  }
  const live = replica.projects().filter(x => !x.archived && !x.completed).map(x => ({ id: x.id, title: x.title }));
  const pj = p.parseProjectInput(text, live);
  if (pj) {
    text = pj.cleanTitle;
    draft.projectId = pj.projectId;
  }
  const est = p.parseEstimateInput(text);
  if (est) {
    text = est.cleanTitle;
    draft.estimatedMinutes = est.minutes;
  }
  const sched = p.parseTaskInput(text, lib.dates.getLogicalNow(dayResetTime), new Date());
  if (sched) {
    text = sched.cleanTitle;
    const s = sched.schedule;
    draft.dueDate = s.dueDate.toISOString();
    draft.timeSegments = s.timeSegments;
    draft.recurrenceType = s.recurrenceType;
    draft.recurrenceInterval = s.recurrenceInterval;
    draft.recurrenceDays = s.recurrenceDays;
    draft.recurrenceMonthDay = s.recurrenceMonthDay ?? null;
    draft.recurrenceWeekOrdinal = s.recurrenceWeekOrdinal ?? null;
    draft.recurrenceEndDate = s.recurrenceEndDate ?? null;
    draft.recurrenceCount = s.recurrenceCount ?? null;
    draft.recurrenceFromCompletion = s.recurrenceFromCompletion ?? false;
    if (s.deadline) draft.deadline = s.deadline.toISOString();
    if (s.windowStart) draft.windowStart = s.windowStart;
    if (s.windowEnd) draft.windowEnd = s.windowEnd;
    if (s.explicitClockTime) {
      // On the due day's logical day, as quick add places it: a clock time
      // before the person's day start is the small hours at that day's end.
      const at = p.scheduleClockInstant(s, dayResetTime)!;
      if (remind) draft.reminderTime = at.toISOString();
      else notes.push(`Read ${sched.matchedText.trim()} as the time of day; no reminder was set (start the line with "remind me" for one).`);
    }
    if (s.extraDates && s.extraDates.length > 0) {
      notes.push(`Only the first date was used. Add the other ${s.extraDates.length} with create_task.`);
    }
  } else if (remind) {
    notes.push('"remind me" needs a time to remind at; none was found.');
  }

  // "after sunset" / "expires at dark": a window bound that follows the sun,
  // read as quick add reads it and only where the time can be worked out.
  const sun = p.parseSunWindowInput(text);
  if (sun) {
    const clock = replica.sunAnchorClock(sun.anchor, draft.dueDate ?? null);
    if (clock) {
      text = sun.cleanTitle;
      if (sun.bound === 'start') { draft.windowStart = clock; draft.windowStartSun = sun.anchor; }
      else { draft.windowEnd = clock; draft.windowEndSun = sun.anchor; }
    } else {
      notes.push(`"${text.slice(sun.matchStart, sun.matchEnd)}" needs a location to work sunrise and sunset out from, and none is saved, so it stays in the title.`);
    }
  }

  for (const m of text.matchAll(/(^|\s)([#+!][\p{L}\p{N}_-]+)/gu)) {
    notes.push(`"${m[2]}" matched nothing the app knows, so it stays in the title.`);
  }

  draft.title = text.trim();
  const row: QuickAddRow = {
    line,
    title: draft.title,
    ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    ...(draft.deadline ? { deadline: draft.deadline } : {}),
    ...(draft.timeSegments?.length ? { timeSegments: draft.timeSegments } : {}),
    ...(draft.windowStart || draft.windowEnd
      ? { window: {
          ...(draft.windowStart ? { start: draft.windowStart } : {}),
          ...(draft.windowEnd ? { end: draft.windowEnd } : {}),
          ...(draft.windowStartSun ? { startFollows: draft.windowStartSun } : {}),
          ...(draft.windowEndSun ? { endFollows: draft.windowEndSun } : {}),
        } }
      : {}),
    ...(draft.recurrenceType && draft.recurrenceType !== 'none'
      ? { repeat: describeRepeat({ ...(draft as Task), recurrenceType: draft.recurrenceType }) ?? undefined }
      : {}),
    ...(draft.category ? { category: draft.category } : {}),
    ...(draft.tags ? { tags: draft.tags } : {}),
    ...(draft.priority ? { priority: draft.priority } : {}),
    ...(pj ? { project: pj.title } : {}),
    ...(draft.estimatedMinutes ? { estimatedMinutes: draft.estimatedMinutes } : {}),
    ...(draft.reminderTime ? { reminderTime: draft.reminderTime } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
  if (!draft.title) return { row: { ...row, problem: 'Nothing is left for a title once the date and tags are read out.' }, draft: null };
  return { row, draft };
}

export function quickAdd(replica: Replica, input: { lines: string[]; apply?: boolean }): { applied: boolean; rows: QuickAddRow[]; note?: string } {
  const lines = (input.lines ?? []).flatMap(l => l.split('\n')).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('No lines given.');
  if (lines.length > MAX_QUICK_ADD) throw new Error(`At most ${MAX_QUICK_ADD} lines at a time.`);

  const read = lines.map(line => readLine(replica, line));
  const rows = read.map(r => r.row);
  if (rows.some(r => r.problem)) return { applied: false, rows, note: 'Nothing was added. Fix the lines with a problem and send them again.' };
  if (!input.apply) return { applied: false, rows, note: 'This is how each line reads. Send the same lines with apply: true to add them.' };

  for (let i = 0; i < read.length; i++) {
    const created = replica.createTask(read[i].draft!);
    rows[i].task = getTask(replica, created.id)!.task;
  }
  return { applied: true, rows };
}

// ---------------------------------------------------------------------------
// plan_day
// ---------------------------------------------------------------------------

export interface BusyBlock {
  start: string;
  end: string;
  label?: string;
}

export interface PlannedSlot {
  start: string;
  end: string;
  id: string;
  title: string;
  minutes: number;
  /** False when the task has no estimate and the slot uses the stand-in length. */
  estimated: boolean;
  why?: string[];
}

export interface DayPlan {
  date: string;
  from: string;
  to: string;
  plan: PlannedSlot[];
  busy: BusyBlock[];
  /** On today's list but no room was found, with the reason. */
  doesNotFit: { id: string; title: string; minutes: number; reason: string }[];
  /** Waiting on another task or a person, so left out. */
  waiting: { id: string; title: string }[];
  totals: { plannedMinutes: number; freeMinutes: number; assumedMinutesPerUnestimatedTask: number };
  note: string;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function minutesOf(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`"${hhmm}" is not a time. Use HH:MM, 24-hour.`);
  return Number(m[1]) * 60 + Number(m[2]);
}

const DAY_MINUTES = 24 * 60;

function hhmm(minutes: number): string {
  const m = Math.max(0, Math.min(minutes, DAY_MINUTES - 1));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes since midnight of an instant, on today's local clock. Before today is 0; after today is past the end. */
function clockMinutes(date: Date, todayStart: Date): number {
  return Math.round((date.getTime() - todayStart.getTime()) / 60_000);
}

/**
 * A proposal for today: an order and a time for each thing on the list, fitted
 * around whatever the person says they are busy with.
 *
 * Nothing in the app assigns clock times, so the order is this function's own,
 * and it is deliberately plain so it can be explained: pinned first, then
 * anything with a deadline today or earlier, then by priority, then the app's
 * own order. A task is never placed before the moment the app would show it
 * (`getVisibleAt`: a time window, a part of the day, a defer), and never past
 * its window's end. Unestimated tasks take the app's own stand-in length
 * (`assumedMinutesFor`, calibrated from timed work where there is enough).
 */
export function planDay(replica: Replica, input: { startAt?: string; endAt?: string; busy?: BusyBlock[] } = {}): DayPlan {
  const lib = replica.lib();
  const settings = replica.settings();
  const today = replica.todayKey();
  const now = new Date();
  // The day runs from the person's own reset to the next one, not from
  // calendar midnight (CLAUDE.md, "Scheduling decisions and dayResetTime").
  // Every minute count below is measured from that start, and a clock time
  // earlier than the reset belongs to the small hours at the end of the day
  // (`onLogicalDay`'s rule): under a 04:00 reset, active hours ending at 02:00
  // end late rather than before they start, and a plan asked for at 01:30 is
  // still about the day being lived, with half an hour left in it. Measured
  // from midnight, both read as a day that ends before it starts.
  const todayStart = lib.dates.getDayStart(now, settings.dayResetTime);
  const endOfDay = addDays(todayStart, 1);
  const resetMin = minutesOf(settings.dayResetTime);
  const dayMinutesOf = (clock: string): number => {
    const m = minutesOf(clock) - resetMin;
    return m < 0 ? m + DAY_MINUTES : m;
  };
  const clockOf = (minutes: number): string => hhmm((minutes + resetMin) % DAY_MINUTES);
  const nowMin = Math.max(0, clockMinutes(now, todayStart));
  const from = input.startAt ? dayMinutesOf(input.startAt) : Math.max(nowMin, dayMinutesOf(settings.activeHoursStart));
  const to = input.endAt ? dayMinutesOf(input.endAt) : dayMinutesOf(settings.activeHoursEnd);
  if (to <= from) throw new Error('The day ends before it starts; give startAt and endAt as HH:MM.');

  const busy = (input.busy ?? [])
    .map(b => ({ ...b, s: dayMinutesOf(b.start), e: dayMinutesOf(b.end) }))
    .filter(b => b.e > b.s)
    .sort((a, b) => a.s - b.s);

  const all = replica.tasks();
  const assumed = lib.dayLoad.assumedMinutesFor(all);
  const candidates = all.filter(t =>
    !t.parentId && !t.completed && !t.archived && t.polarity !== 'negative'
    && (replica.isVisible(t) || replica.visibleAt(t) < endOfDay));

  const waiting = candidates.filter(t => replica.isBlocked(t)).map(t => ({ id: t.id, title: replica.displayTitle(t) }));
  const deadlineBy = (t: Task) => !!t.deadline && replica.dayKeyOf(t.deadline) <= today;
  const ranked = candidates
    .filter(t => !replica.isBlocked(t))
    .map(t => {
      const est = replica.estimatedMinutes(t);
      const why: string[] = [];
      if (t.pinned) why.push('pinned');
      if (deadlineBy(t)) why.push('deadline today or earlier');
      if (t.priority >= 3) why.push('high priority');
      // Already on Today means it can start whenever the plan starts, short
      // of its own window; otherwise not before the moment the app shows it.
      // Today's times, a bound that follows the sun resolved for today.
      const window = replica.windowToday(t);
      const earliest = replica.isVisible(t)
        ? Math.max(from, window.start ? dayMinutesOf(window.start) : 0)
        : Math.max(from, clockMinutes(replica.visibleAt(t), todayStart));
      const latest = window.end ? dayMinutesOf(window.end) : to;
      if (window.start || window.end) why.push(`time window ${window.start ?? ''}–${window.end ?? ''}`);
      return { t, minutes: est ?? assumed, estimated: est != null, earliest, latest, why };
    })
    .sort((a, b) =>
      Number(b.t.pinned) - Number(a.t.pinned)
      || Number(deadlineBy(b.t)) - Number(deadlineBy(a.t))
      || b.t.priority - a.t.priority
      || a.t.sortOrder - b.t.sortOrder);

  /** The first free start at or after `at` with `length` clear minutes, past any busy block. */
  const freeFrom = (at: number, length: number): number => {
    let start = at;
    for (const b of busy) if (start < b.e && start + length > b.s) start = b.e;
    return start;
  };

  const plan: PlannedSlot[] = [];
  const doesNotFit: DayPlan['doesNotFit'] = [];
  const pending = [...ranked];
  let cursor = from;
  while (pending.length > 0) {
    // The best-ranked task that can start now; when none can, jump to the
    // earliest moment one becomes available, so a gap is filled rather than
    // the whole day waiting on an evening task.
    const ready = pending.findIndex(c => c.earliest <= cursor);
    if (ready === -1) {
      cursor = Math.min(...pending.map(c => c.earliest));
      continue;
    }
    const [c] = pending.splice(ready, 1);
    const start = freeFrom(Math.max(cursor, c.earliest), c.minutes);
    const end = start + c.minutes;
    if (end > c.latest || end > to) {
      doesNotFit.push({
        id: c.t.id,
        title: replica.displayTitle(c.t),
        minutes: c.minutes,
        reason: end > c.latest && c.latest < to ? `its window closes at ${clockOf(c.latest)}` : 'no room left before the day ends',
      });
      continue;
    }
    plan.push({
      start: clockOf(start),
      end: clockOf(end),
      id: c.t.id,
      title: replica.displayTitle(c.t),
      minutes: c.minutes,
      estimated: c.estimated,
      ...(c.why.length > 0 ? { why: c.why } : {}),
    });
    cursor = end;
  }
  // Already in order: the cursor only moves forward, so each slot starts at or
  // after the one before it ends. Sorting by the clock string would put a
  // slot in the small hours ahead of the evening one it follows.

  const busyMinutes = busy.reduce((n, b) => n + Math.max(0, Math.min(b.e, to) - Math.max(b.s, from)), 0);
  const plannedMinutes = plan.reduce((n, s) => n + s.minutes, 0);
  return {
    date: today,
    from: clockOf(from),
    to: clockOf(to),
    plan,
    busy: busy.map(({ start, end, label }) => ({ start, end, ...(label ? { label } : {}) })),
    doesNotFit,
    waiting,
    totals: { plannedMinutes, freeMinutes: Math.max(0, to - from - busyMinutes - plannedMinutes), assumedMinutesPerUnestimatedTask: assumed },
    note: (input.busy ? '' : 'No busy times were given and this server cannot see the calendar, so meetings are not accounted for. Ask the person, or read their calendar with another tool, and pass busy. ')
      + 'This is a proposal. To act on it, use batch_update_tasks: pin what they want to start with, and defer what does not fit.',
  };
}

// ---------------------------------------------------------------------------
// rebalance_week
// ---------------------------------------------------------------------------

export interface RebalanceMove {
  id: string;
  title: string;
  from: string;
  /** The day to pass as `date` to a batch_update_tasks `defer`. */
  to: string;
  minutes: number;
  reason?: string;
}

export interface Rebalance {
  days: { date: string; weekday: string; weight?: string; minutesBefore: number; minutesAfter: number }[];
  moves: RebalanceMove[];
  /** On a heavy day but better left where it is, with the app's own reason. */
  keep: { id: string; title: string; date: string; reason: string }[];
  note: string;
}

/**
 * Moves that would bring each heavy day in the coming week under the app's
 * "busy" line.
 *
 * Today is the app's own "Lighten today" plan (`buildDeloadPlan`): the same
 * destinations, the same tasks it refuses to move (pinned, running, due before
 * a deadline, on a streak, and the rest of `deloadBlockerFor`). Later days have
 * no screen in the app, so they get a plainer rule on the same parts: biggest
 * task first, to the lightest later day in the window that keeps it before its
 * deadline, until the day is under the line. Day weights are the look-ahead's,
 * which already count projected repeats.
 */
export function rebalanceWeek(replica: Replica, input: { days?: number } = {}): Rebalance {
  const lib = replica.lib();
  const span = Math.min(Math.max(input.days ?? 7, 2), 21);
  const { dayResetTime } = replica.settings();
  const la = replica.lookAhead(span);
  const all = replica.tasks();
  const assumed = lib.dayLoad.assumedMinutesFor(all);
  const busyLine = lib.dayLoad.BUSY_DAY_MINUTES;
  const minutesOf = (t: Task) => replica.estimatedMinutes(t) ?? assumed;

  const load = la.days.map(d => d.load.rankedMinutes);
  const before = [...load];
  const moves: RebalanceMove[] = [];
  const keep: Rebalance['keep'] = [];
  const heavy = (i: number) => la.days[i].weight === 'busy' || la.days[i].weight === 'full';
  const indexOf = new Map(la.days.map((d, i) => [d.key, i]));

  if (la.days.length > 0 && heavy(0)) {
    const todays = all.filter(t => !t.parentId && !t.completed && replica.isVisible(t));
    const plan = lib.deloadPlan.buildDeloadPlan(todays, all, dayResetTime, [], lib.awayDates.liveAwaySpans(replica.projects(), dayResetTime));
    for (const p of plan.proposals) {
      if (load[0] <= busyLine) break;
      if (p.blocker && !p.suggested) {
        keep.push({ id: p.task.id, title: replica.displayTitle(p.task), date: la.days[0].key, reason: p.blockerLabel ?? p.blocker });
        continue;
      }
      const dest = p.suggested ?? p.tomorrow;
      if (!dest) continue;
      const to = lib.dates.dayKeyOf(dest.date);
      moves.push({ id: p.task.id, title: replica.displayTitle(p.task), from: la.days[0].key, to, minutes: p.minutes, ...(dest.reason ? { reason: dest.reason } : {}) });
      load[0] -= p.minutes;
      const j = indexOf.get(to);
      if (j !== undefined) load[j] += p.minutes;
    }
  }

  for (let i = 1; i < la.days.length; i++) {
    if (!heavy(i)) continue;
    const day = la.days[i];
    const movable = [...day.tasks].sort((a, b) => minutesOf(b) - minutesOf(a));
    for (const task of movable) {
      if (load[i] <= busyLine) break;
      const blocker = lib.taskMoves.deloadBlockerFor(task);
      if (blocker && !lib.taskMoves.SOFT_DELOAD_BLOCKERS.has(blocker.blocker)) {
        keep.push({ id: task.id, title: replica.displayTitle(task), date: day.key, reason: blocker.label });
        continue;
      }
      const m = minutesOf(task);
      let best = -1;
      for (let j = i + 1; j < la.days.length; j++) {
        if (la.days[j].load.away) continue;
        if (load[j] + m > busyLine) continue;
        const date = new Date(la.days[j].date);
        date.setHours(12, 0, 0, 0);
        if (lib.taskMoves.wouldMissDeadline(task, date, dayResetTime)) continue;
        if (best === -1 || load[j] < load[best]) best = j;
      }
      if (best === -1) continue;
      moves.push({ id: task.id, title: replica.displayTitle(task), from: day.key, to: la.days[best].key, minutes: m, reason: `the lightest later day that keeps it before any deadline` });
      load[i] -= m;
      load[best] += m;
    }
  }

  return {
    days: la.days.map((d, i) => ({
      date: d.key,
      weekday: WEEKDAYS[new Date(`${d.key}T12:00:00`).getDay()],
      ...(d.weight ? { weight: d.weight } : {}),
      minutesBefore: before[i],
      minutesAfter: load[i],
    })),
    moves,
    keep,
    note: 'A proposal; nothing has moved. Minutes include a stand-in for unestimated tasks and expected repeats. The calendar is not visible here. To apply, send the moves the person agrees to as batch_update_tasks changes with action "defer" and date set to "to".',
  };
}
