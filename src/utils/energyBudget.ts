/**
 * A daily calorie figure worked out from a body and a rate of change: what it
 * takes to hold a weight, and what it takes to move one.
 *
 * **The app still has no opinion about what anybody should eat.** That rule
 * (`nutritionTargets.ts` states it at length, `docs/arch/health-data.md` argues
 * it) survives here because of *where the inputs come from*: every one of them
 * — height, year of birth, sex, how active the day is, the rate to change at —
 * is typed in by the person, and the output is arithmetic over their own
 * numbers. What this module must never become is a source of defaults. Nothing
 * here fills a field in, nothing is stored until it is accepted, and a profile
 * missing any part of itself produces null rather than a guess.
 *
 * **It proposes; it never writes.** `WeightGoalSheet` shows the figure with its
 * own arithmetic printed beside it and a button that copies it into the
 * `calorieKcal` entry of `nutritionTargets`. Nothing calls `setNutritionTarget`
 * on this module's behalf, nothing re-applies it when a weight changes, and the
 * copied number is thereafter an ordinary target the person can edit or clear
 * in `NutritionTargetsSheet` like any other. The alternative — a target that
 * silently tracks a formula — is a figure nobody chose driving the food log,
 * which is the exact thing `nutritionTargets`' own note rules out.
 *
 * **The estimate is an estimate and the copy has to say so.** Mifflin-St Jeor
 * is a population regression: it is the standard predictive equation and it is
 * still wrong by a few hundred calories for plenty of individual people, before
 * the activity multiplier adds its own much larger uncertainty. Nothing here
 * may be rendered as a fact about this particular body.
 */

import { unitToKg, type WeightUnit } from './weightLog';

/**
 * Which form of the Mifflin-St Jeor constant applies.
 *
 * The equation has exactly two published forms and they differ only by their
 * final constant, so this is a straight input to a formula rather than a
 * statement about anybody. It is asked for in those terms in the sheet ("Used
 * only for the calorie estimate"), it is optional, and leaving it out costs the
 * estimate rather than anything else in the app: nothing else reads this field.
 */
export type BodySex = 'female' | 'male';

/** How much of the day is spent moving, as the multiplier's own ladder. */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive';

/**
 * The Harris-Benedict activity multipliers, which Mifflin-St Jeor is
 * conventionally used with. Widely published, unchanged since 1919, and listed
 * here rather than computed because there is nothing to derive them from.
 */
export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

/** How each level is named and explained where it is picked. */
export const ACTIVITY_LABEL: Record<ActivityLevel, { label: string; hint: string }> = {
  sedentary: { label: 'Sedentary', hint: 'Desk work, little or no exercise' },
  light: { label: 'Light', hint: 'Exercise 1 to 3 days a week' },
  moderate: { label: 'Moderate', hint: 'Exercise 3 to 5 days a week' },
  active: { label: 'Active', hint: 'Exercise 6 or 7 days a week' },
  veryActive: { label: 'Very active', hint: 'Hard exercise daily, or a physical job' },
};

export const ACTIVITY_LEVELS: readonly ActivityLevel[] = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'veryActive',
];

/** The parts of a body the calorie equation needs. Every one is optional. */
export interface BodyProfile {
  /** Height in centimetres, or null if it hasn't been given. */
  heightCm: number | null;
  /** Year of birth, or null. A year rather than a date — see `ageFromBirthYear`. */
  birthYear: number | null;
  sex: BodySex | null;
  /**
   * Not nullable, because unlike the other three there is no sense in which
   * this is unknown — everybody has a level, and a person who never opens the
   * picker is telling you nothing about which. It defaults to `sedentary`, the
   * bottom of the ladder, so the estimate a profile produces before anybody
   * touches this is the *smallest* one the other fields support rather than a
   * middle guess dressed up as a measurement.
   */
  activity: ActivityLevel;
}

export const EMPTY_BODY_PROFILE: BodyProfile = {
  heightCm: null,
  birthYear: null,
  sex: null,
  activity: 'sedentary',
};

/** Bounds on a height, in centimetres — an absurdity check, like `MAX_WEIGHT_KG`. */
export const MIN_HEIGHT_CM = 50;
export const MAX_HEIGHT_CM = 260;

/** The oldest birth year this will read, which is well past any living person. */
export const MIN_BIRTH_YEAR = 1900;

/**
 * Whole years old at `today`, from a year of birth alone.
 *
 * A year rather than a full date of birth on purpose: the equation's age term
 * is five calories per year, so a birthday's worth of precision is worth about
 * five calories, and a date of birth is markedly more identifying than a year
 * to store for it. Null when the year is missing or not one a living person
 * could have.
 */
export function ageFromBirthYear(birthYear: number | null, today: Date): number | null {
  if (birthYear === null || !Number.isFinite(birthYear)) return null;
  const age = today.getFullYear() - Math.round(birthYear);
  if (age < 0 || age > 130) return null;
  return age;
}

/**
 * Resting energy, in calories a day, by Mifflin-St Jeor (1990).
 *
 *   10 × kg + 6.25 × cm − 5 × years + 5      (male)
 *   10 × kg + 6.25 × cm − 5 × years − 161    (female)
 *
 * Null when any input is missing, which is the whole of this module's
 * discipline about defaults: an absent height is absent, not average.
 */
export function restingEnergyKcal(
  profile: BodyProfile,
  weightKg: number,
  today: Date,
): number | null {
  const age = ageFromBirthYear(profile.birthYear, today);
  const { heightCm, sex } = profile;
  if (age === null || sex === null) return null;
  if (heightCm === null || heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM) return null;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return base + (sex === 'male' ? 5 : -161);
}

/** Resting energy times the activity multiplier: what holds the weight steady. */
export function maintenanceKcal(
  profile: BodyProfile,
  weightKg: number,
  today: Date,
): number | null {
  const resting = restingEnergyKcal(profile, weightKg, today);
  if (resting === null) return null;
  return resting * ACTIVITY_FACTOR[profile.activity];
}

/**
 * Calories in a pound of body mass, by the conventional figure.
 *
 * 3,500 is a rule of thumb rather than a measurement, and it is the one every
 * weight tracker uses, which matters more here than a more defensible number
 * would: somebody who has seen "a pound a week is 500 calories a day" expects
 * this app to agree with it, and an app that quietly used 3,650 would look
 * broken rather than careful. Expressed per pound rather than per kilogram
 * because that is the form the rule of thumb is stated in, and converting once
 * here beats a kilogram constant that fails to reproduce the familiar 500.
 */
export const KCAL_PER_LB = 3500;

/**
 * The daily surplus or shortfall a rate of change implies, signed the way the
 * rate is: negative to lose.
 */
export function dailyAdjustmentKcal(rateKgPerWeek: number): number {
  const poundsPerWeek = rateKgPerWeek / unitToKg(1, 'lb');
  return (poundsPerWeek * KCAL_PER_LB) / 7;
}

/**
 * The lowest intake this will *propose*, by sex, in calories a day.
 *
 * **This is the one judgement in the module and it is deliberately narrow.**
 * The figures (1,200 and 1,500) are the long-standing floors below which
 * unsupervised dieting is not considered safe, and they are here because the
 * arithmetic above will cheerfully produce 700 for a small person aiming at two
 * pounds a week — a number this app must not put in front of somebody with its
 * own name on it. What the floor does *not* do is stop anybody: it bounds the
 * proposal, the sheet says plainly that it did, and the target field itself is
 * `NutritionTargetsSheet`'s ordinary stepper, which goes to 500 and is nobody's
 * business but the user's. Suggesting and permitting are different acts, and
 * the app is only answerable for the first.
 *
 * A profile with no sex given gets the lower floor, so the clamp is the
 * weakest one the known facts support rather than the strongest.
 */
export const MIN_PROPOSED_KCAL: Record<BodySex, number> = { female: 1200, male: 1500 };

export function proposalFloorKcal(sex: BodySex | null): number {
  return sex === null ? MIN_PROPOSED_KCAL.female : MIN_PROPOSED_KCAL[sex];
}

/** A proposed daily calorie figure, with every step of it kept separate. */
export interface CalorieBudget {
  /** What the profile says holds this weight steady, rounded. */
  maintenanceKcal: number;
  /** The daily shortfall or surplus the rate asks for, signed and rounded. */
  adjustmentKcal: number;
  /** Maintenance plus adjustment, before the floor. */
  arithmeticKcal: number;
  /** What to actually propose: `arithmeticKcal`, raised to the floor. */
  proposedKcal: number;
  /** True when the floor raised it, so the caller can say so. */
  raisedToFloor: boolean;
  floorKcal: number;
}

/**
 * The whole calculation, or null if the profile can't support one.
 *
 * Every intermediate figure is returned rather than just the answer, because
 * the sheet prints the arithmetic: a number arrived at from somebody's height
 * and age should be checkable by them, and "2,000 calories" on its own is
 * exactly the unexplained recommendation this module is built not to make.
 *
 * Rounded to whole calories at the end rather than at each step, so the parts
 * printed beside the total add up to it.
 */
export function calorieBudget(
  profile: BodyProfile,
  weightKg: number,
  rateKgPerWeek: number,
  today: Date,
): CalorieBudget | null {
  const maintenance = maintenanceKcal(profile, weightKg, today);
  if (maintenance === null) return null;
  const adjustment = dailyAdjustmentKcal(rateKgPerWeek);
  const arithmetic = Math.round(maintenance + adjustment);
  const floor = proposalFloorKcal(profile.sex);
  return {
    maintenanceKcal: Math.round(maintenance),
    adjustmentKcal: Math.round(adjustment),
    arithmeticKcal: arithmetic,
    proposedKcal: Math.max(floor, arithmetic),
    raisedToFloor: arithmetic < floor,
    floorKcal: floor,
  };
}

// ==== height, in the unit the weight is already in ====

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

/** Feet and whole inches from centimetres, for a profile shown in pounds. */
export function cmToFeetInches(heightCm: number): { feet: number; inches: number } {
  const totalInches = Math.round(heightCm / CM_PER_INCH);
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH;
}

/**
 * A height for display, in the system the weight unit implies.
 *
 * Follows `weightUnit` rather than carrying a setting of its own: somebody
 * weighing in pounds thinks in feet and inches, and a second picker to say so
 * would be a question with only one sensible answer. Same call
 * `RATE_RANGE` makes about its two tables.
 */
export function formatHeight(heightCm: number, unit: WeightUnit): string {
  if (unit === 'kg') return `${Math.round(heightCm)} cm`;
  const { feet, inches } = cmToFeetInches(heightCm);
  return `${feet}′ ${inches}″`;
}

/**
 * Read a typed height back to centimetres, or null if it isn't one.
 *
 * Accepts a plain number of centimetres, and for pounds also `5'10`, `5 10`,
 * `5ft 10in` and `5'10"` — the forms somebody actually types. Refuses rather
 * than clamps, for the reason `parseWeightInput` gives about the same choice.
 */
export function parseHeightInput(text: string, unit: WeightUnit): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  if (unit === 'kg') {
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    return inRange(Number(trimmed));
  }

  const feetInches = trimmed.match(/^(\d+)\s*(?:'|′|ft\.?|feet)?\s*(\d+(?:\.\d+)?)?\s*(?:"|″|in\.?|inches)?$/i);
  if (!feetInches) return null;
  const feet = Number(feetInches[1]);
  // A bare number in pounds mode is feet: "5" is five feet, and there is no
  // reading of it as five inches or five centimetres worth guessing at.
  const inches = feetInches[2] === undefined ? 0 : Number(feetInches[2]);
  if (inches >= INCHES_PER_FOOT) return null;
  return inRange(feetInchesToCm(feet, inches));
}

function inRange(heightCm: number): number | null {
  if (!Number.isFinite(heightCm) || heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM) return null;
  return heightCm;
}

// ==== storage ====

/**
 * A stored profile, with anything unreadable dropped rather than the whole blob
 * refused — losing a height because a sex was written by a future build is a
 * worse trade than the partial estimate the survivors still support.
 */
export function parseBodyProfile(raw: string | null | undefined): BodyProfile {
  if (!raw) return { ...EMPTY_BODY_PROFILE };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_BODY_PROFILE };
    const heightCm =
      typeof parsed.heightCm === 'number' ? inRange(parsed.heightCm) : null;
    const birthYear =
      typeof parsed.birthYear === 'number' &&
      Number.isFinite(parsed.birthYear) &&
      parsed.birthYear >= MIN_BIRTH_YEAR
        ? Math.round(parsed.birthYear)
        : null;
    const sex = parsed.sex === 'female' || parsed.sex === 'male' ? parsed.sex : null;
    const activity =
      typeof parsed.activity === 'string' && parsed.activity in ACTIVITY_FACTOR
        ? (parsed.activity as ActivityLevel)
        : 'sedentary';
    return { heightCm, birthYear, sex, activity };
  } catch {
    return { ...EMPTY_BODY_PROFILE };
  }
}

export function serializeBodyProfile(profile: BodyProfile): string {
  return JSON.stringify(profile);
}

/** Whether the profile carries everything `calorieBudget` needs. */
export function isProfileComplete(profile: BodyProfile): boolean {
  return profile.heightCm !== null && profile.birthYear !== null && profile.sex !== null;
}
