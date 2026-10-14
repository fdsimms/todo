import type { MealSlot, RuleTaskLog, Task } from '../types';
import { MEAL_SLOTS } from '../types';
import { medicationKey } from './medicationLog';

/**
 * What the task a rule writes records when it is completed, kept on the rule.
 *
 * A rule writes a fresh one-off row each day it matches, so "Take sodium
 * chloride" used to need its dose logged by hand every time. A rule can now
 * carry the same fields a task does (`Task.medicationName` and its amount and
 * unit; `Task.logMealSlot`, `logSavedMealId`, `logMealSlotByTime`), and each task
 * it writes starts with them, so completing the task is what logs the dose or the
 * food. The meaning of every field is the task's own; nothing here reads them.
 *
 * Two homes for the answer, like the estimate (`ruleEstimate.ts`): the rule
 * sheet's "When completed" controls set it directly, and editing the fields on a
 * task a rule wrote writes them back onto the rule (`writeLogToSource` in
 * `useTaskStore`), so the next task starts with them.
 *
 * Dose and food are independent, as they are on a task. A rule that names neither
 * stores neither field, so a rule saved before this existed reads back unchanged.
 */

export const RULE_MEDICATION_NAME_MAX_LENGTH = 60;

/** Every key a rule's log occupies, for stripping before a replacement is spread in. */
const LOG_KEYS = [
  'medicationName', 'medicationAmount', 'medicationUnit',
  'logMealSlot', 'logSavedMealId', 'logMealSlotByTime',
] as const;

function isMealSlot(v: unknown): v is MealSlot {
  return typeof v === 'string' && (MEAL_SLOTS as readonly string[]).includes(v);
}

/**
 * The fields off a stored rule (or a task, which has the same names), for a
 * parser to spread in. Empty when nothing is logged.
 *
 * The dose is resolved as a set, the way `medicationFor` resolves one: no name,
 * no amount; an amount with no unit (or the reverse) is no amount, which reads as
 * "the medication's usual amount" at completion. A saved meal and the by-time
 * switch mean nothing without a meal slot, so they go with it.
 */
export function parseRuleLog(raw: RuleTaskLog): RuleTaskLog {
  const out: RuleTaskLog = {};
  const name = typeof raw.medicationName === 'string'
    ? raw.medicationName.trim().slice(0, RULE_MEDICATION_NAME_MAX_LENGTH)
    : '';
  if (name) {
    out.medicationName = name;
    const amount = raw.medicationAmount;
    const usable = typeof amount === 'number' && Number.isFinite(amount) && amount > 0
      && typeof raw.medicationUnit === 'string' && raw.medicationUnit !== '';
    if (usable) {
      out.medicationAmount = amount;
      out.medicationUnit = raw.medicationUnit;
    }
  }
  if (isMealSlot(raw.logMealSlot)) {
    out.logMealSlot = raw.logMealSlot;
    if (typeof raw.logSavedMealId === 'string' && raw.logSavedMealId !== '') out.logSavedMealId = raw.logSavedMealId;
    if (raw.logMealSlotByTime === true) out.logMealSlotByTime = true;
  }
  return out;
}

/**
 * What a rule's task draft spreads in: the rule's log fields, or nothing.
 * Always the whole group that is set, so a draft never carries an amount for a
 * medication it doesn't name.
 */
export function ruleLogDraft(rule: RuleTaskLog): RuleTaskLog {
  const log = parseRuleLog(rule);
  return {
    ...log,
    ...(log.medicationName ? { medicationAmount: log.medicationAmount ?? null, medicationUnit: log.medicationUnit ?? null } : {}),
  };
}

/** The log fields a task carries, as a rule would store them. */
export function ruleLogOfTask(task: Task): RuleTaskLog {
  return parseRuleLog({
    medicationName: task.medicationName,
    medicationAmount: task.medicationAmount,
    medicationUnit: task.medicationUnit,
    logMealSlot: task.logMealSlot,
    logSavedMealId: task.logSavedMealId,
    logMealSlotByTime: task.logMealSlotByTime,
  });
}

function sameLog(a: RuleTaskLog, b: RuleTaskLog): boolean {
  return LOG_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));
}

/** Whether two tasks differ in anything a rule would keep, for the write-back's gate. */
export function taskLogChanged(before: Task, after: Task): boolean {
  return !sameLog(ruleLogOfTask(before), ruleLogOfTask(after));
}

/**
 * The rule list with one rule's log replaced, or null when nothing would change
 * (no such rule, or it already says this), so a caller can skip the settings
 * write.
 */
export function withRuleLog<R extends RuleTaskLog & { id: string }>(
  rules: readonly R[],
  ruleId: string,
  log: RuleTaskLog,
): R[] | null {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return null;
  const next = parseRuleLog(log);
  if (sameLog(parseRuleLog(rule), next)) return null;
  return rules.map(r => {
    if (r.id !== ruleId) return r;
    const rest = { ...r } as Record<string, unknown>;
    LOG_KEYS.forEach(k => { delete rest[k]; });
    return { ...rest, ...next } as R;
  });
}

/** The rules with a renamed medication followed, or the same array when none names it. */
export function renamedRuleLogs<R extends RuleTaskLog>(rules: R[], fromKey: string, to: string): R[] {
  const names = (r: R) => !!r.medicationName && medicationKey(r.medicationName) === fromKey;
  if (!rules.some(names)) return rules;
  return rules.map(r => (names(r) ? { ...r, medicationName: to } : r));
}

/** One line for a rule's row: "Logs 20 mg Sertraline", "Logs Metamucil", both joined. Empty when it logs nothing. */
export function describeRuleLog(rule: RuleTaskLog, savedMealName: (id: string) => string | null): string {
  const log = parseRuleLog(rule);
  const parts: string[] = [];
  if (log.medicationName) {
    parts.push(log.medicationAmount != null
      ? `${log.medicationAmount} ${log.medicationUnit} ${log.medicationName}`
      : `a dose of ${log.medicationName}`);
  }
  if (log.logMealSlot) {
    const meal = log.logSavedMealId ? savedMealName(log.logSavedMealId) : null;
    parts.push(meal ?? 'food (asks which)');
  }
  return parts.length > 0 ? `Logs ${parts.join(' and ')}` : '';
}
