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
  Priority,
  RecurrenceType,
  Task,
  TimeOfDay,
} from '../../src/types';
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
} as const;

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
  pinned?: boolean;
  deliverableKind?: DeliverableKind | null;
  deliverableOptions?: string[];
  repeat?: RepeatInput;
  chain?: ChainInput | null;
  target?: TargetInput | null;
  window?: WindowInput | null;
  habit?: 'do' | 'avoid';
  waitsOn?: string[];
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
  if (input.target !== undefined) {
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

  // ---- blockers -------------------------------------------------------------
  let waitsOn: string[] | undefined;
  if (input.waitsOn !== undefined) {
    waitsOn = [...new Set(input.waitsOn.filter(id => typeof id === 'string' && id))];
    if (current && waitsOn.includes(current.id)) errors.push('A task cannot wait on itself.');
  }

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
