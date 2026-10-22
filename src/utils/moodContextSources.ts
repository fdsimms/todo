import { EVENT_MATCH_MAX_LENGTH, EVENT_RULE_MAX_MATCHES } from './eventTasks';
import { generateId } from './id';

/**
 * Which day facts the mood sheet may offer as pre-picked context tags
 * (`moodDayContext.ts` works out the tags). Its own small module so the
 * settings store can hold the type without importing the calendar and People
 * code the offers read.
 *
 * **All of them are off until the person turns them on**, since seeding a tag the
 * person did not ask for makes the log less their own record. Each is rare
 * enough to mean something: a tag that applied every weekday would give the
 * contrast card nothing to compare.
 */
export interface MoodContextSources {
  /** "Holiday" on a public holiday, "Day off" on one of your own days off. */
  dayOff: boolean;
  /** "Social event" on a day with a calendar event linked to somebody. */
  social: boolean;
  /** "Worked out" once today's exercise reaches `EXERCISED_MINUTES`. */
  exercise: boolean;
  /** "Worked out" on a day a workout was finished in the app. */
  workout: boolean;
  /** "Short night" when the sleep that ended that day is under the Short night threshold. */
  shortNight: boolean;
  /** "Went outside" once today's Time in Daylight reaches `OUTSIDE_MINUTES`. */
  outside: boolean;
  /** "Rain" on a day with at least `RAIN_TAG_MM` of rain that was seen to fall. */
  rain: boolean;
}

export const NO_MOOD_CONTEXT_SOURCES: MoodContextSources = {
  dayOff: false, social: false, exercise: false, workout: false, shortNight: false, outside: false, rain: false,
};

export const MOOD_CONTEXT_SOURCE_KEYS = ['dayOff', 'social', 'exercise', 'workout', 'shortNight', 'outside', 'rain'] as const;

/**
 * Apple's default Exercise ring goal. A fixed figure rather than a setting:
 * "exercised" is the tag's whole meaning, and a stepper for what counts would
 * be a second place to disagree with the ring.
 */
export const EXERCISED_MINUTES = 30;

/**
 * Minutes of Time in Daylight that read as having gone outside. Fixed for the
 * same reason as `EXERCISED_MINUTES`: the tag's meaning is the point, and a
 * stepper for it is a figure to second-guess.
 */
export const OUTSIDE_MINUTES = 30;

/**
 * Millimetres of rain that make a day read as rainy: about the smallest of the
 * "skip if it rained" presets, so a passing shower counts and a trace in the
 * gauge doesn't. 2.5 rather than 2 so it reads as a round 0.1 in too.
 */
export const RAIN_TAG_MM = 2.5;

/**
 * Tolerant of a missing or malformed stored value: anything unreadable is off.
 * Only the keys above are read, so a source since removed (a Birthday switch
 * once lived here) is dropped from an older stored value rather than kept.
 */
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


/**
 * "A calendar event titled *therapy* that day picks the tag Therapy." The
 * person supplies both the keyword and the tag, so the app is only noticing
 * the word is there, never deciding what the day meant: the line
 * `eventTasks.ts` already draws for event rules, matched by the same
 * `ruleMatchesTitle`. `title` is the tag, which is what lets `RuleListSheet`
 * edit these as it edits every other rule list.
 */
export interface MoodEventTag {
  id: string;
  /** The context tag to pick. */
  title: string;
  enabled: boolean;
  /** Keywords; any one in an event's title is enough. */
  matches: string[];
}

export const MOOD_EVENT_TAG_MAX_LENGTH = 40;

/**
 * The stored rule list. A rule missing its tag or every keyword is dropped
 * rather than repaired, the call `parseEventRules` makes, since it could pick
 * nothing (no tag) or would match every event (no keyword).
 */
export function parseMoodEventTags(raw: string | null | undefined): MoodEventTag[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: MoodEventTag[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const r = entry as Partial<MoodEventTag>;
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, MOOD_EVENT_TAG_MAX_LENGTH) : '';
    const matches: string[] = [];
    for (const m of Array.isArray(r.matches) ? r.matches : []) {
      if (typeof m !== 'string') continue;
      const cue = m.trim().slice(0, EVENT_MATCH_MAX_LENGTH);
      if (cue && !matches.some(existing => existing.toLowerCase() === cue.toLowerCase())) matches.push(cue);
      if (matches.length >= EVENT_RULE_MAX_MATCHES) break;
    }
    if (!title || matches.length === 0) continue;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : generateId(),
      title,
      enabled: r.enabled !== false,
      matches,
    });
  }
  return out;
}
