import type { ScreenTimeRule, Task } from '../types';
import { generateId } from './id';
import { generatedSourceOf } from './generatedTasks';

/**
 * Screen Time rules — "after 30 minutes on the apps I picked, add a task".
 *
 * The rules module for the `screenTime` generator (see `generatedTasks.ts` and
 * `docs/arch/generated-tasks.md`), store-free like `weatherTasks.ts` beside
 * it, which this is modelled on almost line for line: orchestration — reading
 * settings, draining what the OS reported, calling `reconcileGeneratedTask` —
 * lives in `useTaskStore.ts`'s `checkScreenTimeTasks`. What's here is the
 * storage round-trip for the rule list and the pure predicates around it.
 *
 * Where it differs from weather is worth stating once, because both
 * differences come from the same place: the app cannot see usage.
 *
 * - **There is no classifier.** `weatherCondition.ts` turns a reading into a
 *   closed vocabulary because the app *has* the reading. Usage numbers are
 *   only legible inside a sandboxed report extension, so the app never learns
 *   how long anything was used for. What arrives instead is "rule X crossed",
 *   already decided by the OS against a threshold the app armed it with.
 * - **Every rule watches one app selection.** The picked apps are opaque
 *   tokens in the App Group, not something a rule could hold, so rules differ
 *   by threshold and title alone.
 */

/** A rule can't be an empty task title — nothing to show on Today. */
export const SCREEN_TIME_RULE_TITLE_MAX_LENGTH = 80;

/**
 * The range a threshold can be set to.
 *
 * The floor is 5 rather than 1 because DeviceActivity's own threshold
 * resolution is coarse and a one-minute event is reported late enough to read
 * as broken. The ceiling is a working day; past that the rule is about a
 * habit nothing here is going to fix.
 */
export const SCREEN_TIME_THRESHOLD_MIN = 5;
export const SCREEN_TIME_THRESHOLD_MAX = 480;
export const SCREEN_TIME_THRESHOLD_DEFAULT = 30;

export function clampThresholdMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return SCREEN_TIME_THRESHOLD_DEFAULT;
  return Math.min(SCREEN_TIME_THRESHOLD_MAX, Math.max(SCREEN_TIME_THRESHOLD_MIN, Math.round(minutes)));
}

/**
 * The two rules the feature ships with, pre-filled rather than starting from
 * an empty list — the same call `defaultWeatherRules` makes, and for the same
 * reason: the obvious rules are obvious, and typing one from scratch is the
 * trip a shipped default saves. Each still has its own `enabled`, and the
 * generator's settings toggle (`screenTimeTasks`) ships off, so nobody sees a
 * task from these until they turn the feature on and pick some apps.
 */
export function defaultScreenTimeRules(): ScreenTimeRule[] {
  return [
    { id: generateId(), thresholdMinutes: 30, title: 'Take a walk', enabled: true, lastFiredDayKey: null },
    { id: generateId(), thresholdMinutes: 90, title: 'Put the phone in another room', enabled: true, lastFiredDayKey: null },
  ];
}

/**
 * Read the stored list back, tolerantly.
 *
 * A malformed value reads as "nothing saved" and a bad entry is dropped rather
 * than discarding the list — `parseWeatherRules`' rules exactly.
 */
export function parseScreenTimeRules(raw: string | null | undefined): ScreenTimeRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): ScreenTimeRule[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const rule = entry as Partial<ScreenTimeRule>;
    if (typeof rule.id !== 'string' || rule.id === '') return [];
    if (typeof rule.title !== 'string' || rule.title.trim() === '') return [];
    if (typeof rule.thresholdMinutes !== 'number') return [];
    return [{
      id: rule.id,
      thresholdMinutes: clampThresholdMinutes(rule.thresholdMinutes),
      title: rule.title.slice(0, SCREEN_TIME_RULE_TITLE_MAX_LENGTH),
      enabled: rule.enabled !== false,
      lastFiredDayKey: typeof rule.lastFiredDayKey === 'string' ? rule.lastFiredDayKey : null,
    }];
  });
}

export function serializeScreenTimeRules(rules: readonly ScreenTimeRule[]): string {
  return JSON.stringify(rules);
}

/** `${dayKey}#${ruleId}` — a square on the calendar and the rule that named it. */
export function screenTimeSourceId(dayKey: string, ruleId: string): string {
  return `${dayKey}#${ruleId}`;
}

export function parseScreenTimeSourceId(
  sourceId: string | null | undefined,
): { dayKey: string; ruleId: string } | null {
  if (!sourceId) return null;
  const index = sourceId.indexOf('#');
  if (index <= 0 || index === sourceId.length - 1) return null;
  return { dayKey: sourceId.slice(0, index), ruleId: sourceId.slice(index + 1) };
}

/** The rule id a screen-time task came from, or null for any other task. */
export function screenTimeRuleIdOf(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
): string | null {
  return parseScreenTimeSourceId(generatedSourceOf(task, 'screenTime'))?.ruleId ?? null;
}

/**
 * The rules to hand the OS: enabled, and with a usable threshold.
 *
 * A disabled rule is left out of the monitor entirely rather than armed and
 * ignored on the way back — an event the app would only discard is still an
 * event iOS wakes an extension for.
 */
export function armableRules(
  rules: readonly ScreenTimeRule[],
): Array<{ id: string; thresholdMinutes: number }> {
  return rules
    .filter(rule => rule.enabled && rule.thresholdMinutes > 0)
    .map(rule => ({ id: rule.id, thresholdMinutes: rule.thresholdMinutes }));
}

/**
 * Whether a crossing reported for `rule` on `dayKey` should become a task.
 *
 * Doesn't ask what the usage was — the OS already decided that against the
 * threshold this rule armed it with, and the app has no way to check its
 * working. What it does check is the idempotency mark, which is the whole
 * defence against a rule firing twice in a day: unlike weather, the mark can't
 * be spent ahead of the decision, because the decision isn't the app's to
 * make (see ScreenTimeRule.lastFiredDayKey).
 */
export function crossingWantsTask(rule: ScreenTimeRule, dayKey: string): boolean {
  return rule.enabled && rule.lastFiredDayKey !== dayKey;
}
