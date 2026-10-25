import {
  DEFAULT_REPEAT_ROUNDS,
  MAX_REPEAT_ALARMS,
  MAX_STEP_TIMER_SECONDS,
  defaultRepeatRounds,
  describeRepeatCount,
  describeStepDuration,
  formatStepDuration,
  isRepeatOver,
  isRepeatingTimer,
  isStepTimerReady,
  isStepTimerRunning,
  nudgedDuration,
  parseStepDurations,
  parseStepTimerQueue,
  pruneStaleStepTimers,
  repeatTimerExcerpt,
  sortStepTimers,
  splitStepAtDurations,
  stepDurationOffers,
  stepTimerCancelPrompt,
  stepTimerElapsed,
  stepTimerExcerpt,
  stepTimerEndsAt,
  stepTimerOverSeconds,
  stepTimerProgress,
  stepTimerRemaining,
  stepTimerRingTimes,
  stepTimerRings,
} from '../utils/stepTimers';
import type { RecipeStepTimer, RestTimer } from '../types';

const seconds = (text: string) => parseStepDurations(text).map(d => d.seconds);

describe('parseStepDurations', () => {
  it('reads a plain duration', () => {
    expect(seconds('Bake for 25 minutes.')).toEqual([25 * 60]);
  });

  it('reads the low end of a range, which is when to go and look', () => {
    const [found] = parseStepDurations(
      'Cook, stirring occasionally, until mostly golden, 7 to 9 minutes.'
    );
    expect(found.seconds).toBe(7 * 60);
    expect(found.maxSeconds).toBe(9 * 60);
    expect(found.text).toBe('7 to 9 minutes');
  });

  it.each([
    ['20-25 minutes', 20 * 60, 25 * 60],
    ['20 – 25 minutes', 20 * 60, 25 * 60],
    ['2 or 3 minutes', 2 * 60, 3 * 60],
    ['45 to 60 seconds', 45, 60],
  ])('reads %s as a range', (text, low, high) => {
    const [found] = parseStepDurations(`Simmer ${text}, then serve.`);
    expect([found.seconds, found.maxSeconds]).toEqual([low, high]);
  });

  it('takes the smaller end of a range written backwards', () => {
    const [found] = parseStepDurations('Roast 9 to 7 minutes.');
    expect([found.seconds, found.maxSeconds]).toEqual([7 * 60, 9 * 60]);
  });

  it('reads numbers written as words', () => {
    // The demo seed's own steak step is written this way.
    expect(seconds('Sear three minutes a side, then baste.')).toEqual([3 * 60]);
    expect(seconds('Rest for twenty minutes.')).toEqual([20 * 60]);
    expect(seconds('Knead for forty-five minutes.')).toEqual([45 * 60]);
  });

  it('reads "half an hour" and "an hour and a half"', () => {
    expect(seconds('Chill for half an hour.')).toEqual([30 * 60]);
    expect(seconds('Braise for an hour and a half.')).toEqual([90 * 60]);
  });

  it('reads fractions in both notations', () => {
    expect(seconds('Proof 1 1/2 hours.')).toEqual([90 * 60]);
    expect(seconds('Proof 1½ hours.')).toEqual([90 * 60]);
    expect(seconds('Steep ½ hour.')).toEqual([30 * 60]);
  });

  it('merges a compound downwards', () => {
    expect(seconds('Roast 1 hour 20 minutes.')).toEqual([80 * 60]);
    expect(seconds('Roast 1 hour and 20 minutes.')).toEqual([80 * 60]);
  });

  it('does not merge a compound upwards', () => {
    // Two things the sentence said, not one duration.
    expect(seconds('Rest 20 minutes, then 2 hours in the fridge.')).toEqual([20 * 60, 2 * 3600]);
  });

  it('folds a range whose two halves carry their own units', () => {
    const [found, ...rest] = parseStepDurations('Toast 30 seconds to 1 minute.');
    expect(rest).toEqual([]);
    expect([found.seconds, found.maxSeconds]).toEqual([30, 60]);
  });

  it('finds several durations in one step, in order', () => {
    expect(seconds('Sear 3 minutes per side, then roast 20 minutes.')).toEqual([3 * 60, 20 * 60]);
  });

  it('offers one chip for a length the step names twice', () => {
    expect(seconds('Cook 3 minutes, flip, and cook 3 minutes more.')).toEqual([3 * 60]);
  });

  it.each([
    'Preheat the oven to 425 degrees.',
    'Cut the tempeh into 2 inch pieces.',
    'Makes 8 to 10 servings.',
    'Season lightly with salt.',
    'Add more oil as needed if the pan looks dry.',
    'Whisk in 2 cups of stock.',
  ])('finds nothing in %s', text => {
    expect(parseStepDurations(text)).toEqual([]);
  });

  it('refuses a length too short to be a timer', () => {
    // "a second"/"one second" are how a sentence says "another", far more
    // often than they are a duration.
    expect(seconds('Add a second layer of sauce.')).toEqual([]);
    expect(seconds('Give it one second.')).toEqual([]);
  });

  it('refuses an overnight rest, which wants a task and not a kitchen timer', () => {
    expect(seconds('Marinate overnight.')).toEqual([]);
    expect(seconds('Brine for 24 hours.')).toEqual([]);
    expect(seconds(`Rest ${MAX_STEP_TIMER_SECONDS / 3600} hours.`)).toEqual([MAX_STEP_TIMER_SECONDS]);
  });

  it('reports where in the text it read the phrase', () => {
    const text = 'Simmer 12 minutes.';
    const [found] = parseStepDurations(text);
    expect(text.slice(found.start, found.end)).toBe('12 minutes');
  });

  it('reads the abbreviations a method actually uses', () => {
    expect(seconds('Rest 10 mins.')).toEqual([10 * 60]);
    expect(seconds('Rest 10 min.')).toEqual([10 * 60]);
    expect(seconds('Bake 1 hr.')).toEqual([3600]);
    expect(seconds('Blanch 30 sec.')).toEqual([30]);
  });

  it('ignores a bare unit letter, which is a measurement more often than a time', () => {
    expect(seconds('Roll the dough to 5 m thickness.')).toEqual([]);
  });
});

describe('stepDurationOffers', () => {
  it('parses the text when no duration is set on the step', () => {
    expect(stepDurationOffers({ text: 'Bake 25 minutes.' }).map(d => d.seconds)).toEqual([25 * 60]);
  });

  it('replaces the parse when one is set, rather than adding to it', () => {
    const offers = stepDurationOffers({ text: 'Bake 25 minutes.', timerSeconds: 600 });
    expect(offers.map(d => d.seconds)).toEqual([600]);
  });

  it('falls back to the parse for a value outside the timer range', () => {
    expect(stepDurationOffers({ text: 'Bake 25 minutes.', timerSeconds: 1 }).map(d => d.seconds))
      .toEqual([25 * 60]);
  });

  it('offers nothing for a step with neither', () => {
    expect(stepDurationOffers({ text: 'Cook until the edges look dry.' })).toEqual([]);
  });
});

describe('formatStepDuration', () => {
  it.each([
    [30, '30s'],
    [60, '1m'],
    [7 * 60, '7m'],
    [90, '1m 30s'],
    [3599, '59m 59s'],
    [3600, '1h'],
    [80 * 60, '1h 20m'],
  ])('formats %i seconds as %s', (input, expected) => {
    expect(formatStepDuration(input)).toBe(expected);
  });

  it('describes a range with both ends', () => {
    expect(describeStepDuration({ start: 0, end: 0, seconds: 420, maxSeconds: 540, text: '' }))
      .toBe('7m to 9m');
  });
});

const TIMER: RecipeStepTimer = {
  kind: 'recipe',
  id: 't1',
  recipeId: 'r1',
  stepId: 's1',
  recipeName: 'Sticky, Spicy Tempeh',
  stepLabel: 'Step 2 of 3',
  durationSeconds: 420,
  startedAt: '2026-08-25T12:00:00.000Z',
  elapsedSeconds: 0,
  createdAt: '2026-08-25T12:00:00.000Z',
};

const at = (isoMinutes: number) => new Date('2026-08-25T12:00:00.000Z').getTime() + isoMinutes * 60_000;

describe('step timer countdown', () => {
  it('derives elapsed against the clock rather than counting down in state', () => {
    expect(stepTimerElapsed(TIMER, at(2))).toBe(120);
    expect(stepTimerRemaining(TIMER, at(2))).toBe(300);
  });

  it('adds a running segment to what an earlier one banked', () => {
    const resumed = { ...TIMER, elapsedSeconds: 60 };
    expect(stepTimerElapsed(resumed, at(1))).toBe(120);
  });

  it('reports only what is banked while paused', () => {
    const paused = { ...TIMER, startedAt: null, elapsedSeconds: 90 };
    expect(stepTimerElapsed(paused, at(30))).toBe(90);
    expect(isStepTimerRunning(paused)).toBe(false);
    expect(stepTimerEndsAt(paused, at(0))).toBeNull();
  });

  it('does not rewind when the clock moves backwards', () => {
    expect(stepTimerElapsed(TIMER, at(-5))).toBe(0);
  });

  it('goes ready when time is up and stays ready after', () => {
    expect(isStepTimerReady(TIMER, at(6))).toBe(false);
    expect(isStepTimerReady(TIMER, at(7))).toBe(true);
    expect(isStepTimerReady(TIMER, at(40))).toBe(true);
    expect(stepTimerProgress(TIMER, at(40))).toBe(1);
  });

  it('ends at the instant the remaining time runs out', () => {
    expect(stepTimerEndsAt(TIMER, at(2))?.toISOString()).toBe('2026-08-25T12:07:00.000Z');
  });
});

describe('sortStepTimers', () => {
  const make = (id: string, createdAt: string, durationSeconds: number): RecipeStepTimer => ({
    ...TIMER, id, createdAt, durationSeconds, startedAt: createdAt,
  });

  it('keeps live timers in start order and sinks the rung ones below them', () => {
    const older = make('a', '2026-08-25T12:00:00.000Z', 600);
    const newer = make('b', '2026-08-25T12:01:00.000Z', 600);
    const rung = make('c', '2026-08-25T12:02:00.000Z', 60);
    expect(sortStepTimers([rung, newer, older], at(5)).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts the most recently rung timer last', () => {
    const first = make('a', '2026-08-25T12:00:00.000Z', 60);
    const second = make('b', '2026-08-25T12:01:00.000Z', 60);
    expect(sortStepTimers([first, second], at(10)).map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('stepTimerExcerpt', () => {
  const excerptAt = (text: string) => {
    const [offer] = parseStepDurations(text);
    return stepTimerExcerpt(text, offer.start);
  };

  it('names the clause the duration is in, not the step\'s opening words', () => {
    expect(excerptAt('Bring a large pot of salted water to a boil. Add the pasta and cook 9 minutes.'))
      .toBe('Add the pasta and cook 9 minutes');
  });

  it('keeps a short step whole, without its closing full stop', () => {
    expect(excerptAt('Simmer the rice, 20 minutes.')).toBe('Simmer the rice, 20 minutes');
  });

  it('cuts a long clause at a word and says so', () => {
    const text = 'Cook the onions, stirring now and then so they color evenly, 12 minutes.';
    const excerpt = excerptAt(text);
    expect(excerpt).toBe('Cook the onions, stirring now…');
    expect(excerpt.length).toBeLessThanOrEqual(33);
  });

  it('does not split on a decimal point', () => {
    expect(stepTimerExcerpt('Add 1.5 cups stock and simmer 10 minutes.', 30))
      .toBe('Add 1.5 cups stock and simmer 10…');
  });

  it('takes the first clause for a timer set on the step rather than read from it', () => {
    // stepDurationOffers' override offer starts at 0.
    expect(stepTimerExcerpt('Rest the dough. Then shape it.', 0)).toBe('Rest the dough');
  });

  it('drops a list number typed into the method', () => {
    expect(stepTimerExcerpt('3. Bake 25 minutes.', 5)).toBe('Bake 25 minutes');
  });
});

describe('stepTimerCancelPrompt', () => {
  it('asks while there is time left, naming the step', () => {
    const prompt = stepTimerCancelPrompt({ ...TIMER, stepExcerpt: 'Simmer the rice' }, at(2));
    expect(prompt).toEqual({
      title: 'Cancel this timer?',
      message: 'Simmer the rice\nStep 2 of 3\n5:00 left',
    });
  });

  it('says a paused timer is paused', () => {
    const paused = { ...TIMER, startedAt: null, elapsedSeconds: 60 };
    expect(stepTimerCancelPrompt(paused, at(30))?.message).toBe('Step 2 of 3\nPaused, 6:00 left');
  });

  it('does not ask before dismissing a timer that has already rung', () => {
    expect(stepTimerCancelPrompt(TIMER, at(8))).toBeNull();
  });
});

const REST: RestTimer = {
  kind: 'rest',
  id: 'rt1',
  sessionId: 'w1',
  exerciseId: 'lib:barbell-bench-press',
  sessionTitle: 'Push A',
  label: 'After set 2 of Barbell bench press',
  durationSeconds: 90,
  startedAt: '2026-08-25T12:00:00.000Z',
  elapsedSeconds: 0,
  createdAt: '2026-08-25T12:00:00.000Z',
};

describe('parseStepTimerQueue', () => {
  it('keeps a stored excerpt, and reads a timer from before it existed without one', () => {
    const raw = JSON.stringify([{ ...TIMER, stepExcerpt: 'Simmer the rice' }, { ...TIMER, id: 't2' }]);
    const [withExcerpt, without] = parseStepTimerQueue(raw);
    expect(withExcerpt.kind === 'recipe' && withExcerpt.stepExcerpt).toBe('Simmer the rice');
    expect(without.kind === 'recipe' && without.stepExcerpt).toBeUndefined();
  });

  it('reads a timer stored before kinds existed as a recipe timer', () => {
    const { kind: _kind, ...old } = TIMER;
    expect(parseStepTimerQueue(JSON.stringify([old]))).toEqual([TIMER]);
  });

  it('reads a rest back whole, beside a recipe timer', () => {
    expect(parseStepTimerQueue(JSON.stringify([TIMER, REST]))).toEqual([TIMER, REST]);
  });

  it('drops a rest with no session and a kind it does not know, keeping the rest', () => {
    const raw = JSON.stringify([{ ...REST, sessionId: undefined }, { ...TIMER, kind: 'laundry' }, TIMER]);
    expect(parseStepTimerQueue(raw)).toEqual([TIMER]);
  });
});

describe('nudgedDuration', () => {
  it('adds from now on a timer past its end, so the time added is all still to come', () => {
    // 90 s rest, 2 minutes in: +30 s means 30 s from now, not 30 s past the end.
    expect(nudgedDuration(REST, 30, at(2))).toBe(150);
    expect(nudgedDuration(REST, 30, at(1))).toBe(120);
  });

  it('takes time off what is left, stopping at now', () => {
    expect(nudgedDuration(REST, -15, at(0.5))).toBe(75);
    // Ten seconds left: −15 s ends it now rather than banking a debt.
    expect(nudgedDuration(REST, -15, at(80 / 60))).toBe(80);
  });

  it('leaves a timer that has already rung as it is when taking time off', () => {
    expect(nudgedDuration(REST, -15, at(3))).toBe(90);
  });
});

describe('stepTimerOverSeconds', () => {
  it('is zero until the timer rings, then counts up in whole seconds', () => {
    expect(stepTimerOverSeconds(REST, at(1))).toBe(0);
    expect(stepTimerOverSeconds(REST, at(1.5))).toBe(0);
    expect(stepTimerOverSeconds(REST, at(2))).toBe(30);
  });
});

describe('stepTimerCancelPrompt for a rest', () => {
  it('names the set the rest is after', () => {
    expect(stepTimerCancelPrompt(REST, at(0.5))?.message).toBe('After set 2 of Barbell bench press\n1:00 left');
  });
});

describe('splitStepAtDurations', () => {
  const text = 'Cook 7 to 9 minutes, then rest 2 minutes.';
  const offers = parseStepDurations(text);

  it('cuts the sentence at each duration and joins back to the text', () => {
    const pieces = splitStepAtDurations(text, undefined, offers);
    expect(pieces.map(p => p.text).join('')).toBe(text);
    const taps = pieces.filter(p => p.kind === 'duration');
    expect(taps.map(p => p.text)).toEqual(['7 to 9 minutes', '2 minutes']);
  });

  it('leaves an ingredient segment whole and splits the text around it', () => {
    const segments = [
      { kind: 'text' as const, text: 'Cook the ' },
      { kind: 'ingredient' as const, text: 'rice', note: '200 g' },
      { kind: 'text' as const, text: ' 7 to 9 minutes.' },
    ];
    const full = 'Cook the rice 7 to 9 minutes.';
    const pieces = splitStepAtDurations(full, segments, parseStepDurations(full));
    expect(pieces.map(p => p.text).join('')).toBe(full);
    expect(pieces.some(p => p.kind === 'ingredient')).toBe(true);
    expect(pieces.filter(p => p.kind === 'duration')).toHaveLength(1);
  });

  it('gives an explicit timerSeconds no phrase to tap', () => {
    const pieces = splitStepAtDurations('Until dry.', undefined, stepDurationOffers({ text: 'Until dry.', timerSeconds: 300 }));
    expect(pieces).toEqual([{ kind: 'text', text: 'Until dry.' }]);
  });
});

// ==== a timer that repeats ====

const BEANS = 'Cook the beans over medium-low heat for about 2½ hours, without covering or stirring, until tender. '
  + 'The water will evaporate, so you will need to add 1 cup hot water every 30 minutes.';

describe('"every" offers', () => {
  it('reads "every 30 minutes" as a repeating offer that includes the word every', () => {
    const [, every] = parseStepDurations(BEANS);
    expect(every.every).toBe(true);
    expect(every.seconds).toBe(30 * 60);
    expect(every.text).toBe('every 30 minutes');
    expect(BEANS.slice(every.start, every.end)).toBe('every 30 minutes');
  });

  it('leaves the other time in the same step a plain one', () => {
    const [plain] = parseStepDurations(BEANS);
    expect(plain.seconds).toBe(150 * 60);
    expect(plain.every).toBeUndefined();
  });

  it('reads the unit words and fractions the same way', () => {
    expect(parseStepDurations('Stir every half hour.')[0]).toMatchObject({ every: true, seconds: 1800 });
    expect(parseStepDurations('Baste every ten minutes.')[0]).toMatchObject({ every: true, seconds: 600 });
    expect(parseStepDurations('Stir every 30 seconds.')[0]).toMatchObject({ every: true, seconds: 30 });
  });

  it('does not treat a duration merely near the word every as a cycle', () => {
    expect(parseStepDurations('Cook 20 minutes. Stir every pot twice.')[0].every).toBeUndefined();
    expect(parseStepDurations('Stir often, every so often, for 20 minutes.')[0].every).toBeUndefined();
  });

  it('keeps "simmer 30 minutes" and "stir every 30 minutes" as two offers', () => {
    const found = parseStepDurations('Simmer 30 minutes, stirring every 30 minutes.');
    expect(found.map(d => !!d.every)).toEqual([false, true]);
  });

  it('still dedupes a plain duration written twice', () => {
    expect(parseStepDurations('Cook 3 minutes, flip, cook 3 minutes more.')).toHaveLength(1);
  });
});

describe('defaultRepeatRounds', () => {
  it('divides the step\'s other time by the interval', () => {
    const offers = parseStepDurations(BEANS);
    const { rounds, basis } = defaultRepeatRounds(offers, offers[1]);
    expect(rounds).toBe(5);
    expect(basis?.text).toBe('2½ hours');
  });

  it('falls back to a default when the step names no other time', () => {
    const offers = parseStepDurations('Add a splash of water every 10 minutes.');
    expect(defaultRepeatRounds(offers, offers[0])).toEqual({ rounds: DEFAULT_REPEAT_ROUNDS, basis: null });
  });

  it('ignores a time too short to hold two intervals', () => {
    const offers = parseStepDurations('Simmer 40 minutes, stirring every 30 minutes.');
    expect(defaultRepeatRounds(offers, offers[1]).basis).toBeNull();
  });

  it('takes the longest of several other times', () => {
    const offers = parseStepDurations('Boil 20 minutes, then cook 2 hours more, adding water every 20 minutes.');
    expect(defaultRepeatRounds(offers, offers[2]).rounds).toBe(6);
  });
});

describe('repeatTimerExcerpt', () => {
  const offers = parseStepDurations(BEANS);

  it('ends at the interval and keeps the instruction before it', () => {
    expect(repeatTimerExcerpt(BEANS, offers[1])).toBe('…need to add 1 cup hot water every 30 minutes');
  });

  it('returns a short clause whole', () => {
    const text = 'Stir every 2 minutes.';
    expect(repeatTimerExcerpt(text, parseStepDurations(text)[0])).toBe('Stir every 2 minutes');
  });

  it('starts at the clause holding the phrase, not the step', () => {
    const text = 'Boil the water. Add salt every 5 minutes.';
    expect(repeatTimerExcerpt(text, parseStepDurations(text)[0])).toBe('Add salt every 5 minutes');
  });
});

describe('a repeating timer', () => {
  // 30 minutes, expecting 5, started at 12:00.
  const REPEATING: RecipeStepTimer = { ...TIMER, durationSeconds: 1800, repeatTarget: 5 };

  it('knows it repeats only when it has a target', () => {
    expect(isRepeatingTimer(REPEATING)).toBe(true);
    expect(isRepeatingTimer(TIMER)).toBe(false);
    expect(isRepeatingTimer(REST)).toBe(false);
    expect(isRepeatingTimer({ ...TIMER, repeatTarget: 0 })).toBe(false);
  });

  it('counts the rings from the clock', () => {
    expect(stepTimerRings(REPEATING, at(0))).toBe(0);
    expect(stepTimerRings(REPEATING, at(29))).toBe(0);
    expect(stepTimerRings(REPEATING, at(30))).toBe(1);
    expect(stepTimerRings(REPEATING, at(95))).toBe(3);
  });

  it('keeps counting past the target, which is the point of a soft target', () => {
    expect(stepTimerRings(REPEATING, at(30 * 6 + 5))).toBe(6);
    expect(isRepeatOver(6, 5)).toBe(true);
    expect(isRepeatOver(5, 5)).toBe(false);
    expect(describeRepeatCount(6, 5)).toBe('6 of 5');
  });

  it('counts a locked phone the same as an open one, and stops with a pause', () => {
    const paused = { ...REPEATING, startedAt: null, elapsedSeconds: 70 * 60 };
    expect(stepTimerRings(paused, at(500))).toBe(2);
    const resumed = { ...REPEATING, elapsedSeconds: 50 * 60 };
    expect(stepTimerRings(resumed, at(15))).toBe(2);
  });

  it('rolls into the next interval instead of finishing', () => {
    expect(stepTimerRemaining(REPEATING, at(10))).toBe(20 * 60);
    expect(stepTimerRemaining(REPEATING, at(31))).toBe(29 * 60);
    expect(stepTimerRemaining(REPEATING, at(30))).toBe(30 * 60);
    expect(isStepTimerReady(REPEATING, at(31))).toBe(false);
    expect(isStepTimerReady(REPEATING, at(300))).toBe(false);
  });

  it('draws progress through the interval it is in', () => {
    expect(stepTimerProgress(REPEATING, at(15))).toBeCloseTo(0.5);
    expect(stepTimerProgress(REPEATING, at(45))).toBeCloseTo(0.5);
  });

  it('ends at the next ring, not the last one', () => {
    expect(stepTimerEndsAt(REPEATING, at(40))?.toISOString()).toBe('2026-08-25T13:00:00.000Z');
  });

  it('is not a timer that rings once, so a plain one reads as it always did', () => {
    expect(stepTimerRings(TIMER, at(60))).toBe(0);
    expect(isStepTimerReady(TIMER, at(60))).toBe(true);
  });
});

describe('stepTimerRingTimes', () => {
  const REPEATING: RecipeStepTimer = { ...TIMER, durationSeconds: 1800, repeatTarget: 5 };

  it('is the one ring for a timer that rings once', () => {
    expect(stepTimerRingTimes(TIMER, at(2)).map(d => d.toISOString())).toEqual(['2026-08-25T12:07:00.000Z']);
  });

  it('is nothing for a paused timer', () => {
    expect(stepTimerRingTimes({ ...REPEATING, startedAt: null }, at(2))).toEqual([]);
  });

  it('arms the target and three rings past it, half an hour apart', () => {
    const times = stepTimerRingTimes(REPEATING, at(2));
    expect(times).toHaveLength(8);
    expect(times[0].toISOString()).toBe('2026-08-25T12:30:00.000Z');
    expect(times[7].toISOString()).toBe('2026-08-25T16:00:00.000Z');
  });

  it('arms fewer as the count catches up, and never fewer than three ahead', () => {
    expect(stepTimerRingTimes(REPEATING, at(30 * 3 + 1))).toHaveLength(5);
    expect(stepTimerRingTimes(REPEATING, at(30 * 9 + 1))).toHaveLength(3);
  });

  it('never arms more than the cap', () => {
    const long = { ...REPEATING, repeatTarget: 99 };
    expect(stepTimerRingTimes(long, at(1))).toHaveLength(MAX_REPEAT_ALARMS);
  });
});

describe('a repeating timer in storage', () => {
  const REPEATING: RecipeStepTimer = { ...TIMER, durationSeconds: 1800, repeatTarget: 5 };

  it('reads its target back, and a timer without one as it was', () => {
    const [repeating, plain] = parseStepTimerQueue(JSON.stringify([REPEATING, TIMER]));
    expect(repeating.kind === 'recipe' && repeating.repeatTarget).toBe(5);
    expect(plain.kind === 'recipe' && plain.repeatTarget).toBeUndefined();
  });

  it('drops a target that is not a whole number of rings and keeps the timer', () => {
    for (const bad of [0, -2, 2.5, 100, '5', null]) {
      const [read] = parseStepTimerQueue(JSON.stringify([{ ...REPEATING, repeatTarget: bad }]));
      expect(read.kind === 'recipe' && read.repeatTarget).toBeUndefined();
    }
  });

  it('keeps a running one well after its first ring, and drops it four hours after its last armed ring', () => {
    // Armed through 8 rings: 4 hours from 12:00. Stale 4 hours after that.
    expect(pruneStaleStepTimers([REPEATING], at(60 * 7))).toHaveLength(1);
    expect(pruneStaleStepTimers([REPEATING], at(60 * 8 + 1))).toHaveLength(0);
  });

  it('keeps a paused one however long it has been', () => {
    expect(pruneStaleStepTimers([{ ...REPEATING, startedAt: null, elapsedSeconds: 60 }], at(60 * 48))).toHaveLength(1);
  });

  it('tells the cook how many it has rung when asking before a cancel', () => {
    const prompt = stepTimerCancelPrompt(REPEATING, at(65));
    expect(prompt?.message).toContain('2 of 5 so far');
  });
});
