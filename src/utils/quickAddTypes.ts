import type { ChainItem, Effort, RecurrenceType } from '../types';
import { formatDuration, minutesToEffort } from './effort';

/**
 * The shapes a task can be created in from quick add.
 *
 * These aren't new models — every one of them is an ordinary Task with a
 * couple of fields set. What the type buys is discovery: timed tasks, quotas
 * and chains were each reachable only from one row buried somewhere in the
 * editor, so most people never learned they existed. Naming them at the top of
 * the sheet, next to the field you were going to type into anyway, is the
 * cheapest place to say "this is a thing the app does".
 */
export type QuickAddType = 'task' | 'timed' | 'target' | 'chain';

/** Every attribute chip the quick-add toolbar can offer. */
export type QuickAddChip =
  | 'date' | 'repeat' | 'segment' | 'priority' | 'effort' | 'tags' | 'category' | 'link';

export const QUICK_ADD_TYPES: readonly QuickAddType[] = ['task', 'timed', 'target', 'chain'];

/** Duration a Timed task starts at, so the mode is never sitting there empty. */
export const DEFAULT_TIMED_MINUTES = 15;
/** Same for a quota — a target of 1 isn't a quota, so the floor is the default. */
export const DEFAULT_TARGET_COUNT = 3;

export const TIMED_MINUTE_OPTIONS = [5, 10, 15, 25, 30, 60] as const;
/**
 * Offered daily targets, shared with the editor's own Daily target row. Small
 * enough to tap through, and stops short of the point where a quota stops
 * being a habit and starts being a tally.
 */
export const TARGET_COUNT_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12] as const;

/**
 * Chips a type leaves out because picking the type already answered them.
 *
 * Only ever list a chip the type genuinely decides. Hiding one it merely
 * doesn't need isn't simplification, it's a missing feature — a chain still
 * wants a date, a quota still wants a category.
 */
const HIDDEN_CHIPS: Record<QuickAddType, readonly QuickAddChip[]> = {
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

export function isChipVisible(type: QuickAddType, chip: QuickAddChip): boolean {
  return !HIDDEN_CHIPS[type].includes(chip);
}

/** The current values of every type-defining field, as quick add holds them. */
export interface TypeValues {
  timedMinutes: number | null;
  targetCount: number | null;
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
export function typeSummary(type: QuickAddType, v: TypeValues): string | null {
  switch (type) {
    case 'task':
      return null;
    case 'timed':
      return v.timedMinutes != null
        ? `Counts down ${formatDuration(v.timedMinutes)} once you start it.`
        : 'Counts down a set time once you start it.';
    case 'target':
      return v.targetCount != null
        ? `Log it ${v.targetCount}× a day. Repeats daily, and only shows up when you fall behind.`
        : 'Log it several times a day. Repeats daily, and only shows up when you fall behind.';
    case 'chain':
      return v.chainItems.length > 0
        ? `${v.chainItems.length} step${v.chainItems.length === 1 ? '' : 's'}, one per completion — finishing one reveals the next.`
        : 'Steps through a list one at a time — finishing one reveals the next.';
  }
}

/**
 * Whether the sheet has enough to create this type. A chain with no steps
 * would save a task that advertises steps and has none, so it's the one mode
 * that needs more than a title.
 */
export function canSaveType(type: QuickAddType, v: TypeValues): boolean {
  return type !== 'chain' || v.chainItems.length > 0;
}

/** Why the add button is disabled, for the prompt under the steps list. */
export function blockedReason(type: QuickAddType, v: TypeValues): string | null {
  if (canSaveType(type, v)) return null;
  return 'Add at least one step.';
}

/** The fields the type itself sets, laid over whatever the sheet collected. */
export interface BakedFields {
  timedMinutes: number | null;
  targetCount: number | null;
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
export function bakedFields(type: QuickAddType, v: TypeValues): BakedFields {
  const base: BakedFields = {
    timedMinutes: null,
    targetCount: null,
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
        recurrenceType: v.recurrenceType === 'none' ? 'daily' : v.recurrenceType,
      };
    case 'chain':
      return { ...base, chainEnabled: true, chainItems: v.chainItems, chainIndex: 0 };
  }
}
