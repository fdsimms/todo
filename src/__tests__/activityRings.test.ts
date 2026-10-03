import {
  describeRing,
  isRingClosed,
  parseActivitySummary,
  ringFraction,
  ringsAccessibilityLabel,
  ringsSummaryLine,
} from '../utils/activityRings';

const summary = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    moveMode: 'activeEnergy',
    moveKcal: 312, moveGoalKcal: 500,
    exerciseMinutes: 18, exerciseGoalMinutes: 30,
    standHours: 7, standGoalHours: 12,
    ...over,
  });

describe('parseActivitySummary', () => {
  it('reads each ring as a total and a goal', () => {
    expect(parseActivitySummary(summary())).toEqual({
      move: { value: 312, goal: 500 },
      exercise: { value: 18, goal: 30 },
      stand: { value: 7, goal: 12 },
      moveByTime: false,
    });
  });

  it('answers null for no summary, junk, and a non-object', () => {
    expect(parseActivitySummary('null')).toBeNull();
    expect(parseActivitySummary('not json')).toBeNull();
    expect(parseActivitySummary('[1,2]')).toBeNull();
    expect(parseActivitySummary('7')).toBeNull();
  });

  it('answers null when no ring has a figure, rather than a card of nulls', () => {
    expect(parseActivitySummary(summary({
      moveKcal: null, exerciseMinutes: null, standHours: null,
    }))).toBeNull();
  });

  it('keeps a real zero and treats a goal of zero as no goal', () => {
    const rings = parseActivitySummary(summary({ moveKcal: 0, standGoalHours: 0 }))!;
    expect(rings.move).toEqual({ value: 0, goal: 500 });
    expect(rings.stand).toEqual({ value: 7, goal: null });
  });

  it('refuses negative and non-numeric figures', () => {
    const rings = parseActivitySummary(summary({ exerciseMinutes: -4, standHours: '7' }))!;
    expect(rings.exercise.value).toBeNull();
    expect(rings.stand.value).toBeNull();
  });

  // A Move ring counting minutes must not surface as a calorie figure, even if
  // a build sent one alongside it.
  it('drops the Move figures when the ring counts Move Time', () => {
    const rings = parseActivitySummary(summary({ moveMode: 'moveTime' }))!;
    expect(rings.moveByTime).toBe(true);
    expect(rings.move).toEqual({ value: null, goal: null });
    expect(rings.exercise.value).toBe(18);
  });
});

describe('ring arithmetic', () => {
  it('has no fraction unless it has both halves', () => {
    expect(ringFraction({ value: 250, goal: 500 })).toBe(0.5);
    expect(ringFraction({ value: null, goal: 500 })).toBeNull();
    expect(ringFraction({ value: 250, goal: null })).toBeNull();
    expect(ringFraction({ value: 0, goal: 500 })).toBe(0);
  });

  it('lets a closed ring pass one lap', () => {
    expect(ringFraction({ value: 750, goal: 500 })).toBe(1.5);
    expect(isRingClosed({ value: 500, goal: 500 })).toBe(true);
    expect(isRingClosed({ value: 499, goal: 500 })).toBe(false);
    expect(isRingClosed({ value: 500, goal: null })).toBe(false);
  });
});

describe('describeRing', () => {
  it('writes the figure against its goal, or alone without one', () => {
    expect(describeRing('move', { value: 312, goal: 500 })).toBe('312 / 500 cal');
    expect(describeRing('stand', { value: 7, goal: null })).toBe('7 hr');
    expect(describeRing('exercise', { value: null, goal: 30 })).toBeNull();
    expect(describeRing('move', { value: 1234.4, goal: 2000 })).toBe('1,234 / 2,000 cal');
  });
});

describe('ringsSummaryLine', () => {
  it("mirrors Fitness's line", () => {
    const rings = parseActivitySummary(summary())!;
    expect(ringsSummaryLine(rings)).toBe('312/500 cal · 18/30 min · 7/12 hr');
  });

  it('leaves a ring at zero out, as a zero step count is left out', () => {
    const rings = parseActivitySummary(summary({ exerciseMinutes: 0 }))!;
    expect(ringsSummaryLine(rings)).toBe('312/500 cal · 7/12 hr');
  });

  it('says nothing when every ring is still at zero', () => {
    const rings = parseActivitySummary(summary({ moveKcal: 0, exerciseMinutes: 0, standHours: 0 }))!;
    expect(ringsSummaryLine(rings)).toBeNull();
  });
});

describe('ringsAccessibilityLabel', () => {
  it('speaks each ring with a figure, and marks a closed one', () => {
    const rings = parseActivitySummary(summary({ exerciseMinutes: 30 }))!;
    expect(ringsAccessibilityLabel(rings))
      .toBe('Move 312 of 500 calories, Exercise 30 of 30 minutes (closed), Stand 7 of 12 hours');
  });

  it('leaves a ring with no figure out rather than reading it as zero', () => {
    const rings = parseActivitySummary(summary({ moveMode: 'moveTime' }))!;
    expect(ringsAccessibilityLabel(rings)).not.toMatch(/Move/);
  });
});
