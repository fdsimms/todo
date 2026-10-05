/**
 * The task fields `create_task` and `update_task` take, and their translation
 * into the `Task` fields the app's own editor would have saved.
 *
 * The input is shaped for a caller that has never seen `Task`: a repeat rule is
 * one object (`{ every: 'month', nthWeekday: { ordinal: 2, weekday: 2 } }`)
 * rather than six columns whose valid combinations live in the editor's save
 * step. That save step (TaskEditor's `handleSave`) is the only place most of
 * those combinations are enforced, and `newTaskFromDraft` and `updateTask`
 * trust whatever they are handed, so this does the editor's job: it refuses
 * what the editor would never let a person pick, and clears what the editor
 * clears when a rule changes type.
 *
 * Pure, like templatePlan.ts, so it runs in the repo's jest. Two things it
 * cannot do without the app's values are left to the replica: checking that a
 * blocker exists and makes no cycle (`waitsOn` comes back as ids), and the
 * empty follow-up draft, which comes in through `deps`.
 *
 * **Errors are collected, not thrown on the first one**, for the reason
 * templatePlan.ts gives.
 */
import type {
  ChainItem,
  DeliverableKind,
  Difficulty,
  Effort,
  FollowUpTaskDraft,
  HealthTargetMetric,
  Priority,
  RecurrenceType,
  RotationItem,
  Task,
  TimeOfDay,
} from '../../src/types';
import { minutesToEffort } from '../../src/utils/effort';
import { followsRingGoal, hasHealthTarget, HEALTH_TARGET_METRICS, HEALTH_TARGET_RANGES } from '../../src/utils/healthTarget';
import { isRotationTask, MIN_ROTATION_ITEMS } from '../../src/utils/rotation';
import { normalizeTargetUnit } from '../../src/utils/quotaUnit';
import { canWaitForWeather } from '../../src/utils/weatherCondition';
import { localDateInput } from './timeZone';

export const REPEAT_EVERY = ['never', 'hours', 'day', 'week', 'month', 'year'] as const;
export type RepeatEvery = (typeof REPEAT_EVERY)[number];
export const TIME_SEGMENTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
export const STEP_QUESTION_KINDS = ['text', 'date', 'number', 'yesno'] as const;
export const DELIVERABLE_KINDS: readonly DeliverableKind[] = ['text', 'date', 'number', 'yesno', 'choice'];

/** The app's own limits, from the editor's pickers. */
export const LIMITS = {
  interval: [1, 99],
  count: [1, 999],
  target: [2, 99],
  followUpEveryN: [2, 99],
  chainSteps: 2,
  /** The editor has no ceiling on a countdown; a day is the most one can mean. */
  timedMinutes: [1, 1440],
  /**
   * `LIMITS.supplyCount[1]` in src/utils/supply.ts, copied rather than imported:
   * supply.ts reaches the settings store through dateUtils, and this module
   * must load before the SQLite shim is installed (see replica.ts's requires).
   * taskFields.test.ts pins the two together.
   */
  supplyCount: [0, 999],
  supplyReorderAt: [1, 999],
} as const;

/** `DEFAULT_SUPPLY_REORDER_AT`: on the last one. Pinned in taskFields.test.ts like the limits above. */
const DEFAULT_SUPPLY_REORDER_AT = 1;

const EVERY_TO_TYPE: Record<RepeatEvery, RecurrenceType> = {
  never: 'none',
  hours: 'hours',
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

export interface RepeatInput {
  every: RepeatEvery;
  interval?: number;
  /** 0 = Sunday … 6 = Saturday. Weekly only. */
  weekdays?: number[];
  /** 1-31, or -1 for the last day. Monthly or yearly. */
  monthDay?: number;
  /** "The 2nd Tuesday", "the last Friday". Monthly only, instead of monthDay. */
  nthWeekday?: { ordinal: number; weekday: number };
  /** 1-12. Yearly only. */
  month?: number;
  fromCompletion?: boolean;
  endDate?: string | null;
  count?: number | null;
}

export interface ChainStepInput {
  title: string;
  estimatedMinutes?: number | null;
  asks?: (typeof STEP_QUESTION_KINDS)[number] | null;
  answerSchedulesNextStep?: boolean;
}

export interface ChainInput {
  steps: ChainStepInput[];
  stepsFollowSchedule?: boolean;
}

export interface TargetInput {
  count: number;
  per: 'day' | 'week';
  unit?: string | null;
  allowOvershoot?: boolean;
  /** Creating a weekly target partway through a week: 'fewer' (the default) scales the first week to the days left, 'full' asks for the whole count. */
  firstWeek?: 'fewer' | 'full';
}

/** A countdown the task runs once started. Subtask stretches are not settable here. */
export interface TimedInput {
  minutes: number;
}

/** A set of named things, each done once a week in any order. */
export interface RotationInput {
  /** Titles, in the order to show them, at least two and each different. */
  members: string[];
}

/** Ready-to-check-off once Apple Health reaches a number. Configuration only: the server cannot read a reading. */
export interface HealthTargetInput {
  metric: HealthTargetMetric;
  /** In the metric's own unit; defaults to the editor's starting value for it. */
  target?: number;
  /** Ring metrics only: follow the goal set in Fitness instead of `target`. */
  followGoal?: boolean;
}

/** A stock that runs down as a repeating task is completed. Needs a repeat. */
export interface SupplyInput {
  count: number;
  unit?: string | null;
  refillCount?: number | null;
  reorderAt?: number;
  leadDays?: number | null;
}

export interface WindowInput {
  start?: string | null;
  end?: string | null;
}

export interface FollowUpInput {
  /** Every Nth completion. Give this or `atEnd`. */
  everyN?: number;
  /** Add the task once, when the repeat ends. Needs `repeat.count` or `repeat.endDate`. */
  atEnd?: boolean;
  title: string;
  notes?: string;
  estimatedMinutes?: number | null;
  oneAtATime?: boolean;
}

export interface TaskFieldsInput {
  title?: string;
  notes?: string;
  category?: string | null;
  /** Lets `category` name one that doesn't exist yet; the write creates it. Checked by the replica. */
  newCategory?: boolean;
  tags?: string[];
  projectId?: string | null;
  dueDate?: string | null;
  deferUntil?: string | null;
  deadline?: string | null;
  /**
   * Days from the project's event date (negative is before), resolved into
   * `dueDate` / `deadline` by the replica, which knows the project. Never
   * stored as an offset: see Project.eventDate.
   */
  dueDaysFromEvent?: number;
  deadlineDaysFromEvent?: number;
  /**
   * The last day of a month counted from the event's own: 0 is the end of the
   * event's month, 1 the end of the month after. For "update records by the
   * end of the month after", which a count of days can't say.
   */
  dueEndOfMonthAfterEvent?: number;
  deadlineEndOfMonthAfterEvent?: number;
  reminderTime?: string | null;
  timeSegments?: TimeOfDay[];
  priority?: number;
  effort?: number;
  difficulty?: Difficulty | null;
  estimatedMinutes?: number | null;
  /**
   * Holds a plain one-off task until the first day in the next two weeks whose
   * forecast is this kind of day. The phone does the matching (it is the one
   * with a location and a forecast), moving `deferUntil` as the forecast moves,
   * so this only records the want. null stops waiting.
   */
  weatherWait?: WeatherConditionInput | null;
  pinned?: boolean;
  pinEachOccurrence?: boolean;
  deliverableKind?: DeliverableKind | null;
  deliverableOptions?: string[];
  repeat?: RepeatInput;
  chain?: ChainInput | null;
  target?: TargetInput | null;
  timed?: TimedInput | null;
  rotation?: RotationInput | null;
  healthTarget?: HealthTargetInput | null;
  supply?: SupplyInput | null;
  window?: WindowInput | null;
  habit?: 'do' | 'avoid';
  waitsOn?: string[];
  /** With waitsOn: keep waiting until a repeating blocker's last occurrence is done, not just its next. */
  waitForSeriesEnd?: boolean;
  /** Shown only if that task's question gets one of these answers; null removes it. */
  onlyIfAnswer?: { taskId: string; answers: string[] } | null;
  followUp?: FollowUpInput | null;
}

export interface TaskFieldsDeps {
  newId(): string;
  emptyFollowUpDraft(): FollowUpTaskDraft;
}

export interface TaskFieldsResult {
  patch: Partial<Task>;
  /** Blocker ids, for the replica to check and write. Absent when not given. */
  waitsOn?: string[];
  /** An answer gate, for the replica to check against the question and write. Absent when not given or cleared. */
  onlyIfAnswer?: { taskId: string; answers: string[] };
  errors: string[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const inRange = (n: unknown, [lo, hi]: readonly [number, number]): boolean => isInt(n) && n >= lo && n <= hi;
const isIsoDate = (s: string): boolean => !Number.isNaN(Date.parse(s));

/** The fields that make up a repeat rule, all of them, at their "no rule" values. */
const NO_REPEAT: Partial<Task> = {
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceMonth: null,
  recurrenceWeekOrdinal: null,
  recurrenceFromCompletion: false,
  recurrenceEndDate: null,
  recurrenceCount: null,
  chainStepOnSchedule: false,
};

function repeatFields(r: RepeatInput, errors: string[]): Partial<Task> {
  if (!REPEAT_EVERY.includes(r.every)) {
    errors.push(`repeat.every must be one of ${REPEAT_EVERY.join(', ')}.`);
    return {};
  }
  if (r.every === 'never') return { ...NO_REPEAT };

  const type = EVERY_TO_TYPE[r.every];
  const interval = r.interval ?? 1;
  if (!inRange(interval, LIMITS.interval)) errors.push(`repeat.interval must be a whole number from ${LIMITS.interval[0]} to ${LIMITS.interval[1]}.`);

  if (r.weekdays !== undefined) {
    if (r.every !== 'week') errors.push('repeat.weekdays only applies when every is "week". For "the 2nd Tuesday" use nthWeekday.');
    else if (r.weekdays.length === 0 || r.weekdays.some(d => !inRange(d, [0, 6]))) {
      errors.push('repeat.weekdays must be a non-empty list of 0 (Sunday) to 6 (Saturday).');
    }
  }
  if (r.monthDay !== undefined) {
    if (r.every !== 'month' && r.every !== 'year') errors.push('repeat.monthDay only applies when every is "month" or "year".');
    else if (!(inRange(r.monthDay, [1, 31]) || r.monthDay === -1)) errors.push('repeat.monthDay must be 1 to 31, or -1 for the last day of the month.');
  }
  if (r.nthWeekday !== undefined) {
    if (r.every !== 'month') errors.push('repeat.nthWeekday only applies when every is "month".');
    if (r.monthDay !== undefined) errors.push('repeat.nthWeekday and repeat.monthDay are two ways of saying which day; give one.');
    if (!([1, 2, 3, 4, -1] as unknown[]).includes(r.nthWeekday.ordinal)) errors.push('repeat.nthWeekday.ordinal must be 1, 2, 3, 4, or -1 for the last.');
    if (!inRange(r.nthWeekday.weekday, [0, 6])) errors.push('repeat.nthWeekday.weekday must be 0 (Sunday) to 6 (Saturday).');
  }
  if (r.month !== undefined) {
    if (r.every !== 'year') errors.push('repeat.month only applies when every is "year".');
    else if (!inRange(r.month, [1, 12])) errors.push('repeat.month must be 1 to 12.');
  }
  // An hourly rule always counts from when it's done; the app has no other kind.
  if (r.every === 'hours' && r.fromCompletion === false) errors.push('An hourly repeat always counts from when it is done, so fromCompletion cannot be false.');
  if (r.endDate != null && r.count != null) errors.push('repeat.endDate and repeat.count are two ways to end a repeat; give one.');
  if (r.endDate != null && !isIsoDate(r.endDate)) errors.push('repeat.endDate must be an ISO date.');
  if (r.count != null && !inRange(r.count, LIMITS.count)) errors.push(`repeat.count must be ${LIMITS.count[0]} to ${LIMITS.count[1]}.`);

  return {
    recurrenceType: type,
    recurrenceInterval: interval,
    recurrenceDays:
      r.every === 'week' ? [...new Set(r.weekdays ?? [])].sort()
      : r.every === 'month' && r.nthWeekday ? [r.nthWeekday.weekday]
      : [],
    recurrenceMonthDay: (r.every === 'month' || r.every === 'year') && !r.nthWeekday ? r.monthDay ?? null : null,
    recurrenceMonth: r.every === 'year' ? r.month ?? null : null,
    recurrenceWeekOrdinal: r.every === 'month' ? r.nthWeekday?.ordinal ?? null : null,
    // Picking hourly or daily in the app's picker turns this on, so a daily
    // repeat counts from when it's done unless the caller says otherwise.
    recurrenceFromCompletion: r.every === 'hours' ? true : r.fromCompletion ?? r.every === 'day',
    recurrenceEndDate: r.endDate == null ? null : localDateInput(r.endDate),
    recurrenceCount: r.count ?? null,
  };
}

/**
 * The patch for `input`, against `current` (null when creating). Every field
 * left out of `input` is left out of the patch, so an update touches only what
 * it names.
 */
type WeatherConditionInput = 'sunny' | 'rainy' | 'snowy' | 'cold' | 'hot';
const WEATHER_CONDITIONS: readonly WeatherConditionInput[] = ['sunny', 'rainy', 'snowy', 'cold', 'hot'];

export function taskFieldsPatch(
  input: TaskFieldsInput,
  current: Task | null,
  deps: TaskFieldsDeps,
  context: { isSubtask: boolean } = { isSubtask: !!current?.parentId },
): TaskFieldsResult {
  const errors: string[] = [];
  const patch: Partial<Task> = {};

  // ---- plain fields -------------------------------------------------------
  if (input.title !== undefined) {
    if (!input.title.trim()) errors.push('title cannot be blank.');
    else patch.title = input.title.trim();
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.category !== undefined) patch.category = input.category;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  for (const key of ['dueDate', 'deferUntil', 'deadline', 'reminderTime'] as const) {
    const v = input[key];
    if (v === undefined) continue;
    if (v !== null && !isIsoDate(v)) errors.push(`${key} must be an ISO date-time, or null.`);
    else patch[key] = v === null ? null : localDateInput(v);
  }
  // A deadline worked out from the date (`deadlineOffsetDays`, or
  // `deadlineMonthDay` on a monthly repeat) is recomputed against every new
  // occurrence, and the editor never lets a fixed date sit beside it: picking
  // one is its "Fixed date" pill, which drops the rule, and clearing the
  // deadline clears all three. `mergeTaskUpdate` leaves the two fields alone,
  // so without this a date written here would be shown as the recomputed one
  // on the phone and replaced on the next occurrence, with nothing said.
  if (input.deadline !== undefined && hasRelativeDeadline(current)) {
    patch.deadlineOffsetDays = null;
    patch.deadlineMonthDay = null;
  }
  if (input.timeSegments !== undefined) {
    if (input.timeSegments.some(s => !TIME_SEGMENTS.includes(s))) errors.push(`timeSegments must be from ${TIME_SEGMENTS.join(', ')}.`);
    else patch.timeSegments = input.timeSegments;
  }
  if (input.priority !== undefined) {
    if (!inRange(input.priority, [0, 4])) errors.push('priority must be 0 (none) to 4 (urgent).');
    else patch.priority = input.priority as Priority;
  }
  if (input.effort !== undefined) {
    if (!inRange(input.effort, [0, 6])) errors.push('effort must be 0 to 6.');
    else patch.effort = input.effort as Effort;
  }
  if (input.difficulty !== undefined) patch.difficulty = input.difficulty;
  if (input.estimatedMinutes !== undefined) {
    if (input.estimatedMinutes !== null && !(isInt(input.estimatedMinutes) && input.estimatedMinutes > 0)) {
      errors.push('estimatedMinutes must be a positive whole number, or null.');
    } else patch.estimatedMinutes = input.estimatedMinutes;
  }
  if (input.pinned !== undefined) patch.pinned = input.pinned;
  if (input.pinEachOccurrence !== undefined) patch.pinEachOccurrence = input.pinEachOccurrence;
  if (input.deliverableKind !== undefined) {
    if (input.deliverableKind !== null && !DELIVERABLE_KINDS.includes(input.deliverableKind)) {
      errors.push(`deliverableKind must be one of ${DELIVERABLE_KINDS.join(', ')}, or null.`);
    } else patch.deliverableKind = input.deliverableKind;
  }
  if (input.deliverableOptions !== undefined) patch.deliverableOptions = input.deliverableOptions;

  // ---- repeat -------------------------------------------------------------
  if (input.repeat !== undefined) Object.assign(patch, repeatFields(input.repeat, errors));

  // What the rule is once this patch lands; the features below lean on it.
  let recurrence: RecurrenceType = patch.recurrenceType ?? current?.recurrenceType ?? 'none';

  // ---- target ("8 times a day", "3 times a week") --------------------------
  // A water task that follows the food log's target (`followWaterTarget`) has
  // its count written by the app each day, from that target divided by what
  // one unit logs (`syncWaterQuotaTasks`). A count set here would be overwritten
  // on the next pass with nothing said, so it is refused instead; dropping the
  // target altogether is still allowed, and takes the flag with it, since a
  // task with no target has nothing left to follow.
  if (input.target !== undefined && current?.followWaterTarget) {
    if (input.target === null) patch.followWaterTarget = false;
    else {
      errors.push('This task\'s target follows the food log\'s water goal, so the app works the count out each day from that goal and a count set here would be overwritten. Change the water target in the app (Food log, Targets), or clear the target with target: null to stop it following.');
    }
  }
  if (input.target !== undefined && !(input.target !== null && current?.followWaterTarget)) {
    if (input.target === null) {
      Object.assign(patch, {
        targetCount: null,
        targetUnit: null,
        allowOvershoot: false,
        quotaIntervalMinutes: null,
        quotaReminders: false,
        quotaAlwaysVisible: false,
        quotaPeriod: 'day',
      } satisfies Partial<Task>);
    } else {
      const t = input.target;
      if (!inRange(t.count, LIMITS.target)) errors.push(`target.count must be ${LIMITS.target[0]} to ${LIMITS.target[1]}. A task done once needs no target.`);
      if (t.per !== 'day' && t.per !== 'week') errors.push('target.per must be "day" or "week".');
      if (t.per === 'week') {
        // A weekly count resets with the week, so it repeats weekly, and the
        // per-day machinery (an interval, nudges, going over) doesn't apply.
        if (input.repeat && recurrence !== 'weekly') errors.push('A target per week repeats weekly; leave repeat out or set every to "week".');
        if (t.allowOvershoot) errors.push('allowOvershoot only applies to a target per day.');
        Object.assign(patch, { recurrenceType: 'weekly', quotaIntervalMinutes: null, quotaReminders: false, allowOvershoot: false } satisfies Partial<Task>);
        if (recurrence !== 'weekly' && !input.repeat) Object.assign(patch, { ...NO_REPEAT, recurrenceType: 'weekly' });
        recurrence = 'weekly';
      } else {
        // A daily count resets every day, so a task with no rule becomes daily,
        // the same thing choosing a target does in the editor.
        if (recurrence === 'none') {
          Object.assign(patch, { ...NO_REPEAT, recurrenceType: 'daily', recurrenceFromCompletion: true });
          recurrence = 'daily';
        }
        patch.allowOvershoot = t.allowOvershoot ?? false;
      }
      patch.targetCount = t.count;
      patch.quotaPeriod = t.per;
      if (t.unit !== undefined) patch.targetUnit = t.unit;
    }
  }

  // ---- chain --------------------------------------------------------------
  if (input.chain !== undefined) {
    if (input.chain === null) {
      Object.assign(patch, { chainEnabled: false, chainItems: [], chainIndex: 0, chainStepOnSchedule: false } satisfies Partial<Task>);
    } else {
      const steps = input.chain.steps;
      if (steps.length < LIMITS.chainSteps) errors.push('A chain needs at least two steps. One step is just a task.');
      steps.forEach((s, i) => {
        if (!s.title?.trim()) errors.push(`chain.steps[${i}].title cannot be blank.`);
        if (s.asks != null && !STEP_QUESTION_KINDS.includes(s.asks)) errors.push(`chain.steps[${i}].asks must be one of ${STEP_QUESTION_KINDS.join(', ')}. A step cannot ask a pick-one question.`);
        if (s.answerSchedulesNextStep && s.asks !== 'date') errors.push(`chain.steps[${i}].answerSchedulesNextStep needs asks: "date".`);
        if (s.estimatedMinutes != null && !(isInt(s.estimatedMinutes) && s.estimatedMinutes > 0)) errors.push(`chain.steps[${i}].estimatedMinutes must be a positive whole number.`);
      });
      if (input.chain.stepsFollowSchedule && recurrence === 'none') errors.push('chain.stepsFollowSchedule only applies to a chain that repeats.');
      // Step ids are kept by position on an edit: a recorded answer and the
      // live step are both found through them.
      const old = current?.chainItems ?? [];
      const items: ChainItem[] = steps.map((s, i) => ({
        id: old[i]?.id ?? deps.newId(),
        title: s.title?.trim() ?? '',
        estimatedMinutes: s.estimatedMinutes ?? null,
        ...(s.asks ? { deliverableKind: s.asks } : {}),
        ...(s.answerSchedulesNextStep ? { deliverableDatesNextStep: true } : {}),
      }));
      const index = current && current.chainIndex < items.length ? current.chainIndex : 0;
      Object.assign(patch, {
        chainEnabled: true,
        chainItems: items,
        chainIndex: index,
        chainStepOnSchedule: !!input.chain.stepsFollowSchedule && recurrence !== 'none',
      } satisfies Partial<Task>);
    }
  }

  // ---- timed, rotation, health target -------------------------------------
  // The kinds are exclusive in the app: choosing one clears the fields of the
  // others (`bakedFields`). Only checked when this call sets one of the three
  // new kinds, so a chain-and-target pair the older tools already accept is
  // left alone.
  const settingKind = [input.timed, input.rotation, input.healthTarget].some(v => v != null);
  if (settingKind) {
    const clearing = (v: unknown) => v === null;
    const active: string[] = [];
    if (input.chain !== undefined ? input.chain !== null : !!current?.chainEnabled) active.push('chain');
    if (input.target !== undefined ? input.target !== null : !!current && !current.rotationEnabled && (current.targetCount ?? 0) >= 2) active.push('target');
    if (input.timed !== undefined ? input.timed !== null : (current?.timedMinutes ?? 0) > 0) active.push('timed');
    if (input.healthTarget !== undefined ? input.healthTarget !== null : !!current && hasHealthTarget(current)) active.push('healthTarget');
    if (input.rotation !== undefined ? input.rotation !== null : !!current && isRotationTask(current)) active.push('rotation');
    if (active.length > 1) {
      errors.push(`A task is one kind of thing, and this would make it ${active.join(' and ')}. Set the ones to drop to null (${active.filter(k => !clearing((input as Record<string, unknown>)[k])).map(k => `${k}: null`).join(', ')}).`);
    }
  }

  if (input.timed !== undefined) {
    if (input.timed === null) {
      patch.timedMinutes = null;
    } else {
      const mins = input.timed.minutes;
      if (!inRange(mins, LIMITS.timedMinutes)) errors.push(`timed.minutes must be a whole number from ${LIMITS.timedMinutes[0]} to ${LIMITS.timedMinutes[1]}.`);
      // A subtask's stretch is its share of the parent's run, and the parent's
      // total is the sum of them (docs/arch/timed-tasks.md). This writer has no
      // way to keep that sum, so it refuses rather than become a third one.
      if (context.isSubtask) errors.push('A subtask cannot be timed here: its minutes are a share of its parent\'s countdown. Set timed on the parent.');
      patch.timedMinutes = mins;
      // The editor hides Effort and Estimate for a timed task and derives both
      // from the countdown, so a caller that doesn't name them gets the same.
      if (input.effort === undefined) patch.effort = minutesToEffort(mins);
      if (input.estimatedMinutes === undefined) patch.estimatedMinutes = mins;
    }
  }

  if (input.rotation !== undefined) {
    if (input.rotation === null) {
      Object.assign(patch, { rotationEnabled: false, rotationItems: [] } satisfies Partial<Task>);
      // The count was derived from the set, so it goes with it.
      if (current?.rotationEnabled && input.target === undefined) Object.assign(patch, { targetCount: null, quotaPeriod: 'day' } satisfies Partial<Task>);
    } else {
      const titles = (input.rotation.members ?? []).map(m => (typeof m === 'string' ? m.trim() : ''));
      if (titles.length < MIN_ROTATION_ITEMS) errors.push(`A rotation needs at least ${MIN_ROTATION_ITEMS} members. One is just a task.`);
      if (titles.some(t => !t)) errors.push('rotation.members cannot contain a blank title.');
      if (new Set(titles.map(t => t.toLowerCase())).size !== titles.length) errors.push('rotation.members must all be different, or the picker would show the same name twice.');
      if (context.isSubtask) errors.push('A subtask cannot be a rotation.');
      // A member keeps its id when its title is kept: this week's ledger and
      // each member's "last done" are both keyed by it.
      const old = current?.rotationItems ?? [];
      const items: RotationItem[] = titles.map(title => {
        const kept = old.find(o => o.title.trim().toLowerCase() === title.toLowerCase());
        return kept ? { ...kept, title } : { id: deps.newId(), title, linkUrl: null };
      });
      // A weekly period is the rotation's own, and the repeat is what spawns
      // next week's row, so a task with no rule becomes weekly. A rule already
      // there is kept, as the editor keeps it.
      if (recurrence === 'none') {
        Object.assign(patch, { ...NO_REPEAT, recurrenceType: 'weekly' });
        recurrence = 'weekly';
      }
      Object.assign(patch, {
        rotationEnabled: true,
        rotationItems: items,
        targetCount: items.length,
        quotaPeriod: 'week',
      } satisfies Partial<Task>);
    }
  }

  if (input.healthTarget !== undefined) {
    if (input.healthTarget === null) {
      Object.assign(patch, { healthMetric: null, healthTarget: null, healthFollowGoal: false } satisfies Partial<Task>);
    } else {
      const h = input.healthTarget;
      if (!HEALTH_TARGET_METRICS.includes(h.metric)) {
        errors.push(`healthTarget.metric must be one of ${HEALTH_TARGET_METRICS.join(', ')}.`);
      } else {
        const range = HEALTH_TARGET_RANGES[h.metric];
        const target = h.target ?? range.default;
        if (!(isInt(target) && target >= range.min && target <= range.max)) errors.push(`healthTarget.target for ${h.metric} must be a whole number from ${range.min} to ${range.max}.`);
        if (h.followGoal && !followsRingGoal(h.metric)) errors.push(`healthTarget.followGoal only applies to exerciseMinutes, activeEnergyKcal and standHours, not ${h.metric}.`);
        Object.assign(patch, {
          healthMetric: h.metric,
          healthTarget: target,
          healthFollowGoal: followsRingGoal(h.metric) ? !!h.followGoal : false,
        } satisfies Partial<Task>);
      }
    }
  }

  // ---- supply ("12 filters left, reorder at 2") ------------------------------
  if (input.supply !== undefined) {
    if (input.supply === null) {
      Object.assign(patch, {
        supplyCount: null,
        supplyUnit: null,
        supplyRefillCount: null,
        supplyReorderAt: DEFAULT_SUPPLY_REORDER_AT,
        supplyLeadDays: null,
        supplyDeclinedAtCount: null,
      } satisfies Partial<Task>);
    } else {
      const sp = input.supply;
      if (!inRange(sp.count, LIMITS.supplyCount)) errors.push(`supply.count must be a whole number from ${LIMITS.supplyCount[0]} to ${LIMITS.supplyCount[1]}. 0 means it has run out.`);
      if (sp.reorderAt !== undefined && !inRange(sp.reorderAt, LIMITS.supplyReorderAt)) errors.push(`supply.reorderAt must be a whole number from ${LIMITS.supplyReorderAt[0]} to ${LIMITS.supplyReorderAt[1]}. Zero would ask only once it had run out.`);
      if (sp.refillCount != null && !(isInt(sp.refillCount) && sp.refillCount >= 1)) errors.push('supply.refillCount must be a whole number of at least 1, or null.');
      if (sp.leadDays != null && !(isInt(sp.leadDays) && sp.leadDays >= 0 && sp.leadDays <= 365)) errors.push('supply.leadDays must be 0 to 365, or null.');
      // A unit count goes down when a completion spawns the next row, so a task
      // that spawns none has nowhere to count down. The editor offers the card
      // only on a repeating task, and a subtask can't hold one at all.
      if (context.isSubtask) errors.push('A subtask cannot track a supply.');
      else if (recurrence === 'none') errors.push('A supply counts down as a repeating task is completed, so it needs a repeat. Give the task a repeat first.');
      Object.assign(patch, {
        supplyCount: sp.count,
        ...(sp.unit !== undefined ? { supplyUnit: normalizeTargetUnit(sp.unit) } : {}),
        ...(sp.refillCount !== undefined ? { supplyRefillCount: sp.refillCount } : {}),
        ...(sp.reorderAt !== undefined ? { supplyReorderAt: sp.reorderAt } : {}),
        ...(sp.leadDays !== undefined ? { supplyLeadDays: sp.leadDays } : {}),
      } satisfies Partial<Task>);
    }
  }

  // ---- habit ("don't do X") ------------------------------------------------
  if (input.habit !== undefined) {
    if (input.habit === 'avoid') {
      const chained = (patch.chainEnabled ?? current?.chainEnabled) && (patch.chainItems ?? current?.chainItems ?? []).length > 1;
      const targeted = (patch.targetCount ?? (input.target === null ? null : current?.targetCount)) != null;
      if (chained || targeted) errors.push('A "don\'t do this" habit is a plain task; it cannot also be a chain or have a target.');
      if (context.isSubtask) errors.push('A subtask cannot be a "don\'t do this" habit.');
      Object.assign(patch, { polarity: 'negative', showStreak: true } satisfies Partial<Task>);
    } else {
      patch.polarity = 'positive';
    }
  }

  // ---- window ---------------------------------------------------------------
  if (input.window !== undefined) {
    if (input.window === null) {
      Object.assign(patch, { windowStart: null, windowEnd: null });
    } else {
      for (const key of ['start', 'end'] as const) {
        const v = input.window[key];
        if (v != null && !HHMM.test(v)) errors.push(`window.${key} must be a 24-hour "HH:MM" time.`);
      }
      if (input.window.start !== undefined) patch.windowStart = input.window.start;
      if (input.window.end !== undefined) patch.windowEnd = input.window.end;
    }
  }

  // ---- follow-up ("every 3rd time, add X") ---------------------------------
  if (input.followUp !== undefined) {
    if (input.followUp === null) {
      Object.assign(patch, { followUpTaskEveryN: null, followUpTaskAtEnd: false, followUpTaskTitle: null, followUpTaskDraft: null, followUpTaskOneAtATime: false } satisfies Partial<Task>);
    } else {
      const f = input.followUp;
      const atEnd = f.atEnd === true;
      if (recurrence === 'none') errors.push('A follow-up counts completions, so it needs a repeating task.');
      if (context.isSubtask) errors.push('A subtask cannot carry a follow-up.');
      if (atEnd && f.everyN !== undefined) errors.push('followUp.everyN and followUp.atEnd are two triggers; give one.');
      else if (atEnd) {
        const endDate = 'recurrenceEndDate' in patch ? patch.recurrenceEndDate : current?.recurrenceEndDate;
        const count = 'recurrenceCount' in patch ? patch.recurrenceCount : current?.recurrenceCount;
        if (recurrence !== 'none' && !endDate && (count === null || count === undefined)) {
          errors.push('followUp.atEnd needs a repeat that ends: give repeat.count or repeat.endDate.');
        }
      } else if (f.everyN === undefined || !inRange(f.everyN, LIMITS.followUpEveryN)) {
        errors.push(`followUp.everyN must be ${LIMITS.followUpEveryN[0]} to ${LIMITS.followUpEveryN[1]}, or use followUp.atEnd. Every time is just another task.`);
      }
      if (!f.title?.trim()) errors.push('followUp.title cannot be blank.');
      Object.assign(patch, {
        followUpTaskEveryN: atEnd ? null : f.everyN ?? null,
        followUpTaskAtEnd: atEnd,
        followUpTaskTitle: f.title?.trim() ?? null,
        followUpTaskDraft: {
          ...deps.emptyFollowUpDraft(),
          ...(f.notes !== undefined ? { notes: f.notes } : {}),
          ...(f.estimatedMinutes !== undefined ? { estimatedMinutes: f.estimatedMinutes } : {}),
        },
        followUpTaskOneAtATime: atEnd ? false : f.oneAtATime ?? false,
      } satisfies Partial<Task>);
    }
  }

  // ---- weather wait ---------------------------------------------------------
  // Checked against the task as it will be once this patch lands, so asking for
  // a repeat and a wait in one call is refused rather than half applied.
  if (input.weatherWait !== undefined) {
    if (input.weatherWait !== null && !WEATHER_CONDITIONS.includes(input.weatherWait)) {
      errors.push(`weatherWait must be one of ${WEATHER_CONDITIONS.join(', ')}, or null.`);
    } else if (input.weatherWait === null) {
      patch.weatherWait = null;
      // The hold was the app's own, so stopping the wait lets the task go.
      if (current?.weatherWait && input.deferUntil === undefined) patch.deferUntil = null;
    } else {
      const after = {
        ...current,
        recurrenceType: patch.recurrenceType ?? current?.recurrenceType ?? 'none',
        chainEnabled: patch.chainEnabled ?? current?.chainEnabled ?? false,
        parentId: current?.parentId ?? (context.isSubtask ? 'subtask' : null),
      };
      if (!canWaitForWeather(after)) {
        errors.push('weatherWait is only for a plain one-off task: not a repeating task, a chain, a set of dates or a subtask.');
      } else {
        patch.weatherWait = input.weatherWait;
      }
    }
  }

  // ---- blockers -------------------------------------------------------------
  let waitsOn: string[] | undefined;
  if (input.waitsOn !== undefined) {
    waitsOn = [...new Set(input.waitsOn.filter(id => typeof id === 'string' && id))];
    if (current && waitsOn.includes(current.id)) errors.push('A task cannot wait on itself.');
  }

  if (input.waitForSeriesEnd !== undefined) patch.waitForSeriesEnd = input.waitForSeriesEnd;

  // ---- answer gate ----------------------------------------------------------
  let onlyIfAnswer: { taskId: string; answers: string[] } | undefined;
  if (input.onlyIfAnswer === null) patch.answerGate = null;
  else if (input.onlyIfAnswer !== undefined) {
    const answers = [...new Set((input.onlyIfAnswer.answers ?? []).map(a => (typeof a === 'string' ? a.trim() : '')).filter(Boolean))];
    if (!input.onlyIfAnswer.taskId) errors.push('onlyIfAnswer needs the taskId of the task asking the question.');
    else if (current && input.onlyIfAnswer.taskId === current.id) errors.push('A task cannot depend on its own answer.');
    if (answers.length === 0) errors.push('onlyIfAnswer needs at least one answer: with none, every answer would rule the task out.');
    onlyIfAnswer = { taskId: input.onlyIfAnswer.taskId, answers };
  }

  return { patch, ...(waitsOn ? { waitsOn } : {}), ...(onlyIfAnswer ? { onlyIfAnswer } : {}), errors };
}

/**
 * A project's event date as stored: midday on the named day (Project.eventDate),
 * or null when it can't be read. A bare "2027-06-14" is that calendar day where
 * the app is, not midnight UTC, which west of Greenwich is the day before.
 */
export function eventNoonIso(input: string): string | null {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/** How a repeat rule reads, for `get_task`. Null when the task doesn't repeat. */
export function describeRepeat(t: Task): RepeatInput | null {
  const every = (Object.keys(EVERY_TO_TYPE) as RepeatEvery[]).find(k => EVERY_TO_TYPE[k] === t.recurrenceType);
  if (!every || every === 'never') return null;
  const out: RepeatInput = { every };
  if (t.recurrenceInterval > 1) out.interval = t.recurrenceInterval;
  if (every === 'week' && t.recurrenceDays.length > 0) out.weekdays = t.recurrenceDays;
  if (t.recurrenceWeekOrdinal != null && t.recurrenceDays.length > 0) {
    out.nthWeekday = { ordinal: t.recurrenceWeekOrdinal, weekday: t.recurrenceDays[0] };
  } else if (t.recurrenceMonthDay != null) out.monthDay = t.recurrenceMonthDay;
  if (t.recurrenceMonth != null) out.month = t.recurrenceMonth;
  if (t.recurrenceFromCompletion) out.fromCompletion = true;
  if (t.recurrenceEndDate) out.endDate = t.recurrenceEndDate;
  if (t.recurrenceCount != null) out.count = t.recurrenceCount;
  return out;
}

/** A rotation as `get_task` shows it: the members, and which this week's picks cover. */
export function describeRotation(t: Task, doneIds: ReadonlySet<string>): { members: { title: string; doneThisWeek: boolean; lastDone?: string }[] } | null {
  if (!isRotationTask(t)) return null;
  const last = t.rotationLastDone ?? {};
  return {
    members: (t.rotationItems ?? []).map(m => ({
      title: m.title,
      doneThisWeek: doneIds.has(m.id),
      ...(last[m.id] ? { lastDone: last[m.id] } : {}),
    })),
  };
}

/** A supply as `get_task` shows it. Null when the task tracks none. */
export function describeSupplyFields(t: Task): SupplyInput | null {
  if (t.supplyCount === null || t.supplyCount === undefined) return null;
  return {
    count: t.supplyCount,
    ...(t.supplyUnit ? { unit: t.supplyUnit } : {}),
    ...(t.supplyRefillCount != null ? { refillCount: t.supplyRefillCount } : {}),
    reorderAt: t.supplyReorderAt,
    ...(t.supplyLeadDays != null ? { leadDays: t.supplyLeadDays } : {}),
  };
}

/** A health target as `get_task` shows it. Null when the task has none. */
export function describeHealthTarget(t: Task): HealthTargetInput | null {
  if (!hasHealthTarget(t) || t.healthMetric === null || t.healthTarget === null) return null;
  return { metric: t.healthMetric, target: t.healthTarget, ...(t.healthFollowGoal ? { followGoal: true } : {}) };
}

/** Whether the deadline is worked out from the date rather than a fixed day (see `describeDeadlineRule`). */
export function hasRelativeDeadline(t: Pick<Task, 'deadlineOffsetDays' | 'deadlineMonthDay'> | null): boolean {
  return t != null && (t.deadlineOffsetDays != null || t.deadlineMonthDay != null);
}

/**
 * A deadline that is recomputed from the date on every occurrence, as
 * `get_task` shows it. `deadlineOffsetDays` is signed with positive counting
 * back from the date, which reads badly as a bare number, so it is split into
 * the two directions; `deadlineMonthDay` is a day of the date's own month, -1
 * for the last. Null for a fixed deadline, or none. Read-only: a `deadline`
 * written by update_task clears the rule, as the editor's "Fixed date" does.
 */
export interface DeadlineRule {
  daysBeforeDate?: number;
  daysAfterDate?: number;
  dayOfMonth?: number | 'last';
}

export function describeDeadlineRule(t: Pick<Task, 'deadlineOffsetDays' | 'deadlineMonthDay'>): DeadlineRule | null {
  if (t.deadlineOffsetDays != null) {
    return t.deadlineOffsetDays >= 0 ? { daysBeforeDate: t.deadlineOffsetDays } : { daysAfterDate: -t.deadlineOffsetDays };
  }
  if (t.deadlineMonthDay != null) return { dayOfMonth: t.deadlineMonthDay === -1 ? 'last' : t.deadlineMonthDay };
  return null;
}

/**
 * A reminder that is placed by rule rather than at a fixed moment, as
 * `get_task` shows it: `reminderOffsetDays` before the date (at the reminder's
 * own time of day), or `reminderTracksVisibility`, which rings the moment the
 * task surfaces (off a defer, or a time-of-day segment opening). Null for a
 * reminder at a fixed time, or none. Read-only here.
 */
export interface ReminderRule {
  daysBeforeDate?: number;
  whenItSurfaces?: true;
}

export function describeReminderRule(t: Pick<Task, 'reminderOffsetDays' | 'reminderTracksVisibility'>): ReminderRule | null {
  if (t.reminderTracksVisibility) return { whenItSurfaces: true };
  if (t.reminderOffsetDays != null) return { daysBeforeDate: t.reminderOffsetDays };
  return null;
}
