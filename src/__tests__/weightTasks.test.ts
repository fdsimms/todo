import type { Task } from '../types';
import {
  DEFAULT_WEIGH_IN_EVERY_DAYS,
  WEIGH_IN_EVERY_DAYS_MAX,
  WEIGH_IN_EVERY_DAYS_MIN,
  WEIGH_IN_LINK_URL,
  WEIGH_IN_TITLE,
  clampWeighInEveryDays,
  wantsWeighIn,
  weighInDayKey,
  weighInNotes,
} from '../utils/weightTasks';
import type { WeightPoint } from '../utils/weightLog';

function series(values: (number | null)[]): WeightPoint[] {
  return values.map((kilograms, i) => ({
    dayKey: `2026-09-${String(i + 1).padStart(2, '0')}`,
    kilograms,
  }));
}

function generated(kind: string | null, sourceId: string | null) {
  return {
    generatedKind: kind,
    generatedSourceId: sourceId,
  } as Pick<Task, 'generatedKind' | 'generatedSourceId'>;
}

describe('clampWeighInEveryDays', () => {
  it('leaves a sensible value alone', () => {
    expect(clampWeighInEveryDays(7)).toBe(7);
    expect(clampWeighInEveryDays(1)).toBe(1);
    expect(clampWeighInEveryDays(30)).toBe(30);
  });

  it('clamps to the floor and ceiling', () => {
    expect(clampWeighInEveryDays(0)).toBe(WEIGH_IN_EVERY_DAYS_MIN);
    expect(clampWeighInEveryDays(-5)).toBe(WEIGH_IN_EVERY_DAYS_MIN);
    expect(clampWeighInEveryDays(365)).toBe(WEIGH_IN_EVERY_DAYS_MAX);
  });

  it('rounds a fractional value', () => {
    expect(clampWeighInEveryDays(6.4)).toBe(6);
    expect(clampWeighInEveryDays(6.6)).toBe(7);
  });

  it('falls back to the default for a non-number', () => {
    expect(clampWeighInEveryDays(Number.NaN)).toBe(DEFAULT_WEIGH_IN_EVERY_DAYS);
    expect(clampWeighInEveryDays(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WEIGH_IN_EVERY_DAYS);
  });
});

describe('wantsWeighIn', () => {
  it('asks when the window holds no weigh-in at all', () => {
    expect(wantsWeighIn(series([null, null, null, null, null, null, null]))).toBe(true);
  });

  it('stays quiet when the window holds one', () => {
    // The gap is the trigger, so somebody who weighs themselves unprompted
    // never sees this task.
    expect(wantsWeighIn(series([null, null, 72.4, null, null, null, null]))).toBe(false);
  });

  it('stays quiet when the only reading is on the very first day of the window', () => {
    expect(wantsWeighIn(series([72.4, null, null, null, null, null, null]))).toBe(false);
  });

  it('stays quiet when the only reading is today', () => {
    expect(wantsWeighIn(series([null, null, null, null, null, null, 72.4]))).toBe(false);
  });

  it('asks for an empty window, which is what a read that found nothing looks like', () => {
    // The caller must not hand an empty array over for a *failed* read — see the
    // function's own note and checkWeighInTasks's null guard.
    expect(wantsWeighIn([])).toBe(true);
  });
});

describe('weighInDayKey', () => {
  it('reads the day key off a weigh-in task', () => {
    expect(weighInDayKey(generated('weighIn', '2026-09-10'))).toBe('2026-09-10');
  });

  it('refuses another generator’s task carrying the same source id', () => {
    // One column, twenty kinds: without the kind check a mood check-in for the
    // same day would read as a weigh-in request.
    expect(weighInDayKey(generated('moodLog', '2026-09-10'))).toBeNull();
  });

  it('is null for a task the user wrote', () => {
    expect(weighInDayKey(generated(null, null))).toBeNull();
  });
});

describe('weighInNotes', () => {
  it('states the gap and nothing else', () => {
    expect(weighInNotes(7)).toBe('Nothing recorded in Apple Health in the last 7 days.');
  });

  it('says "today" rather than "the last 1 days"', () => {
    expect(weighInNotes(1)).toBe('Nothing recorded in Apple Health today.');
  });

  it('clamps before it phrases, so a stored nonsense value cannot leak into copy', () => {
    expect(weighInNotes(9999)).toBe(
      `Nothing recorded in Apple Health in the last ${WEIGH_IN_EVERY_DAYS_MAX} days.`,
    );
  });

  it('never mentions a weight', () => {
    // The fence: the app may notice you have not recorded a number. It may not
    // notice what the number was.
    expect(weighInNotes(7)).not.toMatch(/\d+(\.\d+)?\s*(kg|lb)/i);
  });
});

describe('constants', () => {
  it('titles the task literally, with no target or encouragement', () => {
    expect(WEIGH_IN_TITLE).toBe('Record your weight');
  });

  it('links to the Weight screen with the sheet up', () => {
    // Ticking a request off without answering it records nothing, and unlike a
    // mood entry the answer cannot be reconstructed later.
    expect(WEIGH_IN_LINK_URL).toBe('dundundun://weight?log=1');
  });
});
