import { formatDose, isCountedUnit } from './medicationLog';
import type { AmountCap, UsualDose } from './medicationSettings';

/**
 * What a task that logs a dose will record, in the words the editor shows under
 * its dose fields.
 *
 * **A task with no amount of its own records the medication's default usual
 * amount** (`DoseInput.useUsualDose`, read at completion), so "Log a dose" on
 * Vitamin D does what the medication's page already says it takes without the
 * amount being typed twice. This is the one function that says so in words, so
 * the editor's preview and the store's rule are read off the same inputs:
 * `usual` is `defaultUsualDose(prefs)` and `strength` is `prefs.strength`.
 *
 * An amount typed without a unit is not an amount (`resolveMedicationAmount`
 * drops it), so it falls back to the usual one like an empty field does and
 * `needsUnit` says why, rather than the typed number vanishing without a word.
 */
export interface TaskDosePreview {
  /** The sentence for the preview line. */
  text: string;
  /** The dose it names ("125 mcg", "1 capsule (125 mcg)"), or null when it records no amount. */
  dose: string | null;
  /** A number was typed with no unit chosen, so it will not be recorded. */
  needsUnit: boolean;
}

export function describeTaskDose(input: {
  name: string;
  amount: string;
  unit: string | null;
  usual: UsualDose | null;
  strength: AmountCap | null;
}): TaskDosePreview {
  const typed = input.amount.trim();
  const parsed = Number(typed);
  const typedUsable = typed !== '' && Number.isFinite(parsed) && parsed > 0;
  const own = typedUsable && input.unit ? { amount: parsed, unit: input.unit } : null;
  const needsUnit = typedUsable && !input.unit;
  const chosen = own ?? input.usual;
  const dose = chosen
    ? formatDose({
        amount: chosen.amount,
        unit: chosen.unit,
        strength: isCountedUnit(chosen.unit) ? input.strength : null,
      })
    : null;
  const name = input.name.trim();
  const text = dose
    ? `Each time you complete this task, it logs ${dose} of ${name}.`
    : `Each time you complete this task, it logs a dose of ${name} with no amount.`;
  return { text, dose, needsUnit };
}
