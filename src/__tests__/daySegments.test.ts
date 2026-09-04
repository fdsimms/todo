import {
  DAY_SEGMENT_KEYS,
  applyDaySegmentTime,
  daySegmentsInOrder,
  type DaySegmentTimes,
} from '../utils/daySegments';

const DEFAULTS: DaySegmentTimes = {
  morning: '06:00',
  afternoon: '12:00',
  evening: '18:00',
  night: '21:00',
};

describe('applyDaySegmentTime', () => {
  it('sets the boundary and leaves the rest alone when the order already holds', () => {
    expect(applyDaySegmentTime(DEFAULTS, 'afternoon', '13:00')).toEqual({
      ...DEFAULTS, afternoon: '13:00',
    });
  });

  // The bug: streakWindowEnd reads a morning task's window as closing at
  // afternoonStart, so Morning at 14:00 over an Afternoon at 12:00 made the task
  // visible two hours after it was already late — and with streakRequiresWindow
  // on, isCompletionOnTime false for every completion it could ever have.
  it('carries the later boundaries along rather than leaving them behind', () => {
    expect(applyDaySegmentTime(DEFAULTS, 'morning', '14:00')).toEqual({
      morning: '14:00', afternoon: '14:00', evening: '18:00', night: '21:00',
    });
  });

  it('pushes only as far as it has to', () => {
    expect(applyDaySegmentTime(DEFAULTS, 'morning', '19:00')).toEqual({
      morning: '19:00', afternoon: '19:00', evening: '19:00', night: '21:00',
    });
  });

  // The one direction with nothing after it to give way: the edit lands as far
  // back as it can go rather than dragging three earlier boundaries with it.
  it('holds a boundary at its predecessor instead of starting before it', () => {
    expect(applyDaySegmentTime(DEFAULTS, 'evening', '09:00')).toEqual({
      ...DEFAULTS, evening: '12:00',
    });
  });

  it('never moves the boundary the user actually set, when it can hold it', () => {
    for (const key of DAY_SEGMENT_KEYS) {
      const next = applyDaySegmentTime(DEFAULTS, key, '23:30');
      expect(next[key]).toBe('23:30');
    }
  });

  it('leaves the four in order whatever is set on whichever one', () => {
    for (const key of DAY_SEGMENT_KEYS) {
      for (const hhmm of ['00:00', '05:59', '12:00', '17:45', '23:59']) {
        expect(daySegmentsInOrder(applyDaySegmentTime(DEFAULTS, key, hhmm))).toBe(true);
      }
    }
  });

  it('does not mutate what it was given', () => {
    const before = { ...DEFAULTS };
    applyDaySegmentTime(DEFAULTS, 'morning', '14:00');
    expect(DEFAULTS).toEqual(before);
  });

  // Setting the last one can't disturb anything, since nothing follows it.
  it('touches nothing else when the last boundary moves', () => {
    expect(applyDaySegmentTime(DEFAULTS, 'night', '22:30')).toEqual({
      ...DEFAULTS, night: '22:30',
    });
  });
});

describe('daySegmentsInOrder', () => {
  it('accepts the shipped defaults', () => {
    expect(daySegmentsInOrder(DEFAULTS)).toBe(true);
  });

  it('accepts two boundaries at the same minute, which collapses a segment rather than inverting one', () => {
    expect(daySegmentsInOrder({ ...DEFAULTS, afternoon: '06:00' })).toBe(true);
  });

  it('rejects a pair that is the wrong way round', () => {
    expect(daySegmentsInOrder({ ...DEFAULTS, morning: '14:00' })).toBe(false);
  });
});
