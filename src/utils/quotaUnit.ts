/**
 * The optional unit on a daily target — what the count is counting.
 *
 * A quota task's meter reads "5/12", which is only legible if the title spells
 * the unit out ("Drink 8oz glasses of water"). The unit lets the title stay
 * "Drink water" and puts the noun where the number is: "5/12 8oz glasses".
 * Optional, so every existing target keeps reading exactly as it did.
 *
 * Deliberately not pluralised in code. The unit is always read against the
 * target, and a target is >= 2 by definition (isQuotaTask), so the form the
 * user typed is the form that has to work — while naive English pluralisation
 * turns "glass" into "glasss" and "8oz" into "8ozs". The editor asks for the
 * plural in its placeholder instead, which costs nothing and can't be wrong.
 */

/**
 * Long enough for "8oz glasses" and "pages read", short enough that the chip on
 * a task row stays a chip. Enforced at the input (maxLength) and again here, so
 * a value that arrives from a draft or an older row can't blow the row out.
 */
export const MAX_TARGET_UNIT_LENGTH = 16;

/** Trim and collapse a typed unit; anything empty becomes null (= no unit). */
export function normalizeTargetUnit(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TARGET_UNIT_LENGTH).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** The meter's reading: "5/12", or "5/12 glasses" once a unit is set. */
export function formatQuotaProgress(
  logged: number,
  target: number,
  unit: string | null | undefined,
): string {
  const u = normalizeTargetUnit(unit);
  return u ? `${logged}/${target} ${u}` : `${logged}/${target}`;
}

/**
 * The target on its own, for the editor row's value and the quick-add summary.
 * Without a unit it keeps the bare "12×" it has always shown — the × is what
 * makes a naked number read as "twelve times" rather than as a quantity.
 */
export function formatQuotaTarget(target: number, unit: string | null | undefined): string {
  const u = normalizeTargetUnit(unit);
  return u ? `${target} ${u}` : `${target}×`;
}
