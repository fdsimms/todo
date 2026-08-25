import type { StepTimer } from '../types';

/**
 * Cooking step timers — the duration a step already names, and the countdown
 * offered against it.
 *
 * A method sentence is where the number actually lives: "cook, stirring
 * occasionally, until mostly golden, 7 to 9 minutes" is a recipe telling you
 * exactly how long to set a timer for, and every cook in the world reads that,
 * picks up a phone, and types it into a different app. This reads it out of the
 * step and offers it.
 *
 * **It parses to offer, never to act.** Nothing here starts a countdown, and
 * nothing writes to the recipe: a duration found in a step becomes a chip under
 * the step text that a person taps. That is the whole reason the rules below
 * can afford to be dumb about ambiguity — a false positive costs a chip nobody
 * presses, where a false positive in something that *started* a timer would
 * cost a burnt dinner and a distrusted feature. The same call `stepsFromNotes`
 * makes about splitting a blob, and the same one `splitAlternativeNames` makes
 * about "chicken or vegetable stock".
 *
 * The countdown math at the bottom is the banked-segment design
 * `src/utils/timer.ts` and `src/utils/recipeTimer.ts` already use, for the same
 * reason: nothing is counted down in state, so a phone backgrounded or killed
 * mid-cook comes back with the right answer.
 */

/** One duration found in a step's text, and everything the chip offering it needs. */
export interface StepDuration {
  /** Character offsets of the whole phrase in the step text. */
  start: number;
  end: number;
  /**
   * What a timer started from this counts down. **The low end of a range**:
   * "7 to 9 minutes" rings at 7, because the alarm is a prompt to go and look
   * at the pan rather than a claim that the food is done, and the early end is
   * the only one of the two that can't already be too late.
   */
  seconds: number;
  /** The high end when the phrase gave a range, else null. Display only. */
  maxSeconds: number | null;
  /** The phrase exactly as written ("7 to 9 minutes"). */
  text: string;
}

// ==== reading a number out of a sentence ====

// Recipes write small numbers as words about as often as digits — the demo
// seed's own steak step says "Sear three minutes a side" — so a parser that
// only read digits would be inert on a good share of a real recipe box.
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90,
  half: 0.5, quarter: 0.25,
};

const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

const VULGAR: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const VULGAR_CLASS = '½⅓⅔¼¾⅛⅜⅝⅞';
const TENS_WORDS = 'twenty|thirty|forty|fifty';
const ONES_WORDS = 'one|two|three|four|five|six|seven|eight|nine';
const SIMPLE_WORDS = Object.keys(NUMBER_WORDS).join('|');

// Longest-first throughout, so "1 1/2" doesn't match as a bare "1" and
// "twenty-five" doesn't match as "twenty".
const NUMBER = `(?:${TENS_WORDS})[-\\s](?:${ONES_WORDS})`
  + `|\\d+\\s+\\d+/\\d+`
  + `|\\d+\\s*[${VULGAR_CLASS}]`
  + `|\\d+/\\d+`
  + `|[${VULGAR_CLASS}]`
  + `|\\d+(?:\\.\\d+)?`
  + `|${SIMPLE_WORDS}`;

/** Seconds per unit, and the ordering a compound ("1 hour 20 minutes") is checked against. */
const UNIT_SECONDS: Record<string, number> = { second: 1, minute: 60, hour: 3600 };

// Deliberately no bare "m"/"h"/"s". parseTaskInput can afford those because
// its "for …" anchor says a duration is coming; a method sentence has no such
// anchor, and "6 m" of anything in a recipe is a length far more often than a
// time.
const UNIT = 'seconds?|secs?|minutes?|mins?|hours?|hrs?';

function unitKey(raw: string): keyof typeof UNIT_SECONDS {
  const u = raw.toLowerCase();
  if (u.startsWith('s')) return 'second';
  if (u.startsWith('h')) return 'hour';
  return 'minute';
}

/** The numeric value of one NUMBER match, or null for anything that doesn't resolve. */
function numberValue(raw: string): number | null {
  const text = raw.trim().toLowerCase();

  const compound = /^(twenty|thirty|forty|fifty)[-\s](one|two|three|four|five|six|seven|eight|nine)$/.exec(text);
  if (compound) return TENS[compound[1]] + ONES[compound[2]];

  if (text in NUMBER_WORDS) return NUMBER_WORDS[text];

  // "1 1/2", "1½" — a whole part and a fraction, in either notation.
  const mixed = /^(\d+)\s*(?:(\d+)\/(\d+)|([½⅓⅔¼¾⅛⅜⅝⅞]))$/.exec(text);
  if (mixed) {
    const whole = Number(mixed[1]);
    const frac = mixed[4] ? VULGAR[mixed[4]] : Number(mixed[2]) / Number(mixed[3]);
    return Number.isFinite(frac) ? whole + frac : null;
  }

  if (text in VULGAR) return VULGAR[text];

  const fraction = /^(\d+)\/(\d+)$/.exec(text);
  if (fraction) {
    const value = Number(fraction[1]) / Number(fraction[2]);
    return Number.isFinite(value) ? value : null;
  }

  const plain = Number(text);
  return Number.isFinite(plain) ? plain : null;
}

// ==== finding the durations ====

/**
 * Shortest a phrase can be and still be offered as a timer. "Add a second
 * layer" and "give it one second" both parse honestly as one second, and
 * neither is a timer anybody wants — a floor is a cheaper answer than teaching
 * the parser what "a second batch" means, and there is no real five-second
 * cooking step for it to cost.
 */
export const MIN_STEP_TIMER_SECONDS = 5;

/**
 * Longest. A twelve-hour brine or an overnight rest is a real duration and a
 * terrible kitchen timer: it wants a task with a reminder on tomorrow's date,
 * which the app already has. The same fat-finger guard `parseTaskInput` puts on
 * "for 9999 hours", one notch tighter because a step is prose rather than a
 * command someone typed on purpose.
 */
export const MAX_STEP_TIMER_SECONDS = 12 * 3600;

const RANGE_JOINER = /^\s*(?:to|or|through|[-–—])\s*$/i;

const DURATION_PATTERN = new RegExp(
  // `\\b` alone can't open a match on a bare vulgar fraction ("½ hour"): the
  // character isn't a word character, so there's no boundary between it and
  // the space in front of it. The lookahead is the second way in, and stays a
  // plain alternation rather than a lookbehind so the pattern holds on every
  // engine this ships to, Hermes included.
  `(?:\\b|(?=[${VULGAR_CLASS}]))(${NUMBER})`             // 1: the number, or a range's low end
  + `(?:\\s*(?:to|or|through|[-–—])\\s*(${NUMBER}))?` // 2: a range's high end
  + `\\s*(?:an?\\s+)?`                              // "half an hour"
  + `(${UNIT})\\b`                                  // 3: the unit
  + `(\\s+and\\s+a\\s+half\\b)?`                    // 4: "an hour and a half"
  + `(?:\\s*(?:and\\s+)?(${NUMBER})\\s*(${UNIT})\\b)?`, // 5,6: "1 hour 20 minutes"
  'gi'
);

interface RawMatch extends StepDuration {}

function rawMatches(text: string): RawMatch[] {
  const out: RawMatch[] = [];
  DURATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DURATION_PATTERN.exec(text)) !== null) {
    const [whole, lowRaw, highRaw, unitRaw, andAHalf, tailRaw, tailUnitRaw] = match;
    const unit = UNIT_SECONDS[unitKey(unitRaw)];
    const low = numberValue(lowRaw);
    if (low === null) continue;

    let seconds = low * unit;
    let maxSeconds: number | null = null;

    if (highRaw !== undefined) {
      const high = numberValue(highRaw);
      if (high !== null) {
        // "9 to 7 minutes" is a typo, not an inverted range: take the pair as
        // written and let the smaller of the two be the one that rings.
        seconds = Math.min(low, high) * unit;
        maxSeconds = Math.max(low, high) * unit;
      }
    }

    if (andAHalf !== undefined) {
      seconds *= 1.5;
      if (maxSeconds !== null) maxSeconds *= 1.5;
    }

    // A compound only merges downwards: "1 hour 20 minutes" is one duration,
    // where "20 minutes, 1 hour later" is two things the sentence said.
    if (tailRaw !== undefined && tailUnitRaw !== undefined && maxSeconds === null) {
      const tailUnit = UNIT_SECONDS[unitKey(tailUnitRaw)];
      const tail = numberValue(tailRaw);
      if (tail !== null && tailUnit < unit) seconds += tail * tailUnit;
    }

    out.push({
      start: match.index,
      end: match.index + whole.length,
      seconds: Math.round(seconds),
      maxSeconds: maxSeconds === null ? null : Math.round(maxSeconds),
      text: whole.trim(),
    });
  }

  return out;
}

/**
 * Fold "30 seconds to 1 minute" back into one range.
 *
 * The pattern above reads a range as one number, one unit — which is how
 * ranges are nearly always written ("7 to 9 minutes") — so a range that spells
 * out both units comes back as two separate matches sitting either side of a
 * bare "to". Two chips for one instruction is the wrong offer, and joining
 * them here keeps the pattern from having to grow a second unit slot.
 */
function mergeAdjacentRanges(matches: RawMatch[], text: string): RawMatch[] {
  const out: RawMatch[] = [];
  for (const match of matches) {
    const previous = out[out.length - 1];
    if (previous && previous.maxSeconds === null && RANGE_JOINER.test(text.slice(previous.end, match.start))) {
      out[out.length - 1] = {
        start: previous.start,
        end: match.end,
        seconds: Math.min(previous.seconds, match.seconds),
        maxSeconds: Math.max(previous.seconds, match.seconds),
        text: text.slice(previous.start, match.end).trim(),
      };
      continue;
    }
    out.push(match);
  }
  return out;
}

/**
 * Every duration a step names, in the order it names them.
 *
 * Deduplicated by length rather than by phrase: "3 minutes per side, then 3
 * minutes more" is one timer offered twice, and two identical chips read as a
 * parser fault whichever one you press. Restarting a finished timer is the
 * answer to a duration used twice, and it's a button on the timer itself.
 */
export function parseStepDurations(text: string): StepDuration[] {
  const merged = mergeAdjacentRanges(rawMatches(text), text);
  const seen = new Set<number>();
  const out: StepDuration[] = [];
  for (const duration of merged) {
    if (duration.seconds < MIN_STEP_TIMER_SECONDS) continue;
    if (duration.seconds > MAX_STEP_TIMER_SECONDS) continue;
    if (seen.has(duration.seconds)) continue;
    seen.add(duration.seconds);
    out.push(duration);
  }
  return out;
}

/**
 * "45s", "7m", "1h", "1h 20m" — a step timer's length on a chip.
 *
 * Its own formatter rather than `formatDuration`, which takes whole minutes and
 * so has no way to say "30 seconds": a step timer counts in seconds because
 * plenty of steps do ("stir for 30 seconds until fragrant"). The compact style
 * is `formatDuration`'s, so a step chip and a cook-time estimate read alike.
 */
export function formatStepDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "7 to 9 minutes, ringing at 7m" — what the chip's caption says about a range. */
export function describeStepDuration(duration: StepDuration): string {
  if (duration.maxSeconds === null) return formatStepDuration(duration.seconds);
  return `${formatStepDuration(duration.seconds)} to ${formatStepDuration(duration.maxSeconds)}`;
}

// ==== the countdown ====

/**
 * Total seconds elapsed on a step timer: banked segments, plus the one running
 * now. Same shape as `bankedElapsedSeconds` in `recipeTimer.ts`, including the
 * clamp that stops a clock moved backwards (a timezone change, a manual set)
 * from rewinding the countdown.
 */
export function stepTimerElapsed(timer: StepTimer, now: number = Date.now()): number {
  const banked = Math.max(0, timer.elapsedSeconds ?? 0);
  if (timer.startedAt === null) return banked;
  return banked + Math.max(0, (now - new Date(timer.startedAt).getTime()) / 1000);
}

/** Seconds left. Goes negative once time is up; `isStepTimerReady` needs the sign. */
export function stepTimerRemaining(timer: StepTimer, now: number = Date.now()): number {
  return timer.durationSeconds - stepTimerElapsed(timer, now);
}

/** How far through, 0–1. */
export function stepTimerProgress(timer: StepTimer, now: number = Date.now()): number {
  if (timer.durationSeconds <= 0) return 1;
  return Math.min(1, Math.max(0, stepTimerElapsed(timer, now) / timer.durationSeconds));
}

/** Is a run segment in flight right now? */
export function isStepTimerRunning(timer: StepTimer): boolean {
  return timer.startedAt !== null;
}

/** Has it rung? True whether or not anyone was there to hear it. */
export function isStepTimerReady(timer: StepTimer, now: number = Date.now()): boolean {
  return stepTimerRemaining(timer, now) <= 0;
}

/**
 * When a running timer will ring, as a wall-clock instant — what the alarm is
 * scheduled against and what the Live Activity counts down to. Null for a
 * paused timer, which has no end time until it's resumed.
 */
export function stepTimerEndsAt(timer: StepTimer, now: number = Date.now()): Date | null {
  if (!isStepTimerRunning(timer)) return null;
  return new Date(now + Math.max(0, stepTimerRemaining(timer, now)) * 1000);
}

/** What "+1 min" adds. A minute is the unit every stove clock and oven mitt agrees on. */
export const STEP_TIMER_NUDGE_SECONDS = 60;

/**
 * The countdown as the row draws it: `m:ss`, or `h:mm:ss` past an hour,
 * clamped at zero. `formatStopwatch`'s output, and deliberately the same
 * function — a step timer counting down beside a cook timer counting up must
 * not be the one place in the app where a clock is punctuated differently.
 */
export { formatStopwatch as formatStepTimerClock } from './effort';

// ==== how many, and in what order ====

/**
 * Running and paused timers first, in the order they were started; rung ones
 * after, most recently rung first.
 *
 * A timer that has gone off is the one thing on the stack that wants dealing
 * with, so it could argue for the top — but the stack is what a cook's thumb
 * aims at with their hands full, and a row that jumps to the front the moment
 * it rings moves Pause out from under a finger already on its way down. It
 * sorts to the *bottom* instead, where the Dismiss it wants is nearest the
 * footer's own controls, and says it has rung by turning accent.
 */
export function sortStepTimers(timers: StepTimer[], now: number = Date.now()): StepTimer[] {
  const ready = (timer: StepTimer) => (isStepTimerReady(timer, now) ? 1 : 0);
  return [...timers].sort((a, b) => {
    const byState = ready(a) - ready(b);
    if (byState !== 0) return byState;
    const order = a.createdAt.localeCompare(b.createdAt);
    return ready(a) === 1 ? -order : order;
  });
}

/**
 * The durations offered under a step: the one written on the step if anyone set
 * one, else every duration its text names.
 *
 * An explicit `timerSeconds` **replaces** the parse rather than joining it. The
 * field exists for the step whose sentence the parse gets wrong, so leaving the
 * wrong chip on screen next to the right one would defeat the point of having
 * set it; and a step that says "until the edges look dry" has nothing to offer
 * alongside it anyway.
 */
export function stepDurationOffers(step: { text: string; timerSeconds?: number | null }): StepDuration[] {
  const explicit = step.timerSeconds;
  if (explicit != null && explicit >= MIN_STEP_TIMER_SECONDS && explicit <= MAX_STEP_TIMER_SECONDS) {
    return [{ start: 0, end: 0, seconds: Math.round(explicit), maxSeconds: null, text: '' }];
  }
  return parseStepDurations(step.text);
}

// ==== persistence ====

/**
 * How long after it rings a timer is kept.
 *
 * A rung timer is worth keeping: it's how someone who left the kitchen finds
 * out the rice went off twenty minutes ago, and the app can't know whether the
 * alarm was heard. It is not worth keeping for ever — a stack that still holds
 * Tuesday's tempeh on Thursday is a stack nobody reads — and a cooking is
 * unambiguously over four hours after its last timer ran out.
 */
export const STEP_TIMER_KEEP_AFTER_READY_MS = 4 * 3600 * 1000;

/**
 * Drop the timers a cooking has finished with. Run on hydrate rather than on a
 * schedule: nothing has to happen at the moment one goes stale, and a pass at
 * the point the list is next read costs nothing.
 */
export function pruneStaleStepTimers(timers: StepTimer[], now: number = Date.now()): StepTimer[] {
  return timers.filter(timer => {
    // A paused timer is a decision someone made and hasn't come back to; it
    // has no end time to be stale relative to, so it waits.
    if (!isStepTimerRunning(timer)) return true;
    const remaining = stepTimerRemaining(timer, now);
    return remaining * -1000 < STEP_TIMER_KEEP_AFTER_READY_MS;
  });
}

/**
 * Read the persisted stack back, dropping anything that doesn't parse.
 *
 * Defensive per row rather than all-or-nothing: this is JSON in a settings
 * value, and one malformed entry must not lose the timer that's actually
 * counting down the thing on the stove.
 */
export function parseStepTimerQueue(raw: string | null): StepTimer[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: StepTimer[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Partial<StepTimer>;
    if (typeof t.id !== 'string' || typeof t.recipeId !== 'string') continue;
    if (typeof t.durationSeconds !== 'number' || !Number.isFinite(t.durationSeconds)) continue;
    out.push({
      id: t.id,
      recipeId: t.recipeId,
      stepId: typeof t.stepId === 'string' ? t.stepId : '',
      recipeName: typeof t.recipeName === 'string' ? t.recipeName : '',
      stepLabel: typeof t.stepLabel === 'string' ? t.stepLabel : '',
      durationSeconds: Math.max(0, Math.round(t.durationSeconds)),
      startedAt: typeof t.startedAt === 'string' ? t.startedAt : null,
      elapsedSeconds: typeof t.elapsedSeconds === 'number' && Number.isFinite(t.elapsedSeconds)
        ? Math.max(0, t.elapsedSeconds)
        : 0,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString(),
    });
  }
  return out;
}

export function serializeStepTimerQueue(timers: StepTimer[]): string {
  return JSON.stringify(timers);
}
