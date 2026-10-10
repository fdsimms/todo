import type { MedicationLog, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { DOSE_UNITS, medicationKey } from './medicationLog';

/**
 * What you have told the app about one medication: a limit on how often you
 * take it, and how many you have left.
 *
 * A medication still has no row of its own (see `medicationVocabulary`), so
 * these hang off its `medicationKey` in one synced setting, the shape
 * `medication_archived` already takes. Nothing here is a prescription and
 * nothing here is guessed: every number was typed by the person, and every
 * read off it says so ("Limit you set").
 *
 * ## The limit
 *
 * Two independent caps, either or both: a minimum gap between doses, and a
 * maximum in any **24 hours**. Rolling rather than per logical day, because
 * that is how a label states it ("no more than 4 doses in 24 hours") and a
 * per-day cap would let somebody take four at 11pm and four more after
 * `dayResetTime`.
 *
 * `since` is when the limit was set. A history judged against a limit typed
 * after it happened would report "taken too soon" for doses nobody had a rule
 * for yet, in the summary a clinician reads, so `limitBreaches` only judges
 * doses from that moment on and the summary says when that was.
 *
 * ## The supply
 *
 * **The count is derived, never decremented.** What is stored is the count
 * you typed and the moment you typed it; what is left is that minus what the
 * doses recorded since have used. The same call `rewards.ts` makes for the
 * coin balance and for the same three reasons: two devices logging a dose each
 * can't race one stored number (a synced setting is last-write-wins, so one
 * dose would vanish), deleting or undoing a dose gives its tablets back
 * without any code saying so, and editing a dose's amount re-counts itself.
 *
 * Only doses with no `taskId` are counted. A scheduled dose rides its task,
 * and a task already has its own supply (`supply.ts`, decremented by the
 * completion); counting that dose here as well would spend it twice.
 */

/** The settings key the whole map is stored under (synced, health-scoped). */
export const MEDICATION_SETTINGS_KEY = 'medication_settings';

export interface MedicationLimit {
  /** Fewest hours between two doses, or null for no spacing rule. */
  minHours: number | null;
  /** Most doses in any 24 hours, or null for no cap. */
  maxPer24h: number | null;
  /** Send a notification when the next dose is allowed again. */
  notify: boolean;
  /** ISO instant the limit was set; doses before it are never judged. */
  since: string;
}

export interface MedicationSupply {
  /** How many you had at `since`, as typed. */
  count: number;
  /** What `count` counts: one of the countable `DOSE_UNITS`, or 'dose'. */
  unit: string;
  /** How many a refill adds, to prefill the refill prompt. */
  refillCount: number | null;
  /** Offer a refill once what's left is at or below this. At least 1. */
  reorderAt: number;
  /** ISO instant `count` was true at. Doses taken after it are spent from it. */
  since: string;
  /**
   * The remaining count a refill offer was turned down at, or null. The offer
   * stays quiet while what's left is at or below it, the same decline stamp
   * `Task.supplyDeclinedAtCount` keeps, and a refill clears it.
   */
  declinedAt: number | null;
}

/**
 * What one serving of a supplement contains, as its label prints it.
 *
 * **Typed by the person, once, from the bottle.** Nothing here is looked up or
 * guessed, and an absent key is unknown rather than zero (the rule
 * `FoodNutrition.amounts` states), so a multivitamin that doesn't list
 * chromium adds no chromium to the day.
 *
 * `servingAmount` of `servingUnit` is the serving the figures are *for*: "2
 * tablets" when the label says "serving size 2 tablets", so a dose of 1 tablet
 * adds half of what is stated. `supplementServings` (`supplementDose.ts`) holds
 * the rule for a dose in any other unit, which is the supply's rule too: a
 * dose recorded in this unit counts that many, any other dose counts one.
 *
 * Changing the panel affects the doses recorded after it. Each dose writes its
 * own food log entry as a snapshot, the same call a food entry makes, so
 * correcting a label doesn't rewrite what a past dose added to a past day.
 */
export interface SupplementPanel {
  /** How much of `servingUnit` the figures are for. Positive. */
  servingAmount: number;
  /** One of `SUPPLY_UNITS` other than 'dose': the unit a dose is recorded in. */
  servingUnit: string;
  /** The stated figures, in each key's own unit. At least one. */
  amounts: Partial<Record<NutrientKey, number>>;
}

export interface MedicationPrefs {
  limit: MedicationLimit | null;
  supply: MedicationSupply | null;
  /** What a serving contains, or null when none was entered. Optional so a map written before it reads unchanged. */
  nutrition?: SupplementPanel | null;
}

export type MedicationSettingsMap = Record<string, MedicationPrefs>;

/** The units a supply can be counted in: the ones you can count out of a box. */
export const SUPPLY_UNITS: readonly string[] = [
  'dose',
  ...DOSE_UNITS.filter(u => u.plural !== null && u.value !== 'unit').map(u => u.value),
];

const EMPTY: MedicationPrefs = { limit: null, supply: null };

function positiveOrNull(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, max);
}

function parseLimit(raw: unknown): MedicationLimit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const minHours = positiveOrNull(r.minHours, 72);
  const maxPer24h = positiveOrNull(r.maxPer24h, 99);
  if (minHours === null && maxPer24h === null) return null;
  const since = typeof r.since === 'string' && !Number.isNaN(Date.parse(r.since)) ? r.since : null;
  if (!since) return null;
  return {
    minHours,
    maxPer24h: maxPer24h === null ? null : Math.round(maxPer24h),
    notify: r.notify === true,
    since,
  };
}

function parseSupply(raw: unknown): MedicationSupply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.count !== 'number' || !Number.isFinite(r.count) || r.count < 0) return null;
  const since = typeof r.since === 'string' && !Number.isNaN(Date.parse(r.since)) ? r.since : null;
  if (!since) return null;
  const unit = typeof r.unit === 'string' && SUPPLY_UNITS.includes(r.unit) ? r.unit : 'dose';
  const reorderAt = positiveOrNull(r.reorderAt, 999);
  const declinedAt = typeof r.declinedAt === 'number' && Number.isFinite(r.declinedAt) ? r.declinedAt : null;
  return {
    count: Math.min(Math.round(r.count), 9999),
    unit,
    refillCount: positiveOrNull(r.refillCount, 9999),
    reorderAt: reorderAt === null ? 1 : Math.round(reorderAt),
    since,
    declinedAt,
  };
}

/**
 * The units a panel can be per: the ones a supplement's serving is printed in.
 * Narrower than the dose units on purpose. A panel "per 5 mg" would be a
 * statement about a strength rather than a serving, and a puff or a unit has no
 * label panel to copy.
 */
export const PANEL_UNITS: readonly string[] = ['tablet', 'capsule', 'drop', 'spray', 'ml', 'g'];

function parseSupplementPanel(raw: unknown): SupplementPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const servingAmount = positiveOrNull(r.servingAmount, 999);
  if (servingAmount === null) return null;
  const servingUnit = typeof r.servingUnit === 'string' && PANEL_UNITS.includes(r.servingUnit) ? r.servingUnit : null;
  if (!servingUnit) return null;
  if (!r.amounts || typeof r.amounts !== 'object' || Array.isArray(r.amounts)) return null;
  const given = r.amounts as Record<string, unknown>;
  const amounts: Partial<Record<NutrientKey, number>> = {};
  // Unknown keys are dropped: this build has no unit for a nutrient it doesn't
  // know, the rule `readAmounts` in `foodNutrition.ts` states. A negative or
  // non-finite figure is a broken row, not a small one.
  for (const key of NUTRIENT_KEYS) {
    const v = given[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) amounts[key] = v;
  }
  if (Object.keys(amounts).length === 0) return null;
  return { servingAmount, servingUnit, amounts };
}

/** Read the stored map back, dropping anything that isn't a well-formed entry. */
export function parseMedicationSettings(raw: string | null): MedicationSettingsMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: MedicationSettingsMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const nutrition = parseSupplementPanel(v.nutrition);
    // Only when present, so a map with no panel reads exactly as it did before
    // the field existed.
    const prefs: MedicationPrefs = {
      limit: parseLimit(v.limit),
      supply: parseSupply(v.supply),
      ...(nutrition ? { nutrition } : {}),
    };
    if (prefs.limit || prefs.supply || prefs.nutrition) out[key] = prefs;
  }
  return out;
}

/** One medication's settings, or empty ones. Looked up by name or key. */
export function prefsFor(map: MedicationSettingsMap, name: string): MedicationPrefs {
  return map[medicationKey(name)] ?? EMPTY;
}

/** The map with one medication's settings replaced; an empty entry is dropped. */
export function withPrefs(
  map: MedicationSettingsMap,
  name: string,
  prefs: MedicationPrefs,
): MedicationSettingsMap {
  const key = medicationKey(name);
  const next = { ...map };
  if (!key) return next;
  if (!prefs.limit && !prefs.supply && !prefs.nutrition) delete next[key];
  else next[key] = prefs;
  return next;
}

// ==== Limits ====

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "6 hours", "1.5 hours", "1 hour". */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
}

/** "At least 6 hours apart, at most 4 in 24 hours", or null with no limit. */
export function describeLimit(limit: MedicationLimit | null): string | null {
  if (!limit) return null;
  const parts: string[] = [];
  if (limit.minHours !== null) parts.push(`at least ${formatHours(limit.minHours)} apart`);
  if (limit.maxPer24h !== null) parts.push(`at most ${limit.maxPer24h} in 24 hours`);
  if (parts.length === 0) return null;
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface LimitStatus {
  /** Doses of this medication in the 24 hours ending now. */
  inLast24h: number;
  maxPer24h: number | null;
  /** The most recent dose, if any. */
  lastTakenAt: string | null;
  /** When the next dose is allowed, or null when it's allowed now. */
  nextOkAt: Date | null;
  /** Which cap is holding it back, when one is. */
  reason: 'spacing' | 'max' | null;
}

function dosesOf(logs: readonly MedicationLog[], key: string): number[] {
  return logs
    .filter(l => medicationKey(l.name) === key)
    .map(l => Date.parse(l.takenAt))
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b);
}

/**
 * Where a medication stands against its limit right now.
 *
 * Wall-clock time on purpose, not the logical day: "6 hours apart" is about
 * the body, which keeps no `dayResetTime`. A dose recorded in the future (a
 * clock change, a typo'd backdate) counts from where it says it was, which
 * can only make the answer more cautious.
 */
export function limitStatus(
  logs: readonly MedicationLog[],
  name: string,
  limit: MedicationLimit | null,
  now: Date,
): LimitStatus {
  const key = medicationKey(name);
  const times = dosesOf(logs, key).filter(t => t <= now.getTime() + HOUR_MS);
  const last = times.length > 0 ? times[times.length - 1] : null;
  const windowStart = now.getTime() - DAY_MS;
  const recent = times.filter(t => t > windowStart);
  const status: LimitStatus = {
    inLast24h: recent.length,
    maxPer24h: limit?.maxPer24h ?? null,
    lastTakenAt: last === null ? null : new Date(last).toISOString(),
    nextOkAt: null,
    reason: null,
  };
  if (!limit) return status;

  let spacingOk = 0;
  if (limit.minHours !== null && last !== null) spacingOk = last + limit.minHours * HOUR_MS;
  let maxOk = 0;
  if (limit.maxPer24h !== null && recent.length >= limit.maxPer24h) {
    // The dose that has to age out of the window before one more fits: with
    // N in the window and a cap of M, the (N - M + 1)th oldest.
    maxOk = recent[recent.length - limit.maxPer24h] + DAY_MS;
  }
  const okAt = Math.max(spacingOk, maxOk);
  if (okAt > now.getTime()) {
    status.nextOkAt = new Date(okAt);
    status.reason = maxOk >= spacingOk ? 'max' : 'spacing';
  }
  return status;
}

export interface LimitBreach {
  log: MedicationLog;
  reason: 'spacing' | 'max';
}

/**
 * The doses that went past the limit you set, oldest first.
 *
 * Only doses from `limit.since` on are judged (see the header). A dose that
 * broke both caps is reported once, as spacing, since that is the one a reader
 * can see from the two times alone.
 */
export function limitBreaches(
  logs: readonly MedicationLog[],
  name: string,
  limit: MedicationLimit | null,
): LimitBreach[] {
  if (!limit) return [];
  const key = medicationKey(name);
  const since = Date.parse(limit.since);
  const ordered = logs
    .filter(l => medicationKey(l.name) === key)
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const breaches: LimitBreach[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const t = Date.parse(ordered[i].takenAt);
    if (t < since) continue;
    if (limit.minHours !== null && i > 0) {
      const prev = Date.parse(ordered[i - 1].takenAt);
      if (t - prev < limit.minHours * HOUR_MS) {
        breaches.push({ log: ordered[i], reason: 'spacing' });
        continue;
      }
    }
    if (limit.maxPer24h !== null) {
      let inWindow = 0;
      for (let j = i; j >= 0 && t - Date.parse(ordered[j].takenAt) < DAY_MS; j--) inWindow++;
      if (inWindow > limit.maxPer24h) breaches.push({ log: ordered[i], reason: 'max' });
    }
  }
  return breaches;
}

// ==== Supply ====

/**
 * How much of a supply one dose uses.
 *
 * A dose stated in the supply's own unit ("2 tablets" from a box of tablets)
 * uses that many. Anything else, including a dose with no amount or one in
 * milligrams, uses one: the app can't know how many 200 mg tablets make
 * 400 mg, and guessing would be the invented number this log refuses.
 */
export function supplyUseOf(log: MedicationLog, supply: MedicationSupply): number {
  if (supply.unit !== 'dose' && log.unit === supply.unit && log.amount !== null && log.amount > 0) {
    return log.amount;
  }
  return 1;
}

/** What's left: the count you typed, less what doses recorded since have used. */
export function supplyRemaining(
  logs: readonly MedicationLog[],
  name: string,
  supply: MedicationSupply | null,
): number | null {
  if (!supply) return null;
  const key = medicationKey(name);
  const since = Date.parse(supply.since);
  let used = 0;
  for (const log of logs) {
    if (log.taskId !== null || medicationKey(log.name) !== key) continue;
    if (Date.parse(log.takenAt) < since) continue;
    used += supplyUseOf(log, supply);
  }
  return Math.max(0, Math.round((supply.count - used) * 100) / 100);
}

/** "12 tablets left", "1 dose left", "None left". */
export function describeSupplyLeft(remaining: number, unit: string): string {
  if (remaining <= 0) return 'None left';
  const spec = DOSE_UNITS.find(u => u.value === unit);
  const plural = unit === 'dose' ? 'doses' : spec?.plural ?? unit;
  return `${remaining} ${remaining === 1 ? unit : plural} left`;
}

/**
 * Whether to offer a refill: at or below the threshold, and not already
 * declined at this count or lower.
 */
export function wantsRefill(remaining: number | null, supply: MedicationSupply | null): boolean {
  if (remaining === null || !supply) return false;
  if (remaining > supply.reorderAt) return false;
  if (supply.declinedAt !== null && remaining >= supply.declinedAt) return false;
  return true;
}

/**
 * The supply after a refill: what was left plus what arrived, counted from now.
 * Re-anchoring is what keeps the count derived (see the header).
 */
export function refilledSupply(
  supply: MedicationSupply,
  remaining: number,
  added: number,
  now: Date,
): MedicationSupply {
  return {
    ...supply,
    count: Math.max(0, Math.round(remaining + Math.max(0, added))),
    since: now.toISOString(),
    declinedAt: null,
  };
}

/** Whether a dose just recorded crossed a supply onto its refill threshold. */
export function crossedRefill(
  before: number | null,
  after: number | null,
  supply: MedicationSupply | null,
): boolean {
  if (before === null || after === null || !supply) return false;
  return before > supply.reorderAt && wantsRefill(after, supply);
}
