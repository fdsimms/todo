import type { ChainItem, MedicationLog, Task, TemplateItem } from '../types';
import { medicationKey } from './medicationLog';
import type { MedicationSettingsMap } from './medicationSettings';

/**
 * Renaming a medication, or folding one into another.
 *
 * A medication has no row of its own (`medicationKey`), so a rename is a
 * rewrite of every place that holds the name: the doses, the limit and supply
 * (`medication_settings`), the archived and milestone-dismissed key lists, the
 * tasks, chain steps and template items that record a dose. Each function here
 * is the pure half of one of those; `useMedicationStore.renameMedication` and
 * `renameMedicationEverywhere` (`medicationRenameApply.ts`) do the writes.
 *
 * **Folding two medications together is a decision the person makes, never one
 * the app makes for them.** `medicationKey` still refuses fuzzy matching, so
 * "Ibuprofen 200" and "Ibuprofen 400" stay separate until somebody renames one
 * onto the other. What makes that safe is that a dose keeps its own `amount`
 * and `unit` through the rename, and `fill` below can stamp the strength the
 * old name was carrying onto the doses that never recorded one.
 */

/** A strength to stamp onto doses that have none. Both halves, or no fill. */
export interface DoseFill {
  amount: number;
  unit: string;
}

/**
 * Doses of `fromKey` renamed to `to`, with `fill` applied to any that record no
 * amount. Returns the doses that actually changed, not the whole list.
 */
export function renamedLogs(
  logs: readonly MedicationLog[],
  fromKey: string,
  to: string,
  fill: DoseFill | null,
): MedicationLog[] {
  const out: MedicationLog[] = [];
  for (const log of logs) {
    if (medicationKey(log.name) !== fromKey) continue;
    const filled = fill && log.amount === null;
    const next: MedicationLog = {
      ...log,
      name: to,
      amount: filled ? fill.amount : log.amount,
      unit: filled ? fill.unit : log.unit,
    };
    if (next.name !== log.name || next.amount !== log.amount || next.unit !== log.unit) out.push(next);
  }
  return out;
}

/**
 * The settings map after `fromKey` becomes `toKey`. When both have a limit (or
 * a supply or panel) the target's wins, because it is the one the person kept, and the
 * source's would otherwise overwrite a figure they typed for the medication
 * they are keeping.
 */
export function renamedSettings(
  map: MedicationSettingsMap,
  fromKey: string,
  toKey: string,
): MedicationSettingsMap {
  if (fromKey === toKey || !map[fromKey]) return map;
  const source = map[fromKey];
  const target = map[toKey];
  const next = { ...map };
  delete next[fromKey];
  next[toKey] = {
    limit: target?.limit ?? source.limit,
    supply: target?.supply ?? source.supply,
    // The supplement panel follows the same rule as the limit and supply.
    ...((target?.nutrition ?? source.nutrition) ? { nutrition: target?.nutrition ?? source.nutrition } : {}),
  };
  return next;
}

/**
 * A key list (archived, milestone-dismissed) after `fromKey` becomes `toKey`.
 * `carry` says whether the target should end up on the list: for archived it is
 * only when the target had no live doses of its own to keep it off.
 */
export function renamedKeys(
  keys: readonly string[],
  fromKey: string,
  toKey: string,
  carry: boolean,
): string[] {
  if (fromKey === toKey || !keys.includes(fromKey)) return keys.slice();
  const next = keys.filter(k => k !== fromKey);
  if (carry && !next.includes(toKey)) next.push(toKey);
  return next;
}

/** Chain steps with `fromKey` renamed, or the same array when none named it. */
export function renamedChain(
  items: readonly ChainItem[] | undefined,
  fromKey: string,
  to: string,
): ChainItem[] | undefined {
  if (!items?.some(i => i.medicationName && medicationKey(i.medicationName) === fromKey)) {
    return items as ChainItem[] | undefined;
  }
  return items.map(i =>
    i.medicationName && medicationKey(i.medicationName) === fromKey ? { ...i, medicationName: to } : i);
}

/** The task with its medication renamed, or null when it names no such medication. */
export function renamedTask(task: Task, fromKey: string, to: string): Task | null {
  const named = !!task.medicationName && medicationKey(task.medicationName) === fromKey;
  const chainItems = renamedChain(task.chainItems, fromKey, to);
  if (!named && chainItems === task.chainItems) return null;
  return {
    ...task,
    medicationName: named ? to : task.medicationName,
    chainItems: chainItems ?? task.chainItems,
  };
}

/** The template item with its medication renamed, or null when it names none. */
export function renamedTemplateItem(item: TemplateItem, fromKey: string, to: string): TemplateItem | null {
  const named = !!item.medicationName && medicationKey(item.medicationName) === fromKey;
  const chainItems = renamedChain(item.chainItems, fromKey, to);
  if (!named && chainItems === item.chainItems) return null;
  return {
    ...item,
    medicationName: named ? to : item.medicationName,
    chainItems: chainItems ?? item.chainItems,
  };
}

/**
 * A name that carries its strength ("Ibuprofen 200", "Sertraline 25 mcg"),
 * split into the medicine and the strength.
 *
 * Only a suggestion for the rename sheet to prefill, which the person sees and
 * confirms: `medicationKey` still never folds names on its own. The unit is
 * null unless the name states one, since a unit nobody typed is a number
 * nobody entered.
 */
export function splitStrength(name: string): { stem: string; amount: number; unit: string | null } | null {
  const match = name.trim().match(/^(.*?\S)[\s-]+(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)?$/i);
  if (!match) return null;
  const amount = Number(match[2]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { stem: match[1].trim(), amount, unit: match[3] ? match[3].toLowerCase() : null };
}
