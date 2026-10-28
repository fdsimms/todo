import type { RecipeStepTimer, RestTimer, StepTimer } from '../types';
import { formatStopwatch } from './effort';

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
  /**
   * True when the phrase is "every 30 minutes" rather than "30 minutes": the
   * step is asking for something to happen on a cycle, so the offer is a
   * repeating timer. `start` then includes the word "every". Left off rather
   * than set to false, so every other offer reads as it always did.
   */
  every?: true;
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

// The word that turns a duration into a cycle. Only "every": "each" and "once
// per" are real wordings too, and an offer that is missed costs a tap on the
// plain timer, where one that is wrong would start repeating a timer that was
// meant to ring once.
const EVERY_LEAD = /\bevery\s+$/i;

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
    let length = whole.length;
    if (tailRaw !== undefined && tailUnitRaw !== undefined) {
      const tailUnit = UNIT_SECONDS[unitKey(tailUnitRaw)];
      const tail = numberValue(tailRaw);
      if (maxSeconds === null && tail !== null && tailUnit < unit) {
        seconds += tail * tailUnit;
      } else {
        // Not merged ("5 minutes and 10 minutes", "25-30 minutes and 5 minutes
        // more"), so the second duration is its own: this match ends before
        // it, and the scan resumes there so the second one is offered too
        // rather than swallowed into the first chip's label.
        const tailAt = whole.lastIndexOf(tailRaw, whole.length - tailUnitRaw.length);
        length = whole.slice(0, tailAt).replace(/\s*(?:and\s*)?$/i, '').length;
        DURATION_PATTERN.lastIndex = match.index + length;
      }
    }

    const lead = EVERY_LEAD.exec(text.slice(0, match.index));
    const start = lead ? lead.index : match.index;
    const end = match.index + length;
    out.push({
      start,
      end,
      seconds: Math.round(seconds),
      maxSeconds: maxSeconds === null ? null : Math.round(maxSeconds),
      text: text.slice(start, end).trim(),
      ...(lead ? { every: true as const } : {}),
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
        ...(previous.every ? { every: true as const } : {}),
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
 *
 * "Every 30 minutes" is not the same offer as "30 minutes" and doesn't dedupe
 * against it: "simmer 30 minutes, then stir every 30 minutes" is a timer that
 * rings once and one that repeats.
 */
export function parseStepDurations(text: string): StepDuration[] {
  const merged = mergeAdjacentRanges(rawMatches(text), text);
  const seen = new Set<string>();
  const out: StepDuration[] = [];
  for (const duration of merged) {
    if (duration.seconds < MIN_STEP_TIMER_SECONDS) continue;
    if (duration.seconds > MAX_STEP_TIMER_SECONDS) continue;
    const key = `${duration.seconds}${duration.every ? ':every' : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
  // Under an hour the seconds are kept rather than rounded away: a step that
  // says "90 seconds" runs for 90, and a chip reading "2m" misstates it.
  if (total < 3600) {
    const secs = total % 60;
    const mins = Math.floor(total / 60);
    return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
  }
  const minutes = Math.floor(total / 60);
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

// ==== a timer that repeats ====

/** The most times a repeating timer can be told to ring: a fat-finger guard, not a design limit. */
export const MAX_REPEAT_ROUNDS = 99;

/** What a repeating timer expects when the step names no other time to divide the interval into. */
export const DEFAULT_REPEAT_ROUNDS = 3;

/**
 * How many rings past the target are armed up front. A pot that needs one more
 * cycle is the ordinary case ("6 of 5"), and the phone can't be relied on to
 * be opened between two rings, so the alarms for the overshoot are already
 * waiting. Past that the count keeps going and the alarms are topped up
 * whenever the app next sees the timer (`useStepTimers`).
 */
export const REPEAT_RINGS_PAST_TARGET = 3;

/**
 * The most alarms one repeating timer holds at once. The alarm backends name
 * them by slot (`stepTimerAlarmUuid`), so this is also how many a cancel has to
 * name.
 */
export const MAX_REPEAT_ALARMS = 12;

/** A step timer that rings every `durationSeconds` until dismissed, with how many rings the recipe expects. */
export function isRepeatingTimer(timer: StepTimer): timer is RecipeStepTimer & { repeatTarget: number } {
  return timer.kind === 'recipe' && typeof timer.repeatTarget === 'number' && timer.repeatTarget >= 1;
}

/**
 * How many times a repeating timer has gone off. **Derived from the clock**,
 * like every other number a step timer shows: whole intervals elapsed, so a
 * phone locked through three of them reads three when it comes back, and a
 * pause stops the count with the clock. 0 for a timer that rings once.
 */
export function stepTimerRings(timer: StepTimer, now: number = Date.now()): number {
  if (!isRepeatingTimer(timer) || timer.durationSeconds <= 0) return 0;
  return Math.floor(stepTimerElapsed(timer, now) / timer.durationSeconds);
}

/**
 * Seconds left until the next ring. For a timer that rings once, goes negative
 * once time is up (`isStepTimerReady` needs the sign). A repeating one rolls
 * straight into the next interval instead, so it is always positive: it never
 * reads as finished, because only dismissing it ends it.
 */
export function stepTimerRemaining(timer: StepTimer, now: number = Date.now()): number {
  const elapsed = stepTimerElapsed(timer, now);
  if (isRepeatingTimer(timer) && timer.durationSeconds > 0) {
    return timer.durationSeconds - (elapsed % timer.durationSeconds);
  }
  return timer.durationSeconds - elapsed;
}

/** How far through, 0–1. A repeating timer's is through the interval it is in. */
export function stepTimerProgress(timer: StepTimer, now: number = Date.now()): number {
  if (timer.durationSeconds <= 0) return 1;
  const elapsed = stepTimerElapsed(timer, now);
  const within = isRepeatingTimer(timer) ? elapsed % timer.durationSeconds : elapsed;
  return Math.min(1, Math.max(0, within / timer.durationSeconds));
}

/**
 * "2 of 5", and "6 of 5" once it has gone past the plan. The recipe's number
 * is the denominator and is never enforced.
 */
export function describeRepeatCount(rings: number, target: number): string {
  return `${rings} of ${target}`;
}

/** Whether the count has passed what the recipe expected, which the row says in orange. */
export function isRepeatOver(rings: number, target: number): boolean {
  return rings > target;
}

/**
 * What a repeating offer starts at: the step's other time divided by the
 * interval. "Cook for about 2½ hours … add 1 cup of water every 30 minutes" is
 * 5. Returns the time it was read from too, so the card can say where the
 * number came from and not leave it looking invented.
 *
 * Needs a time at least twice the interval: "simmer 40 minutes, stir every 30"
 * is one ring and a bad suggestion for a repeat, so it falls back to
 * `DEFAULT_REPEAT_ROUNDS` like a step with no other time. Where there are
 * several, the longest wins, since the interval is spread across the whole
 * cook rather than the shortest sub-step in it.
 */
export function defaultRepeatRounds(
  offers: StepDuration[],
  every: StepDuration,
): { rounds: number; basis: StepDuration | null } {
  let basis: StepDuration | null = null;
  for (const offer of offers) {
    if (offer.every || offer.seconds < every.seconds * 2) continue;
    if (basis === null || offer.seconds > basis.seconds) basis = offer;
  }
  if (!basis) return { rounds: DEFAULT_REPEAT_ROUNDS, basis: null };
  const rounds = Math.round(basis.seconds / every.seconds);
  return { rounds: Math.max(1, Math.min(MAX_REPEAT_ROUNDS, rounds)), basis };
}

/**
 * The step's own words for a repeating timer, ending at the phrase: "…add 1 cup
 * hot water every 30 minutes". `stepTimerExcerpt` takes the *start* of the
 * clause, which for a long sentence is "The water will evaporate, so…", where
 * what the cook needs to be told is the instruction the interval belongs to,
 * and that comes just before it. Cut from the left at a word, so it is still
 * the recipe's own words and never a summary.
 */
export function repeatTimerExcerpt(text: string, offer: StepDuration, max: number = 48): string {
  const boundary = /[.!?;](?=\s)/g;
  let start = 0;
  for (let match = boundary.exec(text); match; match = boundary.exec(text)) {
    if (match.index < offer.start) start = match.index + 1;
    else break;
  }
  const clause = text.slice(start, offer.end)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\d+[.)]\s*/, '');
  if (clause.length <= max) return clause;
  const tail = clause.slice(clause.length - max);
  const space = tail.indexOf(' ');
  // Start at a word: if the cut landed mid-word, drop to the next space.
  const atWord = (clause[clause.length - max - 1] === ' ' || space < 0 ? tail : tail.slice(space + 1)).trim();
  // And not on the tail of an earlier phrase: "more, adding a splash of water
  // every 10 minutes" reads better from "adding", when the comma is near the cut.
  const comma = atWord.search(/,\s/);
  const whole = comma >= 0 && comma < atWord.length / 3 ? atWord.slice(comma + 1).trim() : atWord;
  return `…${whole}`;
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

/**
 * Every moment the alarm backends should be holding for a running timer: the
 * one ring for a timer that rings once, and for a repeating one the next ring
 * and the ones after it, up to the target and `REPEAT_RINGS_PAST_TARGET` beyond
 * it (never fewer than that many ahead, and never more than
 * `MAX_REPEAT_ALARMS`). Empty for a paused timer.
 *
 * Measured from what is left right now, so it is right whether the timer just
 * started, came back from a pause, or has been going for hours and is being
 * topped up.
 */
export function stepTimerRingTimes(timer: StepTimer, now: number = Date.now()): Date[] {
  const first = stepTimerEndsAt(timer, now);
  if (!first) return [];
  if (!isRepeatingTimer(timer)) return [first];
  const wanted = timer.repeatTarget + REPEAT_RINGS_PAST_TARGET - stepTimerRings(timer, now);
  const ahead = Math.min(MAX_REPEAT_ALARMS, Math.max(REPEAT_RINGS_PAST_TARGET, wanted));
  return Array.from({ length: ahead }, (_, at) => new Date(first.getTime() + at * timer.durationSeconds * 1000));
}

/** What "+1 min" adds. A minute is the unit every stove clock and oven mitt agrees on. */
export const STEP_TIMER_NUDGE_SECONDS = 60;

/** What a rest's "−15 s" and "+30 s" move it by: a rest is seconds, not a stove's minutes. */
export const REST_NUDGE_BACK_SECONDS = 15;
export const REST_NUDGE_FORWARD_SECONDS = 30;

/**
 * A timer's length after moving it by `seconds`, from now.
 *
 * Forward is measured from now rather than from the original length: a timer
 * four minutes past its seven is a cook saying "another minute from here", and
 * adding to the duration alone would hand back a minute that had already gone.
 *
 * Back takes time off what is left and stops at now, so −15 s on a rest with
 * ten seconds to go ends it rather than banking a debt; on a timer that has
 * already rung there is nothing left to take, and it stays as it is.
 */
export function nudgedDuration(timer: StepTimer, seconds: number, now: number = Date.now()): number {
  const elapsed = stepTimerElapsed(timer, now);
  if (seconds >= 0) {
    return Math.min(MAX_STEP_TIMER_SECONDS, Math.round(Math.max(timer.durationSeconds, elapsed) + seconds));
  }
  if (elapsed >= timer.durationSeconds) return timer.durationSeconds;
  return Math.max(0, Math.round(Math.max(elapsed, timer.durationSeconds + seconds)));
}

/**
 * How long a timer has been up, in whole seconds: 0 until it rings, then
 * counting. A rest that runs out counts up rather than stopping at zero, so a
 * glance says how long the rest really was.
 */
export function stepTimerOverSeconds(timer: StepTimer, now: number = Date.now()): number {
  return Math.max(0, Math.floor(-stepTimerRemaining(timer, now)));
}

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
export function sortStepTimers<T extends StepTimer>(timers: T[], now: number = Date.now()): T[] {
  const ready = (timer: T) => (isStepTimerReady(timer, now) ? 1 : 0);
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

// ==== the duration as a tap target in the sentence ====

/** A piece of a step's text, with the offer it starts when it is a duration phrase. */
export type StepTextPiece =
  | { kind: 'text'; text: string }
  | { kind: 'ingredient'; text: string; note: string }
  | { kind: 'duration'; text: string; offer: StepDuration };

/**
 * The step's text cut at each offered duration, so the phrase itself can be the
 * thing a cook taps ("7 to 9 minutes") instead of a chip underneath it.
 *
 * Takes the annotated segments `annotateSteps` made (or none) and splits only
 * their plain text; an ingredient segment is left whole, since a duration
 * inside the words an amount was pinned to is not a case worth a split. An
 * offer with no span (`timerSeconds`, whose `start` and `end` are both 0) has
 * no phrase to tap and gets only its chip. The pieces always join back to the
 * step's text.
 */
export function splitStepAtDurations(
  text: string,
  segments: ({ kind: 'text'; text: string } | { kind: 'ingredient'; text: string; note: string })[] | undefined,
  offers: StepDuration[],
): StepTextPiece[] {
  const spans = offers.filter(o => o.end > o.start).sort((a, b) => a.start - b.start);
  const base = segments && segments.length > 0 ? segments : [{ kind: 'text' as const, text }];
  const out: StepTextPiece[] = [];
  let at = 0;
  for (const segment of base) {
    const segStart = at;
    const segEnd = at + segment.text.length;
    at = segEnd;
    if (segment.kind !== 'text') {
      out.push(segment);
      continue;
    }
    let cursor = segStart;
    for (const offer of spans) {
      if (offer.start < cursor || offer.end > segEnd) continue;
      if (offer.start > cursor) out.push({ kind: 'text', text: text.slice(cursor, offer.start) });
      out.push({ kind: 'duration', text: text.slice(offer.start, offer.end), offer });
      cursor = offer.end;
    }
    if (cursor < segEnd) out.push({ kind: 'text', text: text.slice(cursor, segEnd) });
  }
  return out;
}

// ==== what a running timer is called ====

/** How long a timer's excerpt runs before it is cut at a word. */
export const STEP_TIMER_EXCERPT_MAX = 32;

/**
 * A few words of the step a timer was started from, so two rows in the stack
 * read "Simmer the rice, covered…" and "Add the pasta and cook 9 to…" rather
 * than "Step 2 of 12" and "Step 5 of 12", which a cook with a pan in each hand
 * has to remember the meaning of.
 *
 * The **clause holding the duration** (`at`, the offer's `start`), not the
 * step's opening words: a step is often two instructions, and the timer
 * belongs to the second ("Bring the water to a boil. Add the pasta and cook 9
 * minutes"). A clause ends at `.`, `!`, `?` or `;` followed by a space, so
 * "1.5 cups" stays whole. It is the recipe's own words, trimmed, never a
 * summary: the same "read it, don't rewrite it" rule the parse above keeps.
 * Stored on the timer when it starts, like `stepLabel`, so the row reads
 * without the recipe and survives an edit to the step.
 */
export function stepTimerExcerpt(text: string, at: number = 0, max: number = STEP_TIMER_EXCERPT_MAX): string {
  const pos = Math.max(0, Math.min(at, text.length));
  const boundary = /[.!?;](?=\s)/g;
  let start = 0;
  let end = text.length;
  for (let match = boundary.exec(text); match; match = boundary.exec(text)) {
    if (match.index < pos) start = match.index + 1;
    else { end = match.index; break; }
  }
  const clause = text.slice(start, end)
    .replace(/\s+/g, ' ')
    .trim()
    // A method typed as a numbered list keeps its numbers in the text.
    .replace(/^\d+[.)]\s*/, '')
    .replace(/[.!?;:,]+$/, '');
  if (clause.length <= max) return clause;
  const cut = clause.slice(0, max);
  // Cut where a word ends: at the cap itself when a space follows it, else
  // back to the last space inside it (unless that throws away half the text).
  const space = clause[max] === ' ' ? max : cut.lastIndexOf(' ');
  const head = (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '');
  return `${head}…`;
}

/**
 * The confirm before a timer still counting is cancelled, or null when there
 * is nothing to lose. Cancel sits on the same row as Pause, reached for with a
 * floury knuckle, and there's no getting a countdown back once it's gone; a
 * timer that has already rung is only being dismissed, so that stays one tap.
 */
export function stepTimerCancelPrompt(
  timer: StepTimer,
  now: number = Date.now(),
): { title: string; message: string } | null {
  if (isStepTimerReady(timer, now)) return null;
  const left = isRepeatingTimer(timer)
    ? `${describeRepeatCount(stepTimerRings(timer, now), timer.repeatTarget)} so far, ${formatStopwatch(stepTimerRemaining(timer, now))} to the next`
    : `${formatStopwatch(stepTimerRemaining(timer, now))} left`;
  const where = (timer.kind === 'rest' ? [timer.label] : [timer.stepExcerpt, timer.stepLabel]).filter(Boolean).join('\n');
  return {
    title: 'Cancel this timer?',
    message: where ? `${where}\n${isStepTimerRunning(timer) ? left : `Paused, ${left}`}` : left,
  };
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
    // A repeating timer never reads as finished, so "four hours after it rang"
    // is measured from the last ring it was armed for: the target and the
    // rings of overshoot it holds alarms for.
    if (isRepeatingTimer(timer)) {
      const lastArmed = timer.durationSeconds * (timer.repeatTarget + REPEAT_RINGS_PAST_TARGET);
      return (stepTimerElapsed(timer, now) - lastArmed) * 1000 < STEP_TIMER_KEEP_AFTER_READY_MS;
    }
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
    const t = entry as Record<string, unknown>;
    if (typeof t.id !== 'string') continue;
    if (typeof t.durationSeconds !== 'number' || !Number.isFinite(t.durationSeconds)) continue;
    const clock = {
      id: t.id,
      durationSeconds: Math.max(0, Math.round(t.durationSeconds)),
      startedAt: typeof t.startedAt === 'string' ? t.startedAt : null,
      elapsedSeconds: typeof t.elapsedSeconds === 'number' && Number.isFinite(t.elapsedSeconds)
        ? Math.max(0, t.elapsedSeconds)
        : 0,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString(),
    };
    if (t.kind === 'rest') {
      if (typeof t.sessionId !== 'string') continue;
      const rest: RestTimer = {
        kind: 'rest',
        ...clock,
        sessionId: t.sessionId,
        exerciseId: typeof t.exerciseId === 'string' ? t.exerciseId : '',
        sessionTitle: typeof t.sessionTitle === 'string' ? t.sessionTitle : '',
        label: typeof t.label === 'string' ? t.label : '',
      };
      out.push(rest);
      continue;
    }
    // A timer written before `kind` existed is a recipe's. Any kind this build
    // doesn't know is dropped, recipe id or not, rather than misread as one.
    if (t.kind !== undefined && t.kind !== 'recipe') continue;
    if (typeof t.recipeId !== 'string') continue;
    const recipe: RecipeStepTimer = {
      kind: 'recipe',
      ...clock,
      recipeId: t.recipeId,
      stepId: typeof t.stepId === 'string' ? t.stepId : '',
      recipeName: typeof t.recipeName === 'string' ? t.recipeName : '',
      stepLabel: typeof t.stepLabel === 'string' ? t.stepLabel : '',
      ...(typeof t.stepExcerpt === 'string' && t.stepExcerpt ? { stepExcerpt: t.stepExcerpt } : {}),
      ...(typeof t.repeatTarget === 'number' && Number.isInteger(t.repeatTarget)
        && t.repeatTarget >= 1 && t.repeatTarget <= MAX_REPEAT_ROUNDS
        ? { repeatTarget: t.repeatTarget }
        : {}),
    };
    out.push(recipe);
  }
  return out;
}

export function serializeStepTimerQueue(timers: StepTimer[]): string {
  return JSON.stringify(timers);
}
