import type { MedicationLog, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { DOSE_UNITS, STRENGTH_UNITS, amountInUnit, medicationKey } from './medicationLog';
import { parseSchedule, type MedicationSchedule } from './medicationSchedule';

/**
 * What you have told the app about one medication: a limit on how often you
 * take it, and how many you have left.
 *
 * A medication still has no row of its own (see `medicationVocabulary`; the
 * added-by-name list is just names), so
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

/** A total of one unit, such as 1200 mg. */
export interface AmountCap {
  amount: number;
  /** One of `DOSE_UNITS`. */
  unit: string;
}

export interface MedicationLimit {
  /** Fewest hours between two doses, or null for no spacing rule. */
  minHours: number | null;
  /** Most doses in any 24 hours, or null for no cap. */
  maxPer24h: number | null;
  /**
   * Most of one unit in any 24 hours, or null/absent for no cap. For a label
   * that states a total ("no more than 1200 mg a day") rather than a number of
   * doses, which is what makes it hold across strengths. Only doses recorded in
   * this unit are added up, plus counted doses whose stamped strength is in it
   * (`amountInUnit`): a dose with no amount, or in another unit with no strength
   * to multiply by, is counted as unmeasured and never converted or guessed (the
   * rule `supplyUseOf` states for a supply). Optional so a map written before it reads unchanged.
   */
  maxAmount24h?: AmountCap | null;
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
  /** The stated figures, in each key's own unit. At least one, unless `others` is given. */
  amounts: Partial<Record<NutrientKey, number>>;
  /**
   * Ingredients the label lists that aren't one of the nutrients (an herb, an
   * amino acid, an omega-3). They are shown with each dose and never reach the
   * food log, which has nowhere to put them. Absent when none were entered.
   */
  others?: PanelIngredient[];
}

/** An ingredient outside the nutrient list, as the label prints it. */
export interface PanelIngredient {
  /** As the label names it ("Ashwagandha root/leaf extract"). */
  name: string;
  /** Positive, per serving. */
  amount: number;
  /** One of `INGREDIENT_UNITS`. */
  unit: string;
}

/** The units a label prints an ingredient in. */
export const INGREDIENT_UNITS: readonly string[] = ['mg', 'mcg', 'g', 'IU'];
/** More than a label prints, so a runaway list can't fill the settings row. */
export const MAX_PANEL_INGREDIENTS = 12;

/** An amount you usually take: prefills a dose, and the first one is what the round button records before any dose exists. */
export interface UsualDose {
  amount: number;
  /** One of `DOSE_UNITS`. */
  unit: string;
}

export interface MedicationPrefs {
  limit: MedicationLimit | null;
  supply: MedicationSupply | null;
  /**
   * Whether you take it as needed (true) or on a schedule (false). Null or
   * absent means decide from the doses, which is the only answer a medication
   * had before this existed: any dose recorded as needed makes it as needed.
   */
  asNeeded?: boolean | null;
  /**
   * The days it is taken on, or absent when none were set (`medicationSchedule.ts`).
   * Only meaningful for a medicine taken on a schedule: an as-needed one has no
   * days, and keeps whatever was set so switching back finds it.
   */
  schedule?: MedicationSchedule | null;
  /**
   * The amounts you usually take, at most `MAX_USUAL_DOSES`. The first is the
   * default; the rest are quick picks in the dose sheet. Absent or empty when
   * none were entered.
   */
  usualDoses?: UsualDose[];
  /** What a serving contains, or null when none was entered. Optional so a map written before it reads unchanged. */
  nutrition?: SupplementPanel | null;
  /**
   * What one capsule, tablet, puff or drop contains ("125 mcg"), or absent when
   * none was entered. Stamped onto each counted dose as it is recorded
   * (`MedicationLog.strength`), so changing it affects the doses after it and
   * leaves the ones before alone. Typed by the person, never looked up.
   */
  strength?: AmountCap | null;
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
  const maxAmount24h = parseAmount(r.maxAmount24h, 999999);
  if (minHours === null && maxPer24h === null && maxAmount24h === null) return null;
  const since = typeof r.since === 'string' && !Number.isNaN(Date.parse(r.since)) ? r.since : null;
  if (!since) return null;
  return {
    minHours,
    maxPer24h: maxPer24h === null ? null : Math.round(maxPer24h),
    notify: r.notify === true,
    since,
    ...(maxAmount24h ? { maxAmount24h } : {}),
  };
}

/** How many usual amounts one medication keeps. */
export const MAX_USUAL_DOSES = 6;

function parseAmount(raw: unknown, max: number): UsualDose | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const amount = positiveOrNull(r.amount, max);
  const unit = typeof r.unit === 'string' && DOSE_UNITS.some(u => u.value === r.unit) ? r.unit : null;
  return amount !== null && unit ? { amount, unit } : null;
}

/**
 * The usual amounts, one per amount and unit. Reads the single `usualDose` an
 * earlier build wrote as a list of one, so nothing typed is lost.
 */
function parseUsualDoses(list: unknown, legacy: unknown): UsualDose[] {
  const raw = Array.isArray(list) ? list : legacy ? [legacy] : [];
  const out: UsualDose[] = [];
  for (const entry of raw) {
    const dose = parseAmount(entry, 99999);
    if (dose && !out.some(d => d.amount === dose.amount && d.unit === dose.unit)) out.push(dose);
    if (out.length >= MAX_USUAL_DOSES) break;
  }
  return out;
}

/** A strength read back from storage: a positive amount in one of the measured units. */
export function parseStrength(raw: unknown): AmountCap | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const amount = positiveOrNull(r.amount, 999999);
  const unit = typeof r.unit === 'string' && STRENGTH_UNITS.includes(r.unit) ? r.unit : null;
  return amount !== null && unit ? { amount, unit } : null;
}

/** The amount a new dose starts from: the first usual amount, or null. */
export function defaultUsualDose(prefs: Pick<MedicationPrefs, 'usualDoses'> | undefined): UsualDose | null {
  return prefs?.usualDoses?.[0] ?? null;
}

/** Whether an entry says anything; an entry that doesn't is dropped rather than stored empty. */
function hasPrefs(p: MedicationPrefs): boolean {
  return !!(p.limit || p.supply || p.nutrition || p.strength || p.schedule || p.usualDoses?.length || typeof p.asNeeded === 'boolean');
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
  const given = (r.amounts && typeof r.amounts === 'object' && !Array.isArray(r.amounts) ? r.amounts : {}) as Record<string, unknown>;
  const amounts: Partial<Record<NutrientKey, number>> = {};
  // Unknown keys are dropped: this build has no unit for a nutrient it doesn't
  // know, the rule `readAmounts` in `foodNutrition.ts` states. A negative or
  // non-finite figure is a broken row, not a small one.
  for (const key of NUTRIENT_KEYS) {
    const v = given[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) amounts[key] = v;
  }
  const others = parsePanelIngredients(r.others);
  if (Object.keys(amounts).length === 0 && others.length === 0) return null;
  return { servingAmount, servingUnit, amounts, ...(others.length > 0 ? { others } : {}) };
}

function parsePanelIngredients(raw: unknown): PanelIngredient[] {
  if (!Array.isArray(raw)) return [];
  const out: PanelIngredient[] = [];
  for (const item of raw) {
    if (out.length >= MAX_PANEL_INGREDIENTS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const amount = positiveOrNull(r.amount, 1_000_000);
    const unit = typeof r.unit === 'string' && INGREDIENT_UNITS.includes(r.unit) ? r.unit : null;
    if (name && amount !== null && unit) out.push({ name, amount, unit });
  }
  return out;
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
    const usualDoses = parseUsualDoses(v.usualDoses, v.usualDose);
    const strength = parseStrength(v.strength);
    const schedule = parseSchedule(v.schedule);
    const prefs: MedicationPrefs = {
      limit: parseLimit(v.limit),
      supply: parseSupply(v.supply),
      ...(nutrition ? { nutrition } : {}),
      ...(typeof v.asNeeded === 'boolean' ? { asNeeded: v.asNeeded } : {}),
      ...(usualDoses.length > 0 ? { usualDoses } : {}),
      ...(strength ? { strength } : {}),
      ...(schedule ? { schedule } : {}),
    };
    if (hasPrefs(prefs)) out[key] = prefs;
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
  if (!hasPrefs(prefs)) delete next[key];
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

/** "1,200 mg": an amount cap as the label would print it. */
export function formatCapAmount(cap: AmountCap): string {
  return `${cap.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cap.unit}`;
}

/** "At least 6 hours apart, at most 4 in 24 hours", or null with no limit. */
export function describeLimit(limit: MedicationLimit | null): string | null {
  if (!limit) return null;
  const parts: string[] = [];
  if (limit.minHours !== null) parts.push(`at least ${formatHours(limit.minHours)} apart`);
  if (limit.maxPer24h !== null) parts.push(`at most ${limit.maxPer24h} in 24 hours`);
  if (limit.maxAmount24h) parts.push(`at most ${formatCapAmount(limit.maxAmount24h)} in 24 hours`);
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
  reason: 'spacing' | 'max' | 'amount' | null;
  /** The amount cap, when the limit has one. */
  maxAmount24h: AmountCap | null;
  /** Added up from the doses in that cap's unit in the last 24 hours; null without an amount cap. */
  amountInLast24h: number | null;
  /** Doses in the last 24 hours that state no amount in that unit, so are not in the sum. Zero without an amount cap. */
  unmeasuredInLast24h: number;
}

function dosesOf(logs: readonly MedicationLog[], key: string): number[] {
  return logs
    .filter(l => medicationKey(l.name) === key)
    .map(l => Date.parse(l.takenAt))
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b);
}

/** A dose's time and what it contributes to a cap in `unit`, or null amount when it states none in that unit. */
interface TimedAmount { t: number; amount: number | null }

function amountsOf(logs: readonly MedicationLog[], key: string, unit: string): TimedAmount[] {
  return logs
    .filter(l => medicationKey(l.name) === key)
    .map(l => ({
      t: Date.parse(l.takenAt),
      amount: amountInUnit(l, unit),
    }))
    .filter(d => Number.isFinite(d.t))
    .sort((a, b) => a.t - b.t);
}

/**
 * The earliest moment a cap on a total has room again. `need` is the dose being
 * considered (0 asks only whether there is any room). Walks the window oldest
 * first, dropping each dose as it ages out, so the answer is the time of the
 * dose whose leaving makes `sum + need` fit. 0 when it already fits.
 */
function amountOkAt(window: readonly TimedAmount[], cap: number, need: number): number {
  const fits = (sum: number) => (need > 0 ? sum + need <= cap : sum < cap);
  let sum = window.reduce((s, d) => s + (d.amount ?? 0), 0);
  if (fits(sum)) return 0;
  let okAt = 0;
  for (const d of window) {
    if (d.amount === null) continue;
    sum -= d.amount;
    okAt = d.t + DAY_MS;
    if (fits(sum)) break;
  }
  return okAt;
}

/**
 * Where a medication stands against its limit right now.
 *
 * Wall-clock time on purpose, not the logical day: "6 hours apart" is about
 * the body, which keeps no `dayResetTime`. A dose recorded in the future (a
 * clock change, a typo'd backdate) counts from where it says it was, which
 * can only make the answer more cautious.
 *
 * `planned` is the dose about to be taken. Only an amount cap reads it: a
 * count cap asks whether one more fits, and an amount cap asks whether *this*
 * much does, which depends on the dose. A planned dose in another unit, or
 * with no amount, is not measured against the cap.
 */
export function limitStatus(
  logs: readonly MedicationLog[],
  name: string,
  limit: MedicationLimit | null,
  now: Date,
  planned: Pick<MedicationLog, 'amount' | 'unit' | 'strength'> | null = null,
): LimitStatus {
  const key = medicationKey(name);
  const times = dosesOf(logs, key).filter(t => t <= now.getTime() + HOUR_MS);
  const last = times.length > 0 ? times[times.length - 1] : null;
  const windowStart = now.getTime() - DAY_MS;
  const recent = times.filter(t => t > windowStart);
  const cap = limit?.maxAmount24h ?? null;
  const measured = cap
    ? amountsOf(logs, key, cap.unit).filter(d => d.t <= now.getTime() + HOUR_MS && d.t > windowStart)
    : [];
  const status: LimitStatus = {
    inLast24h: recent.length,
    maxPer24h: limit?.maxPer24h ?? null,
    lastTakenAt: last === null ? null : new Date(last).toISOString(),
    nextOkAt: null,
    reason: null,
    maxAmount24h: cap,
    amountInLast24h: cap ? Math.round(measured.reduce((s, d) => s + (d.amount ?? 0), 0) * 100) / 100 : null,
    unmeasuredInLast24h: cap ? measured.filter(d => d.amount === null).length : 0,
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
  let amountOk = 0;
  if (cap) {
    const need = planned ? amountInUnit(planned, cap.unit) ?? 0 : 0;
    amountOk = amountOkAt(measured, cap.amount, need);
  }
  const okAt = Math.max(spacingOk, maxOk, amountOk);
  if (okAt > now.getTime()) {
    status.nextOkAt = new Date(okAt);
    status.reason = okAt === amountOk && amountOk > Math.max(spacingOk, maxOk) ? 'amount'
      : maxOk >= spacingOk ? 'max' : 'spacing';
  }
  return status;
}

export interface LimitBreach {
  log: MedicationLog;
  reason: 'spacing' | 'max' | 'amount';
}

/**
 * The doses that went past the limit you set, oldest first.
 *
 * Only doses from `limit.since` on are judged (see the header). A dose that
 * broke more than one cap is reported once: spacing first, since that is the
 * one a reader can see from the two times alone, then the count, then the total.
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
      if (inWindow > limit.maxPer24h) { breaches.push({ log: ordered[i], reason: 'max' }); continue; }
    }
    if (limit.maxAmount24h) {
      // The total of this unit in the 24 hours up to and including this dose.
      const { amount: capAmount, unit } = limit.maxAmount24h;
      let total = 0;
      for (let j = i; j >= 0 && t - Date.parse(ordered[j].takenAt) < DAY_MS; j--) {
        total += amountInUnit(ordered[j], unit) ?? 0;
      }
      if (total > capAmount) breaches.push({ log: ordered[i], reason: 'amount' });
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
