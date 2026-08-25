import {
  MAX_STEP_TIMER_SECONDS,
  describeStepDuration,
  formatStepDuration,
  isStepTimerReady,
  isStepTimerRunning,
  parseStepDurations,
  sortStepTimers,
  stepDurationOffers,
  stepTimerElapsed,
  stepTimerEndsAt,
  stepTimerProgress,
  stepTimerRemaining,
} from '../utils/stepTimers';
import type { StepTimer } from '../types';

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

const TIMER: StepTimer = {
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
  const make = (id: string, createdAt: string, durationSeconds: number): StepTimer => ({
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
