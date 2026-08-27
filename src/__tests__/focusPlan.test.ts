import type { FocusSession, FocusStep } from '../types';
import {
  advanceFocusSession,
  buildFocusPlan,
  currentFocusStep,
  focusMeasuredMinutes,
  focusPlanTotals,
  focusProjectedEnd,
  focusRemainingMinutes,
  focusStepElapsed,
  focusStepProgress,
  focusStepRemaining,
  isFocusRunning,
  isFocusSessionFinished,
  isFocusStepDone,
  normalizePlanTail,
  pauseFocusSession,
  plannedTaskMinutes,
  planTotalMinutes,
  pruneFocusPlan,
  resumeFocusSession,
  splitMinutes,
  upcomingStepsForTask,
  type FocusPlanOptions,
  type FocusPlanTask,
} from '../utils/focusPlan';

const OPTIONS: FocusPlanOptions = {
  workCapMinutes: 25,
  defaultWorkMinutes: 25,
  restAfterTasks: null,
  restAfterMinutes: 25,
  restMinutes: 5,
  longRestEvery: 4,
  longRestMinutes: 15,
};

/** A task carrying a precise estimate, with the chain fields the reader needs. */
const task = (id: string, estimatedMinutes: number | null): FocusPlanTask => ({
  id,
  estimatedMinutes,
  effort: 0,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
});

/** Compact rendering of a plan, so the assertions read like the run does. */
const shape = (steps: readonly FocusStep[]): string[] =>
  steps.map(s => (s.kind === 'rest' ? `rest ${s.minutes}` : `${s.taskId} ${s.minutes} (${s.part}/${s.partCount})`));

const session = (steps: FocusStep[], over: Partial<FocusSession> = {}): FocusSession => ({
  id: 'session',
  startedAt: '2026-08-22T09:00:00.000Z',
  steps,
  stepIndex: 0,
  stepStartedAt: null,
  stepElapsedSeconds: 0,
  completedTaskIds: [],
  ...over,
});

const work = (taskId: string, minutes: number, part = 1, partCount = 1): FocusStep =>
  ({ kind: 'work', taskId, minutes, part, partCount, long: false });
const rest = (minutes: number, long = false): FocusStep =>
  ({ kind: 'rest', taskId: null, minutes, part: 1, partCount: 1, long });

describe('splitMinutes', () => {
  it('leaves a task that fits under the cap alone', () => {
    expect(splitMinutes(20, 25)).toEqual([20]);
    expect(splitMinutes(25, 25)).toEqual([25]);
  });

  it('cuts into equal parts rather than cap-sized ones plus a stub', () => {
    expect(splitMinutes(60, 25)).toEqual([20, 20, 20]);
  });

  it('spreads a remainder over the earlier parts, so the run tapers by a minute at worst', () => {
    expect(splitMinutes(55, 25)).toEqual([19, 18, 18]);
    expect(splitMinutes(50, 25)).toEqual([25, 25]);
  });

  it('always yields at least one whole minute', () => {
    expect(splitMinutes(0, 25)).toEqual([1]);
    expect(splitMinutes(0.4, 25)).toEqual([1]);
  });

  it('treats a non-positive cap as no cap rather than dividing by zero', () => {
    expect(splitMinutes(90, 0)).toEqual([90]);
  });
});

describe('buildFocusPlan', () => {
  it('lays each task out as a work stretch of its own estimate', () => {
    const steps = buildFocusPlan([task('a', 10), task('b', 10)], { ...OPTIONS, restAfterMinutes: null });
    expect(shape(steps)).toEqual(['a 10 (1/1)', 'b 10 (1/1)']);
  });

  it('falls back to the default stretch for a task with no estimate', () => {
    const steps = buildFocusPlan([task('a', null)], OPTIONS);
    expect(shape(steps)).toEqual(['a 25 (1/1)']);
  });

  it('breaks once the minutes trigger is reached', () => {
    const steps = buildFocusPlan([task('a', 25), task('b', 25), task('c', 25)], OPTIONS);
    expect(shape(steps)).toEqual(['a 25 (1/1)', 'rest 5', 'b 25 (1/1)', 'rest 5', 'c 25 (1/1)']);
  });

  it('lets short tasks share a break rather than earning one each', () => {
    const steps = buildFocusPlan([task('a', 10), task('b', 10), task('c', 10)], OPTIONS);
    // 10 + 10 = 20, under the 25 minute trigger; the third pushes it over.
    expect(shape(steps)).toEqual(['a 10 (1/1)', 'b 10 (1/1)', 'c 10 (1/1)']);
  });

  it('breaks on the task count when that trigger fires first', () => {
    const steps = buildFocusPlan(
      [task('a', 10), task('b', 10), task('c', 10)],
      { ...OPTIONS, restAfterTasks: 2, restAfterMinutes: null },
    );
    expect(shape(steps)).toEqual(['a 10 (1/1)', 'b 10 (1/1)', 'rest 5', 'c 10 (1/1)']);
  });

  it('uses whichever trigger comes first when both are on', () => {
    const steps = buildFocusPlan(
      [task('a', 25), task('b', 5), task('c', 5), task('d', 25)],
      { ...OPTIONS, restAfterTasks: 2 },
    );
    // 'a' alone hits 25 minutes before two tasks are done; then b + c hit the
    // task count before their 10 minutes reach the minute trigger.
    expect(shape(steps)).toEqual([
      'a 25 (1/1)', 'rest 5', 'b 5 (1/1)', 'c 5 (1/1)', 'rest 5', 'd 25 (1/1)',
    ]);
  });

  it('splits a task longer than the cap, and breaks between its parts', () => {
    const steps = buildFocusPlan([task('a', 60)], { ...OPTIONS, restAfterMinutes: 20 });
    expect(shape(steps)).toEqual(['a 20 (1/3)', 'rest 5', 'a 20 (2/3)', 'rest 5', 'a 20 (3/3)']);
  });

  it('counts a split task as one task, not one per stretch', () => {
    const steps = buildFocusPlan(
      [task('a', 75), task('b', 10)],
      { ...OPTIONS, restAfterTasks: 1, restAfterMinutes: null },
    );
    // Three stretches of 'a' with no break between them: the count only ticks
    // when a task is finished.
    expect(shape(steps)).toEqual(['a 25 (1/3)', 'a 25 (2/3)', 'a 25 (3/3)', 'rest 5', 'b 10 (1/1)']);
  });

  it('makes every Nth break a long one', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(`t${i}`, 25));
    const steps = buildFocusPlan(tasks, OPTIONS);
    const rests = steps.filter(s => s.kind === 'rest');
    expect(rests.map(r => r.minutes)).toEqual([5, 5, 5, 15]);
    expect(rests.map(r => r.long)).toEqual([false, false, false, true]);
  });

  it('never ends on a break', () => {
    const steps = buildFocusPlan([task('a', 25), task('b', 25)], OPTIONS);
    expect(steps[steps.length - 1].kind).toBe('work');
  });

  it('builds a straight run of work when both triggers are off', () => {
    const steps = buildFocusPlan(
      [task('a', 25), task('b', 25)],
      { ...OPTIONS, restAfterTasks: null, restAfterMinutes: null },
    );
    expect(shape(steps)).toEqual(['a 25 (1/1)', 'b 25 (1/1)']);
  });

  it('treats a zero rule as off, the same as null', () => {
    const steps = buildFocusPlan(
      [task('a', 25), task('b', 25)],
      { ...OPTIONS, restAfterTasks: 0, restAfterMinutes: 0 },
    );
    expect(shape(steps)).toEqual(['a 25 (1/1)', 'b 25 (1/1)']);
  });

  it('yields an empty plan for an empty queue', () => {
    expect(buildFocusPlan([], OPTIONS)).toEqual([]);
  });
});

describe('normalizePlanTail', () => {
  it('collapses adjacent breaks, keeping the longer one', () => {
    expect(shape(normalizePlanTail([work('a', 10), rest(5), rest(15, true), work('b', 10)])))
      .toEqual(['a 10 (1/1)', 'rest 15', 'b 10 (1/1)']);
  });

  it('strips a trailing break, however many pile up', () => {
    expect(shape(normalizePlanTail([work('a', 10), rest(5), rest(15, true)])))
      .toEqual(['a 10 (1/1)']);
  });

  it('empties a run that is nothing but breaks', () => {
    expect(normalizePlanTail([rest(5), rest(5)])).toEqual([]);
  });
});

describe('focusPlanTotals', () => {
  it('separates work from rest and counts distinct tasks', () => {
    const steps = [work('a', 20, 1, 2), rest(5), work('a', 20, 2, 2), rest(15, true), work('b', 10)];
    expect(focusPlanTotals(steps)).toEqual({
      workMinutes: 50,
      restMinutes: 20,
      totalMinutes: 70,
      taskCount: 2,
      restCount: 2,
    });
  });
});

describe('plannedTaskMinutes', () => {
  it('takes the task at its word when it has one', () => {
    expect(plannedTaskMinutes(task('a', 45), OPTIONS)).toEqual({ minutes: 45, assumed: false });
  });

  it('falls back to the default stretch, and says that it did', () => {
    expect(plannedTaskMinutes(task('a', null), OPTIONS)).toEqual({ minutes: 25, assumed: true });
    expect(plannedTaskMinutes(task('a', 0), OPTIONS)).toEqual({ minutes: 25, assumed: true });
  });

  it('reads a chain step ahead of the task, same as the workload surfaces', () => {
    const chained: FocusPlanTask = {
      ...task('a', 90),
      chainEnabled: true,
      chainIndex: 1,
      chainItems: [
        { id: 'c1', title: 'first', estimatedMinutes: 10 },
        { id: 'c2', title: 'second', estimatedMinutes: 20 },
      ],
    };
    expect(plannedTaskMinutes(chained, OPTIONS)).toEqual({ minutes: 20, assumed: false });
  });

  it('agrees with what the builder charges', () => {
    const t = task('a', null);
    expect(planTotalMinutes([t], OPTIONS)).toBe(plannedTaskMinutes(t, OPTIONS).minutes);
  });
});

describe('planTotalMinutes', () => {
  it('counts the breaks, not just the work', () => {
    // 25 + 25 of work, with the 25-minute trigger putting a 5-minute break
    // between them: 55 minutes of wall clock for 50 minutes of estimates.
    expect(planTotalMinutes([task('a', 25), task('b', 25)], OPTIONS)).toBe(55);
  });

  it('matches the estimates exactly when no break fits', () => {
    expect(planTotalMinutes([task('a', 10), task('b', 10)], OPTIONS)).toBe(20);
  });

  it('charges the default stretch for a task with no estimate', () => {
    expect(planTotalMinutes([task('a', null)], OPTIONS)).toBe(OPTIONS.defaultWorkMinutes);
  });

  it('is zero for an empty queue', () => {
    expect(planTotalMinutes([], OPTIONS)).toBe(0);
  });
});

describe('reading a session against the clock', () => {
  const t0 = Date.parse('2026-08-22T09:00:00.000Z');

  it('counts nothing while a session has never been started', () => {
    const s = session([work('a', 25)]);
    expect(focusStepElapsed(s, t0)).toBe(0);
    expect(focusStepRemaining(s, t0)).toBe(25 * 60);
    expect(isFocusRunning(s)).toBe(false);
  });

  it('counts the segment in flight on top of what is banked', () => {
    const s = session([work('a', 25)], {
      stepStartedAt: new Date(t0).toISOString(),
      stepElapsedSeconds: 60,
    });
    expect(focusStepElapsed(s, t0 + 120_000)).toBe(180);
    expect(focusStepRemaining(s, t0 + 120_000)).toBe(25 * 60 - 180);
    expect(focusStepProgress(s, t0 + 120_000)).toBeCloseTo(180 / 1500);
  });

  it('ignores a clock that moved backwards rather than rewinding the step', () => {
    const s = session([work('a', 25)], { stepStartedAt: new Date(t0).toISOString(), stepElapsedSeconds: 60 });
    expect(focusStepElapsed(s, t0 - 600_000)).toBe(60);
  });

  it('lets remaining go negative so an over-run is visible', () => {
    const s = session([work('a', 1)], { stepStartedAt: new Date(t0).toISOString() });
    expect(focusStepRemaining(s, t0 + 90_000)).toBe(-30);
    expect(isFocusStepDone(s, t0 + 90_000)).toBe(true);
    expect(focusStepProgress(s, t0 + 90_000)).toBe(1);
  });

  it('does not advance on its own when a step runs out', () => {
    const s = session([work('a', 1), rest(5)], { stepStartedAt: new Date(t0).toISOString() });
    // An hour later the session is still sitting on step 0, over-run.
    expect(isFocusStepDone(s, t0 + 3_600_000)).toBe(true);
    expect(currentFocusStep(s)).toEqual(work('a', 1));
    expect(s.stepIndex).toBe(0);
  });

  it('reports a finished plan once the cursor runs off the end', () => {
    const s = session([work('a', 25)], { stepIndex: 1 });
    expect(isFocusSessionFinished(s)).toBe(true);
    expect(currentFocusStep(s)).toBeNull();
    expect(focusStepRemaining(s, t0)).toBe(0);
    expect(focusRemainingMinutes(s, t0)).toBe(0);
    expect(focusProjectedEnd(s, t0)).toBeNull();
  });

  it('projects the finish from what is left of this step plus every step after', () => {
    const s = session([work('a', 25), rest(5), work('b', 10)], {
      stepStartedAt: new Date(t0).toISOString(),
    });
    expect(focusRemainingMinutes(s, t0 + 5 * 60_000)).toBe(20 + 5 + 10);
    expect(focusProjectedEnd(s, t0 + 5 * 60_000)?.toISOString())
      .toBe(new Date(t0 + 40 * 60_000).toISOString());
  });

  it('stops crediting an over-run step against the projection', () => {
    const s = session([work('a', 1), work('b', 10)], { stepStartedAt: new Date(t0).toISOString() });
    expect(focusRemainingMinutes(s, t0 + 600_000)).toBe(10);
  });

  it('lists a task’s stretches that are still ahead', () => {
    const s = session([work('a', 20, 1, 2), rest(5), work('a', 20, 2, 2)], { stepIndex: 1 });
    expect(upcomingStepsForTask(s, 'a')).toEqual([work('a', 20, 2, 2)]);
  });
});

describe('focusMeasuredMinutes', () => {
  const t0 = Date.parse('2026-08-22T09:00:00.000Z');

  it('is null on a rest step', () => {
    const s = session([rest(5)], { stepStartedAt: new Date(t0).toISOString() });
    expect(focusMeasuredMinutes(s, t0 + 300_000)).toBeNull();
  });

  it('is null on a split task, which the session has no way to measure in full', () => {
    const s = session([work('a', 20, 1, 2)], { stepStartedAt: new Date(t0).toISOString() });
    expect(focusMeasuredMinutes(s, t0 + 1_200_000)).toBeNull();
  });

  it('rounds the elapsed time on a single-stretch task', () => {
    const s = session([work('a', 25)], { stepStartedAt: new Date(t0).toISOString() });
    expect(focusMeasuredMinutes(s, t0 + 42 * 60_000)).toBe(42);
  });

  it('counts banked time from a pause on top of the segment in flight', () => {
    const s = session([work('a', 25)], {
      stepStartedAt: new Date(t0).toISOString(),
      stepElapsedSeconds: 10 * 60,
    });
    expect(focusMeasuredMinutes(s, t0 + 5 * 60_000)).toBe(15);
  });

  it('floors at one minute rather than reporting zero', () => {
    const s = session([work('a', 25)], { stepStartedAt: new Date(t0).toISOString() });
    expect(focusMeasuredMinutes(s, t0 + 10_000)).toBe(1);
  });
});

describe('moving through a plan', () => {
  const t0 = Date.parse('2026-08-22T09:00:00.000Z');
  const t1 = t0 + 600_000;

  it('advances, resets the step clock, and keeps running', () => {
    const s = session([work('a', 25), rest(5)], {
      stepStartedAt: new Date(t0).toISOString(),
      stepElapsedSeconds: 30,
    });
    const next = advanceFocusSession(s, t1);
    expect(next.stepIndex).toBe(1);
    expect(next.stepElapsedSeconds).toBe(0);
    expect(next.stepStartedAt).toBe(new Date(t1).toISOString());
  });

  it('advances into a paused step when the session was paused', () => {
    const s = session([work('a', 25), rest(5)], { stepElapsedSeconds: 30 });
    expect(advanceFocusSession(s, t1).stepStartedAt).toBeNull();
  });

  it('will not advance past the end', () => {
    const s = session([work('a', 25)], { stepIndex: 1 });
    expect(advanceFocusSession(s, t1)).toBe(s);
  });

  it('banks the segment in flight on pause and picks it back up on resume', () => {
    const running = session([work('a', 25)], { stepStartedAt: new Date(t0).toISOString() });
    const paused = pauseFocusSession(running, t1);
    expect(paused.stepElapsedSeconds).toBe(600);
    expect(paused.stepStartedAt).toBeNull();

    const resumed = resumeFocusSession(paused, t1 + 60_000);
    expect(resumed.stepElapsedSeconds).toBe(600);
    expect(focusStepElapsed(resumed, t1 + 120_000)).toBe(660);
  });

  it('returns the same session for a pause or resume that changes nothing', () => {
    const paused = session([work('a', 25)]);
    expect(pauseFocusSession(paused, t1)).toBe(paused);
    const running = session([work('a', 25)], { stepStartedAt: new Date(t0).toISOString() });
    expect(resumeFocusSession(running, t1)).toBe(running);
  });

  it('will not resume a finished session', () => {
    const done = session([work('a', 25)], { stepIndex: 1 });
    expect(resumeFocusSession(done, t1)).toBe(done);
  });
});

describe('pruneFocusPlan', () => {
  const t0 = Date.parse('2026-08-22T09:00:00.000Z');

  it('returns the same session when nothing matched', () => {
    const s = session([work('a', 25), rest(5), work('b', 25)]);
    expect(pruneFocusPlan(s, () => false, t0)).toBe(s);
  });

  it('drops a task’s remaining stretches and lands on the break it earned', () => {
    const s = session([work('a', 20, 1, 2), rest(5), work('a', 20, 2, 2), rest(5), work('b', 25)], {
      stepStartedAt: new Date(t0).toISOString(),
      stepElapsedSeconds: 120,
    });
    const next = pruneFocusPlan(s, id => id === 'a', t0);
    expect(shape(next.steps)).toEqual(['rest 5', 'b 25 (1/1)']);
    expect(next.stepIndex).toBe(0);
    expect(currentFocusStep(next)).toEqual(rest(5));
  });

  it('gives the replacement step a fresh clock', () => {
    const s = session([work('a', 25), work('b', 25)], {
      stepStartedAt: new Date(t0).toISOString(),
      stepElapsedSeconds: 120,
    });
    const next = pruneFocusPlan(s, id => id === 'a', t0 + 60_000);
    expect(next.stepElapsedSeconds).toBe(0);
    expect(next.stepStartedAt).toBe(new Date(t0 + 60_000).toISOString());
  });

  it('leaves the current step’s clock alone when something further ahead was dropped', () => {
    const s = session([work('a', 25), rest(5), work('b', 25)], {
      stepStartedAt: new Date(t0).toISOString(),
      stepElapsedSeconds: 120,
    });
    const next = pruneFocusPlan(s, id => id === 'b', t0 + 60_000);
    expect(shape(next.steps)).toEqual(['a 25 (1/1)']);
    expect(next.stepElapsedSeconds).toBe(120);
    expect(next.stepStartedAt).toBe(s.stepStartedAt);
  });

  it('keeps the steps already behind the cursor as the record of what ran', () => {
    const s = session([work('a', 25), rest(5), work('b', 25), work('a', 10)], { stepIndex: 2 });
    const next = pruneFocusPlan(s, id => id === 'a', t0);
    expect(shape(next.steps)).toEqual(['a 25 (1/1)', 'rest 5', 'b 25 (1/1)']);
    expect(next.stepIndex).toBe(2);
  });

  it('finishes the session when the last of the work is dropped', () => {
    const s = session([work('a', 25), rest(5), work('b', 25)], {
      stepIndex: 1,
      stepStartedAt: new Date(t0).toISOString(),
    });
    const next = pruneFocusPlan(s, id => id === 'b', t0);
    expect(isFocusSessionFinished(next)).toBe(true);
    expect(next.stepStartedAt).toBeNull();
  });

  it('leaves a finished session alone', () => {
    const s = session([work('a', 25)], { stepIndex: 1 });
    expect(pruneFocusPlan(s, () => true, t0)).toBe(s);
  });
});
