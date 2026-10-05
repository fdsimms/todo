/**
 * The tools that read across the data rather than one record at a time.
 *
 * The other read tools answer "show me X", one lens or one record per call.
 * These answer the questions a person brings to an assistant that the app has
 * no single screen for: where do I stand, what does the next fortnight look
 * like, what have I actually been getting done, and what in here has gone
 * stale. A model could assemble each from the list tools, but only by reading
 * every task and re-deriving the app's rules (logical days, projected
 * occurrences, what counts as a completion), which is exactly the drift this
 * package is arranged to avoid. So each one is a thin projection over a reader
 * the app already has: `buildLookAhead` for the agenda, `isRealCompletion` and
 * `onTimeSummary` for history, `mostMissed` for the review.
 *
 * Two rules carry over from the app and shape what these may say:
 *
 * - **Counts and dates, not verdicts.** Nothing here scores the person, ranks a
 *   day as good or bad, or calls a task "late" in a voice the app does not use.
 *   `review_tasks` lists what has sat a long time; whether that matters is the
 *   person's call, and the agent is told so in the server instructions.
 * - **Unknown is not zero.** The server cannot read the phone's calendar, so an
 *   agenda day says its meetings are unknown rather than reporting a free day.
 */
import type { Category, Project, Task } from '../../src/types';
import type { Replica } from './replica';
import { serializeTask, serializeTasks, type SerializedTask } from './serialize';
import { listProjects, resolveRange, type DayRange, type LogRangeInput } from './tools';
import { activeTimeZone } from './timeZone';
import { vacationState, type VacationState } from './vacationTools';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Noon on a day key, so a weekday or a difference never trips over midnight or DST. */
function noonOf(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

function weekdayOf(key: string): string {
  return WEEKDAYS[noonOf(key).getDay()];
}

/** Whole days from `from` to `to`, both day keys. */
export function daysBetweenKeys(from: string, to: string): number {
  return Math.round((noonOf(to).getTime() - noonOf(from).getTime()) / 86_400_000);
}

function isOpenTopLevel(task: Task): boolean {
  return !task.parentId && !task.completed && !task.archived;
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string | readonly string[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    for (const k of Array.isArray(key) ? key : key == null ? [] : [key as string]) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Highest count first, ties by name, as a list rather than an object a reader has to sort. */
function ranked(counts: Record<string, number>, cap = Infinity): { name: string; count: number }[] {
  return Object.entries(counts)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, cap)
    .map(([name, count]) => ({ name, count }));
}

// ---------------------------------------------------------------------------
// get_overview
// ---------------------------------------------------------------------------

export interface Overview {
  /** The moment the answer was computed, and the same moment on the person's own clock. */
  now: string;
  localTime: string;
  timeZone: string;
  /** The logical today: before `dayResetTime` it is still yesterday by the person's reckoning. */
  today: { date: string; weekday: string; dayStartsAt: string; weekStartsOn: string };
  /** Present while vacation mode is on: since when, until when, the trip that switched it on if one did, and what it hides (`vacationTools.ts`). */
  vacation?: VacationState & { on: true };
  /** Open top-level tasks in each of the app's lenses. The four lenses are disjoint. */
  counts: {
    today: number;
    later: number;
    unscheduled: number;
    inbox: number;
    /** Dated before today and still open. A subset of `today`, not a fifth lens. */
    overdue: number;
    pinned: number;
    blocked: number;
  };
  categories: { name: string; open: number; schedule?: string; hiddenOnVacation?: boolean }[];
  /** The most used tags on open tasks, with how many carry each. */
  tags: { name: string; count: number }[];
  projects: { id: string; title: string; outstanding: number; deadline?: string }[];
  /** Areas of the app the person has switched off. An agent should not walk them through a screen they cannot see. */
  features: {
    kitchen: boolean; simplifiedMode: boolean; rewards: boolean;
    /** Whether a device is set to add the events request_calendar_event asks for. */
    calendarRequests: boolean;
  };
  /**
   * Whether the health logs (food, mood, medication) have reached the server
   * in the last 30 days. They travel only with a switch on the phone, so false
   * means "not sent", not "nothing logged".
   */
  healthLogs: { food: number; mood: number; medication: number; note?: string };
  completedTasksKeptForDays: number | 'forever';
  /**
   * What the person has asked Claude to keep in mind, in their own words. Follow
   * them. They can read and edit these in Settings › Data & reset › Sync.
   */
  notesForClaude: { id: string; text: string }[];
  lastSyncedAt?: string;
  access: 'read' | 'write';
}

function describeSchedule(c: Category): string | undefined {
  const days = c.scheduleDays && c.scheduleDays.length > 0 && c.scheduleDays.length < 7
    ? c.scheduleDays.slice().sort().map(d => WEEKDAYS[d].slice(0, 3)).join(', ')
    : null;
  const hours = c.scheduleStart || c.scheduleEnd ? `${c.scheduleStart ?? '00:00'}–${c.scheduleEnd ?? '24:00'}` : null;
  if (!days && !hours) return undefined;
  return [days, hours].filter(Boolean).join(' ');
}

export function getOverview(replica: Replica, access: 'read' | 'write' = 'read'): Overview {
  const settings = replica.settings();
  const today = replica.todayKey();
  const open = replica.tasks().filter(isOpenTopLevel);

  let visible = 0, later = 0, unscheduled = 0, inbox = 0;
  for (const t of open) {
    if (replica.isVisible(t)) visible++;
    else if (replica.isUnscheduled(t)) unscheduled++;
    else if (replica.isInbox(t)) inbox++;
    else later++;
  }

  const openByCategory = countBy(open, t => t.category);
  const healthFrom = replica.shiftDayKey(today, -29);
  const food = replica.foodLogEntries(healthFrom, today).length;
  const mood = replica.moodLogs(healthFrom, today).length;
  const medication = replica.medicationLogs(healthFrom, today).length;
  const synced = replica.lastSyncedAt();

  return {
    now: new Date().toISOString(),
    localTime: new Date().toLocaleString('sv-SE').slice(0, 16),
    timeZone: activeTimeZone(),
    today: {
      date: today,
      weekday: weekdayOf(today),
      dayStartsAt: settings.dayResetTime,
      weekStartsOn: WEEKDAYS[settings.weekStartsOn] ?? 'Sunday',
    },
    vacation: settings.vacationMode ? (vacationState(replica) as VacationState & { on: true }) : undefined,
    counts: {
      today: visible,
      later,
      unscheduled,
      inbox,
      overdue: replica.lookAhead(1).carriedOver.length,
      pinned: open.filter(t => t.pinned).length,
      blocked: open.filter(t => replica.isBlocked(t)).length,
    },
    categories: replica.categories().map(c => ({
      name: c.name,
      open: openByCategory[c.name] ?? 0,
      ...(describeSchedule(c) ? { schedule: describeSchedule(c) } : {}),
      ...(c.hideOnVacation ? { hiddenOnVacation: true } : {}),
    })),
    tags: ranked(countBy(open, t => t.tags), 40),
    projects: listProjects(replica)
      .filter(p => !replica.projects().find(q => q.id === p.id)?.completed)
      .map(p => ({ id: p.id, title: p.title, outstanding: p.outstanding, ...(p.deadline ? { deadline: p.deadline } : {}) })),
    features: {
      kitchen: settings.kitchenEnabled, simplifiedMode: settings.simpleMode, rewards: settings.rewardsEnabled,
      calendarRequests: settings.calendarRequestsOn,
    },
    healthLogs: {
      food,
      mood,
      medication,
      ...(food + mood + medication === 0
        ? { note: 'None in the last 30 days. They reach the server only with Settings › Data & reset › Sync › Include health logs turned on, so this may mean they were never sent.' }
        : {}),
    },
    completedTasksKeptForDays: settings.completedRetentionDays ?? 'forever',
    notesForClaude: replica.agentNotes().map(n => ({ id: n.id, text: n.text })),
    ...(synced ? { lastSyncedAt: synced } : {}),
    access,
  };
}

// ---------------------------------------------------------------------------
// get_agenda
// ---------------------------------------------------------------------------

export const DEFAULT_AGENDA_DAYS = 7;
export const MAX_AGENDA_DAYS = 60;
/** Per day, so one crowded day cannot spend the whole result. The day says how many it held. */
const AGENDA_TASKS_PER_DAY = 30;

export interface AgendaDay {
  date: string;
  weekday: string;
  /** Real rows landing here: due or coming back from a defer. These can be completed or moved. */
  tasks: SerializedTask[];
  /** How many rows landed, when more than were listed. */
  taskCount?: number;
  /** Recurring occurrences with no row yet. They cannot be completed until their row exists. */
  expected?: { taskId: string; title: string }[];
  /** Minutes the listed rows carry estimates for, and how many have none. */
  estimatedMinutes?: number;
  unestimated?: number;
  /** The app's own cue for a heavy day, or absent for an ordinary one. */
  weight?: string;
  /** Inside a project's away span (a trip). */
  away?: true;
}

export interface Agenda {
  from: string;
  to: string;
  days: AgendaDay[];
  /** Dated before today and still open, oldest first. These claim the window's time too. */
  carriedOver: (SerializedTask & { daysAgo: number })[];
  /** Deadlines in the window whose remaining days are already spoken for, by the app's own arithmetic. */
  tightDeadlines: { id: string; title: string; deadline: string; estimatedMinutes: number; daysLeft: number }[];
  totals: { tasks: number; estimatedMinutes: number; unestimated: number; projectedOccurrences: number };
  /** Always present: the server cannot see the phone's calendar. */
  calendar: string;
}

export function getAgenda(replica: Replica, input: { days?: number } = {}): Agenda {
  const span = Math.min(Math.max(input.days ?? DEFAULT_AGENDA_DAYS, 1), MAX_AGENDA_DAYS);
  const la = replica.lookAhead(span);
  const today = replica.todayKey();

  const days: AgendaDay[] = la.days.map(d => {
    const minutes = d.load.taskMinutes;
    return {
      date: d.key,
      weekday: weekdayOf(d.key),
      tasks: serializeTasks(replica, d.tasks.slice(0, AGENDA_TASKS_PER_DAY)),
      ...(d.tasks.length > AGENDA_TASKS_PER_DAY ? { taskCount: d.tasks.length } : {}),
      ...(d.expected.length > 0 ? { expected: d.expected } : {}),
      ...(minutes > 0 ? { estimatedMinutes: minutes } : {}),
      ...(d.load.unestimated > 0 ? { unestimated: d.load.unestimated } : {}),
      ...(d.weight && d.weight !== 'away' ? { weight: d.weight } : {}),
      ...(d.load.away ? { away: true as const } : {}),
    };
  });

  return {
    from: today,
    to: days.length > 0 ? days[days.length - 1].date : today,
    days,
    carriedOver: la.carriedOver.map(t => ({
      ...serializeTask(replica, t),
      daysAgo: t.dueDate ? Math.max(daysBetweenKeys(replica.logicalDayKeyOf(t.dueDate), today), 1) : 1,
    })),
    tightDeadlines: la.tight.map(t => ({
      id: t.task.id,
      title: replica.displayTitle(t.task),
      deadline: t.deadline.toISOString(),
      estimatedMinutes: t.minutes,
      daysLeft: t.daysLeft,
    })),
    totals: {
      tasks: la.totals.taskCount,
      estimatedMinutes: la.totals.minutes,
      unestimated: la.totals.unestimated,
      projectedOccurrences: la.totals.projected,
    },
    calendar: 'Not visible to this server. Meetings and events are unknown, so a day with few tasks is not necessarily a free day.',
  };
}

// ---------------------------------------------------------------------------
// completion_history
// ---------------------------------------------------------------------------

export const DEFAULT_HISTORY_DAYS = 30;
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 500;

export interface CompletionHistoryInput extends LogRangeInput {
  category?: string;
  projectId?: string;
  tag?: string;
  /** How many completed tasks to list. The summary always covers all of them. */
  limit?: number;
}

export interface CompletionHistory {
  range: DayRange;
  summary: {
    completed: number;
    /** Days in the range with at least one completion, out of how many days the range spans. */
    activeDays: number;
    daysInRange: number;
    /** Completions per logical day; days with none are left out. */
    byDay: Record<string, number>;
    byWeekday: Record<string, number>;
    /** By the hour of the person's clock the tick happened in, "0" to "23". */
    byHour: Record<string, number>;
    byCategory: { name: string; count: number }[];
    byProject: { name: string; count: number }[];
    byTag: { name: string; count: number }[];
    /** Minutes across the completions that carried an estimate, and how many did. */
    estimatedMinutes: number;
    withEstimate: number;
    /** Of completions that had a deadline, how many landed by it. */
    deadlines: { met: number; total: number };
    /** Occurrences the app swept as missed in the range. Not counted as completions anywhere above. */
    missed: number;
  };
  tasks: (SerializedTask & { completedAt: string })[];
  /** True when `tasks` was cut to the limit. */
  truncated?: true;
}

export function completionHistory(replica: Replica, input: CompletionHistoryInput = {}): CompletionHistory {
  const range = resolveRange(replica, { days: input.days ?? DEFAULT_HISTORY_DAYS, from: input.from, to: input.to });
  if (range.from > range.to) throw new Error(`from (${range.from}) is after to (${range.to}).`);
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_HISTORY_LIMIT, 1), MAX_HISTORY_LIMIT);

  const inRange = (t: Task): boolean => {
    if (!t.completedAt) return false;
    const day = replica.logicalDayKeyOf(t.completedAt);
    return day >= range.from && day <= range.to;
  };
  const matches = (t: Task): boolean =>
    !t.parentId
    && t.completed
    && (input.category ? t.category === input.category : true)
    && (input.projectId ? t.projectId === input.projectId : true)
    && (input.tag ? t.tags.includes(input.tag) : true)
    && inRange(t);

  const candidates = replica.tasks().filter(matches);
  const done = candidates
    .filter(t => replica.isRealCompletion(t))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const missed = candidates.length - done.length;

  const projectNames = new Map(replica.projects().map((p: Project) => [p.id, p.title]));
  const byDay = countBy(done, t => replica.logicalDayKeyOf(t.completedAt!));
  let estimatedMinutes = 0, withEstimate = 0;
  for (const t of done) {
    const m = replica.estimatedMinutes(t);
    if (m != null) { estimatedMinutes += m; withEstimate++; }
  }
  const onTime = replica.onTimeSummary(done);

  return {
    range,
    summary: {
      completed: done.length,
      activeDays: Object.keys(byDay).length,
      daysInRange: daysBetweenKeys(range.from, range.to) + 1,
      byDay: Object.fromEntries(Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))),
      byWeekday: countBy(done, t => weekdayOf(replica.logicalDayKeyOf(t.completedAt!))),
      byHour: countBy(done, t => String(new Date(t.completedAt!).getHours())),
      byCategory: ranked(countBy(done, t => t.category ?? 'Uncategorized')),
      byProject: ranked(countBy(done, t => (t.projectId ? projectNames.get(t.projectId) ?? null : null))),
      byTag: ranked(countBy(done, t => t.tags), 30),
      estimatedMinutes,
      withEstimate,
      deadlines: { met: onTime.onTime, total: onTime.total },
      missed,
    },
    tasks: done.slice(0, limit).map(t => ({ ...serializeTask(replica, t), completedAt: t.completedAt! })),
    ...(done.length > limit ? { truncated: true as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// review_tasks
// ---------------------------------------------------------------------------

export const DEFAULT_STALE_DAYS = 30;
const INBOX_AGING_DAYS = 7;
const QUIET_PROJECT_DAYS = 21;
const SECTION_CAP = 25;

export interface ReviewSection<T> {
  count: number;
  items: T[];
}

export interface TaskReview {
  /** Dated before today and still open, oldest first. */
  overdue: ReviewSection<SerializedTask & { daysAgo: number }>;
  /** In the Inbox (never triaged) for more than a week. */
  inboxAging: ReviewSection<SerializedTask & { ageDays: number }>;
  /** Unscheduled (no date, on purpose) for longer than `staleDays`: the someday pile. */
  somedayAging: ReviewSection<SerializedTask & { ageDays: number }>;
  /** Open tasks whose titles are the same once case and punctuation are set aside. */
  possibleDuplicates: ReviewSection<{ title: string; tasks: { id: string; category?: string; projectId?: string; dueDate?: string }[] }>;
  /** Active projects with work outstanding and nothing finished in three weeks. Lists and paused projects are left out. */
  quietProjects: ReviewSection<{ id: string; title: string; outstanding: number; lastCompletedAt?: string; daysQuiet: number }>;
  /** Recurring tasks with the most occurrences swept as missed, all time. */
  mostMissed: ReviewSection<{ title: string; missed: number; lastMissedAt: string }>;
  staleDays: number;
}

function section<T>(all: T[]): ReviewSection<T> {
  return { count: all.length, items: all.slice(0, SECTION_CAP) };
}

/** Lowercase, punctuation and repeated spaces dropped: "Call mom!" and "call  Mom" are one title. */
export function duplicateKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

export function reviewTasks(replica: Replica, input: { staleDays?: number } = {}): TaskReview {
  const staleDays = Math.max(input.staleDays ?? DEFAULT_STALE_DAYS, 1);
  const today = replica.todayKey();
  const all = replica.tasks();
  const open = all.filter(isOpenTopLevel);
  const ageOf = (t: Task) => daysBetweenKeys(replica.logicalDayKeyOf(t.createdAt), today);

  const overdue = replica.lookAhead(1).carriedOver.map(t => ({
    ...serializeTask(replica, t),
    daysAgo: t.dueDate ? Math.max(daysBetweenKeys(replica.logicalDayKeyOf(t.dueDate), today), 1) : 1,
  }));

  const aged = (pick: (t: Task) => boolean, minDays: number) =>
    open
      .filter(pick)
      .map(t => ({ task: t, ageDays: ageOf(t) }))
      .filter(x => x.ageDays > minDays)
      .sort((a, b) => b.ageDays - a.ageDays)
      .map(x => ({ ...serializeTask(replica, x.task), ageDays: x.ageDays }));

  // A dated series is several rows sharing a title on purpose, so it is one
  // entry here, not a duplicate of itself.
  const groups = new Map<string, Task[]>();
  const seenSeries = new Set<string>();
  for (const t of open) {
    if (t.seriesId) {
      if (seenSeries.has(t.seriesId)) continue;
      seenSeries.add(t.seriesId);
    }
    const key = duplicateKey(replica.displayTitle(t));
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const duplicates = [...groups.values()]
    .filter(g => g.length > 1)
    .sort((a, b) => b.length - a.length)
    .map(g => ({
      title: replica.displayTitle(g[0]),
      tasks: g.map(t => ({
        id: t.id,
        ...(t.category ? { category: t.category } : {}),
        ...(t.projectId ? { projectId: t.projectId } : {}),
        ...(t.dueDate ? { dueDate: t.dueDate } : {}),
      })),
    }));

  const lastDoneByProject = new Map<string, string>();
  for (const t of all) {
    if (!t.projectId || !t.completedAt || !replica.isRealCompletion(t)) continue;
    const prev = lastDoneByProject.get(t.projectId);
    if (!prev || t.completedAt > prev) lastDoneByProject.set(t.projectId, t.completedAt);
  }
  const quiet = listProjects(replica)
    .map(p => ({ summary: p, project: replica.projects().find(q => q.id === p.id)! }))
    // A list has no finish line to be quiet about, and a paused project is
    // quiet because the person said so.
    .filter(({ summary, project }) =>
      !project.completed
      && summary.outstanding > 0
      && project.kind !== 'list'
      && !(project.pausedUntil !== null && today < project.pausedUntil))
    .map(({ summary, project }) => {
      const last = lastDoneByProject.get(project.id);
      const since = last ?? project.createdAt;
      return {
        id: project.id,
        title: project.title,
        outstanding: summary.outstanding,
        ...(last ? { lastCompletedAt: last } : {}),
        daysQuiet: daysBetweenKeys(replica.logicalDayKeyOf(since), today),
      };
    })
    .filter(p => p.daysQuiet >= QUIET_PROJECT_DAYS)
    .sort((a, b) => b.daysQuiet - a.daysQuiet);

  return {
    overdue: section(overdue),
    inboxAging: section(aged(t => replica.isInbox(t), INBOX_AGING_DAYS)),
    somedayAging: section(aged(t => replica.isUnscheduled(t), staleDays)),
    possibleDuplicates: section(duplicates),
    quietProjects: section(quiet),
    mostMissed: section(replica.mostMissed(all).map(g => ({ title: g.title, missed: g.count, lastMissedAt: g.lastMissedAt }))),
    staleDays,
  };
}
