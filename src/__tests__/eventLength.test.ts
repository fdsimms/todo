import { describeEventLength, lengthToClock } from '../utils/eventLength';

describe('describeEventLength', () => {
  it('reads minutes, hours and both', () => {
    expect(describeEventLength(30)).toBe('30m');
    expect(describeEventLength(60)).toBe('1h');
    expect(describeEventLength(80)).toBe('1h 20m');
    expect(describeEventLength(150)).toBe('2h 30m');
  });
});

describe('lengthToClock', () => {
  it('measures to a later time the same day', () => {
    expect(lengthToClock(new Date(2026, 9, 24, 19, 0), new Date(2026, 9, 24, 20, 20))).toBe(80);
  });

  it('rolls an end at or before the start onto the next day', () => {
    expect(lengthToClock(new Date(2026, 9, 24, 22, 0), new Date(2026, 9, 24, 1, 0))).toBe(180);
    expect(lengthToClock(new Date(2026, 9, 24, 19, 0), new Date(2026, 9, 24, 19, 0))).toBe(1440);
  });
});
