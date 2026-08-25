import type { ChainItem, Effort, RecurrenceType } from '../types';
import { formatDuration, minutesToEffort } from './effort';
import { formatQuotaTarget, normalizeTargetUnit } from './quotaUnit';

/**
 * The shapes a task can take.
 *
 * These aren't new models — every one is an ordinary Task with a couple of
 * fields set. What the kind buys is discovery: timed tasks, quotas and chains
 * are each just a field, so nothing in the app ever said they were a choice,
 * and most people never learned they existed.
 *
 * **The kind is derived, never stored.** There is no `kind` column and there
 * shouldn't be — `taskKindOf` reads it back off the fields themselves, so a
 * task edited by any other path (a template, an import, a store action) can't
 * end up with a label disagreeing with its own shape. `bakedFields` is the
 * other half: it's the only way to *set* a kind, and it clears the fields of
 * the other three, which is what makes them exclusive.
 *
 * They were briefly a picker at the top of quick add, which is the wrong place
 * — a sheet that exists to capture a title in two taps shouldn't spend its
 * first row on a choice that's "standard" almost every time. The editor is
 * where you go when a task needs to be more than a line of text, so that's
 * where the choice lives.
 */
export type TaskKind = 'task' | 'timed' | 'target' | 'chain';

/** Label, glyph and one-line explanation for each kind, in picker order. */
export const TASK_KIND_META: {
  key: TaskKind;
  label: string;
  icon: string;
  /** What picking it does, in one line. See `typeSummary` for the set-up version. */
  hint: string;
}[] = [
  { key: 'task', label: 'Standard', icon: 'checkbox-outline', hint: 'An ordinary task. Check it off once.' },
  { key: 'timed', label: 'Timed', icon: 'timer-outline', hint: 'Counts down a set time once you start it.' },
  { key: 'target', label: 'Daily target', icon: 'speedometer-outline', hint: 'Log it several times a day.' },
  { key: 'chain', label: 'Chain', icon: 'git-commit-outline', hint: 'Steps through a list one at a time.' },
];

/**
 * Which kind a task's fields add up to.
 *
 * Order is precedence, and it matters because nothing until now stopped a task
 * being two shapes at once: quick add went through `bakedFields` and so could
 * only ever produce one, but the editor held the three fields independently
 * and would happily save a chain that was also a daily target. Rows like that
 * exist in the wild, so this has to answer for them rather than assume they
 * don't. Chain wins because it's the most structural — it changes what
 * completing the task *does* — then target, which owns the repeat, then timed,
 * which is the thinnest of the three.
 *
 * Deriving rather than storing also means this needs no migration: an existing
 * task reads back as whatever it already was.
 */
export function taskKindOf(v: {
  chainEnabled: boolean;
  targetCount: number | null;
  timedMinutes: number | null;
}): TaskKind {
  // `chainEnabled` alone, deliberately, even though a one-item chain doesn't
  // *function* as one anywhere else in the app. That rule belongs at save,
  // where TaskEditor already applies it — read it here and a task would stop
  // being a chain the moment you opened the editor to add its second step.
  if (v.chainEnabled) return 'chain';
  if (v.targetCount !== null) return 'target';
  if (v.timedMinutes !== null) return 'timed';
  return 'task';
}

/** Every attribute chip the quick-add toolbar can offer. */
export type QuickAddChip =
  | 'date' | 'repeat' | 'segment' | 'priority' | 'effort' | 'tags' | 'category' | 'link' | 'phone' | 'email'
  | 'supply';

/**
 * What a chip reads before it has a value.
 *
 * Chips used to render their icon alone until something was set, and their
 * label only afterwards — so each one named itself exactly once the user no
 * longer needed telling, and was an unlabelled glyph for the whole period they
 * did. Ten of those in a row is the toolbar's entire first impression.
 *
 * A set chip still shows its value instead (the value is the more useful of
 * the two, and "Date: Tue 12" in an accessibility label reads better than
 * either half alone) — this is only the resting state.
 */
export const QUICK_ADD_CHIP_LABELS: Record<QuickAddChip, string> = {
  date: 'Date',
  repeat: 'Repeat',
  segment: 'Time of day',
  priority: 'Priority',
  effort: 'Effort',
  tags: 'Tags',
  category: 'Category',
  link: 'Link',
  phone: 'Phone',
  email: 'Email',
  supply: 'Supply',
};

/**
 * Chips shown before the toolbar folds the rest behind one "N more".
 *
 * Labelling every chip costs the width the icons used to save, so ten of them
 * is four rows of pills above the keyboard. Eight is three rows, with the
 * contact-detail chips (phone/email) a tap away. Anything already set is
 * exempt from the cap, so a chip the typed title just filled in never hides
 * itself (`resolvePillOverflow`).
 *
 * This was five, on the arithmetic that five is two rows. It never was: the
 * chips are content-sized and the widest pair ran a few points past the sheet's
 * 294pt of inner width at 390pt, so only two ever landed on a line and five
 * stood three rows tall with a ragged gap down the right. Three fit per line
 * now (see `toolChip`'s padding in QuickAddModal), so three rows carries eight.
 */
export const QUICK_ADD_CHIP_LIMIT = 8;

export const TASK_KINDS: readonly TaskKind[] = ['task', 'timed', 'target', 'chain'];

/** Duration a Timed task starts at, so the mode is never sitting there empty. */
export const DEFAULT_TIMED_MINUTES = 15;
/** Same for a quota — a target of 1 isn't a quota, so the floor is the default. */
export const DEFAULT_TARGET_COUNT = 3;

export const TIMED_MINUTE_OPTIONS = [5, 10, 15, 25, 30, 60] as const;
/**
 * Range of the daily target stepper, shared with the editor's own Daily target
 * row. A target of 1 isn't a quota, so 2 is the floor; the ceiling is only
 * there to keep a held key and a fat-fingered digit from producing a meter
 * nobody can fill, not because a habit stops making sense somewhere below it.
 *
 * This used to be a fixed list of chips ([2..6, 8, 10, 12]), which had to pick
 * both a granularity and a ceiling for everyone — 7 was unsayable and 20 was
 * off the end.
 */
export const MIN_TARGET_COUNT = 2;
export const MAX_TARGET_COUNT = 99;

/**
 * Chips a type leaves out because picking the type already answered them.
 *
 * Only ever list a chip the type genuinely decides. Hiding one it merely
 * doesn't need isn't simplification, it's a missing feature — a chain still
 * wants a date, a quota still wants a category.
 */
const HIDDEN_CHIPS: Record<TaskKind, readonly QuickAddChip[]> = {
  task: [],
  // For a timed task the countdown *is* the estimate, and bakedFields derives
  // effort from it — two controls asking "how long?" is the confusion the
  // mode exists to remove.
  timed: ['effort'],
  // A quota resets by spawning its next occurrence, so it is always on a
  // repeat; the editor sets one behind your back for the same reason.
  target: ['repeat'],
  // A chain decides the *order* of work, not any of its attributes — Repeat
  // stays because on a chain it means "start the list over", which is a real
  // and separate choice.
  chain: [],
};

export function isChipVisible(type: TaskKind, chip: QuickAddChip): boolean {
  return !HIDDEN_CHIPS[type].includes(chip);
}

/** The current values of every type-defining field, as quick add holds them. */
export interface TypeValues {
  timedMinutes: number | null;
  targetCount: number | null;
  targetUnit: string | null;
  chainItems: ChainItem[];
  recurrenceType: RecurrenceType;
  effort: Effort;
  estimatedMinutes: number | null;
}

/**
 * The one line under the type row explaining what the mode just decided for
 * you. This is the only in-app documentation these features have, so it says
 * what happens rather than naming the setting.
 */
export function typeSummary(type: TaskKind, v: TypeValues): string | null {
  switch (type) {
    case 'task':
      return null;
    case 'timed':
      return v.timedMinutes != null
        ? `Counts down ${formatDuration(v.timedMinutes)} once you start it.`
        : 'Counts down a set time once you start it.';
    case 'target':
      return v.targetCount != null
        ? `Log it ${formatQuotaTarget(v.targetCount, v.targetUnit)} a day. Repeats daily, and only shows up when you fall behind.`
        : 'Log it several times a day. Repeats daily, and only shows up when you fall behind.';
    case 'chain':
      return v.chainItems.length > 0
        ? `${v.chainItems.length} step${v.chainItems.length === 1 ? '' : 's'}, one per completion. Finishing one reveals the next.`
        : 'Steps through a list one at a time. Finishing one reveals the next.';
  }
}

/**
 * Whether the sheet has enough to create this type. A chain with no steps
 * would save a task that advertises steps and has none, so it's the one mode
 * that needs more than a title.
 */
export function canSaveType(type: TaskKind, v: TypeValues): boolean {
  return type !== 'chain' || v.chainItems.length > 0;
}

/** Why the add button is disabled, for the prompt under the steps list. */
export function blockedReason(type: TaskKind, v: TypeValues): string | null {
  if (canSaveType(type, v)) return null;
  return 'Add at least one step.';
}

/** The fields the type itself sets, laid over whatever the sheet collected. */
export interface BakedFields {
  timedMinutes: number | null;
  targetCount: number | null;
  targetUnit: string | null;
  chainEnabled: boolean;
  chainItems: ChainItem[];
  chainIndex: number;
  recurrenceType: RecurrenceType;
  effort: Effort;
  estimatedMinutes: number | null;
}

/**
 * Resolves the sheet's state into the fields a task is actually created with.
 *
 * Every type-defining field is cleared by the types that don't use it, so a
 * duration typed in Timed mode can't ride along into a plain task after a
 * switch. The one value read rather than overwritten is `recurrenceType` on a
 * quota: 'none' would leave nothing to reset the count each day, but a repeat
 * the user set deliberately is theirs to keep.
 */
export function bakedFields(type: TaskKind, v: TypeValues): BakedFields {
  const base: BakedFields = {
    timedMinutes: null,
    targetCount: null,
    // Dropped with the count it labels: a unit typed in Target mode and then
    // abandoned by switching type would otherwise ride along on a plain task
    // that has no count for it to sit beside.
    targetUnit: null,
    chainEnabled: false,
    chainItems: [],
    chainIndex: 0,
    recurrenceType: v.recurrenceType,
    effort: v.effort,
    estimatedMinutes: v.estimatedMinutes,
  };

  switch (type) {
    case 'task':
      return base;
    case 'timed': {
      const mins = v.timedMinutes;
      return {
        ...base,
        timedMinutes: mins,
        // The Effort chip is hidden in this mode, so derive it from the
        // countdown rather than leaving every timed task at effort 0 and
        // invisible to the effort sorts and filters.
        effort: mins != null ? minutesToEffort(mins) : base.effort,
        estimatedMinutes: mins ?? base.estimatedMinutes,
      };
    }
    case 'target':
      return {
        ...base,
        targetCount: v.targetCount,
        targetUnit: normalizeTargetUnit(v.targetUnit),
        recurrenceType: v.recurrenceType === 'none' ? 'daily' : v.recurrenceType,
      };
    case 'chain':
      return { ...base, chainEnabled: true, chainItems: v.chainItems, chainIndex: 0 };
  }
}
