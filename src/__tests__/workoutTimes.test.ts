import { sameMinute, shiftDays, spanMinutes, withClock, workoutTimesProblem } from '../utils/workoutTimes';

const now = new Date(2026, 9, 21, 13, 0);
const opts = { now, healthLimited: false };

describe('workoutTimesProblem', () => {
  it('accepts a normal span', () => {
    expect(workoutTimesProblem(new Date(2026, 9, 21, 0, 12), new Date(2026, 9, 21, 0, 57), opts)).toBeNull();
  });

  it('refuses a finish at or before the start', () => {
    const start = new Date(2026, 9, 21, 9, 0);
    expect(workoutTimesProblem(start, start, opts)).toMatch(/finish after it starts/);
    expect(workoutTimesProblem(start, new Date(2026, 9, 21, 8, 0), opts)).toMatch(/finish after it starts/);
  });

  it('refuses a finish in the future', () => {
    expect(workoutTimesProblem(new Date(2026, 9, 21, 12, 0), new Date(2026, 9, 21, 13, 1), opts)).toMatch(/future/);
  });

  it('holds a workout bound for Health to a day', () => {
    const start = new Date(2026, 9, 19, 9, 0);
    const end = new Date(2026, 9, 20, 9, 1);
    expect(workoutTimesProblem(start, end, opts)).toBeNull();
    expect(workoutTimesProblem(start, end, { ...opts, healthLimited: true })).toMatch(/up to a day/);
  });
});

describe('helpers', () => {
  it('moves a time to another clock on its own day, clearing seconds', () => {
    const out = withClock(new Date(2026, 9, 21, 0, 12, 30), new Date(2026, 0, 1, 18, 5));
    expect(out).toEqual(new Date(2026, 9, 21, 18, 5, 0, 0));
  });

  it('shifts by calendar days', () => {
    expect(shiftDays(new Date(2026, 9, 21, 6, 30), -1)).toEqual(new Date(2026, 9, 20, 6, 30));
  });

  it('counts whole minutes and never goes negative', () => {
    expect(spanMinutes(new Date(2026, 9, 21, 0, 12), new Date(2026, 9, 21, 0, 57, 40))).toBe(45);
    expect(spanMinutes(new Date(2026, 9, 21, 1, 0), new Date(2026, 9, 21, 0, 0))).toBe(0);
  });

  it('compares to the minute', () => {
    expect(sameMinute(new Date(2026, 9, 21, 0, 12, 5), new Date(2026, 9, 21, 0, 12, 50))).toBe(true);
    expect(sameMinute(new Date(2026, 9, 21, 0, 12), new Date(2026, 9, 21, 0, 13))).toBe(false);
  });
});
