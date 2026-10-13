/**
 * Which day facts the mood sheet may offer as pre-picked context tags
 * (`moodDayContext.ts` works out the tags). Its own small module so the
 * settings store can hold the type without importing the calendar and People
 * code the offers read.
 *
 * **All four are off until the person turns them on**, since seeding a tag the
 * person did not ask for makes the log less their own record. Each is rare
 * enough to mean something: a tag that applied every weekday would give the
 * contrast card nothing to compare.
 */
export interface MoodContextSources {
  /** "Holiday" on a public holiday, "Day off" on one of your own days off. */
  dayOff: boolean;
  /** "Social event" on a day with a calendar event linked to somebody. */
  social: boolean;
  /** "Birthday" on a day someone in People has one. */
  birthday: boolean;
  /** "Exercised" once today's exercise reaches `EXERCISED_MINUTES`. */
  exercise: boolean;
}

export const NO_MOOD_CONTEXT_SOURCES: MoodContextSources = {
  dayOff: false, social: false, birthday: false, exercise: false,
};

export const MOOD_CONTEXT_SOURCE_KEYS = ['dayOff', 'social', 'birthday', 'exercise'] as const;

/**
 * Apple's default Exercise ring goal. A fixed figure rather than a setting:
 * "exercised" is the tag's whole meaning, and a stepper for what counts would
 * be a second place to disagree with the ring.
 */
export const EXERCISED_MINUTES = 30;

/** Tolerant of a missing or malformed stored value: anything unreadable is off. */
export function parseMoodContextSources(raw: string | null | undefined): MoodContextSources {
  if (!raw) return { ...NO_MOOD_CONTEXT_SOURCES };
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    const out = { ...NO_MOOD_CONTEXT_SOURCES };
    if (value && typeof value === 'object') {
      for (const key of MOOD_CONTEXT_SOURCE_KEYS) out[key] = value[key] === true;
    }
    return out;
  } catch {
    return { ...NO_MOOD_CONTEXT_SOURCES };
  }
}

