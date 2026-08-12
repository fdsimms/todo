import {
  activeSegment,
  activeSegmentIndex,
  apportionedMinutes,
  segmentMinutesOf,
  segmentPhase,
  segmentRemaining,
  timerSegments,
  type SegmentSource,
} from '../utils/timerSegments';

const sub = (title: string, timedMinutes: number | null = null): SegmentSource =>
  ({ id: title, title, timedMinutes });

const practice = [sub('Scales', 5), sub('Known pieces', 10), sub('New piece', 10)];

describe('segmentMinutesOf', () => {
  it('reads a subtask\'s own stretch', () => {
    expect(segmentMinutesOf({ timedMinutes: 5 })).toBe(5);
  });

  it('treats no minutes and a non-positive number alike — neither is a stretch', () => {
    expect(segmentMinutesOf({ timedMinutes: null })).toBeNull();
    expect(segmentMinutesOf({ timedMinutes: 0 })).toBeNull();
    expect(segmentMinutesOf({ timedMinutes: -5 })).toBeNull();
  });
});

describe('timerSegments', () => {
  it('lays the stretches end to end in subtask order', () => {
    expect(timerSegments(practice)).toEqual([
      { id: 'Scales', title: 'Scales', minutes: 5, startSeconds: 0, endSeconds: 300 },
      { id: 'Known pieces', title: 'Known pieces', minutes: 10, startSeconds: 300, endSeconds: 900 },
      { id: 'New piece', title: 'New piece', minutes: 10, startSeconds: 900, endSeconds: 1500 },
    ]);
  });

  it('skips subtasks with no minutes rather than giving them a zero-length stretch', () => {
    const segments = timerSegments([sub('Set up'), sub('Scales', 5), sub('Tidy away')]);
    expect(segments.map(s => s.title)).toEqual(['Scales']);
    expect(segments[0]).toMatchObject({ startSeconds: 0, endSeconds: 300 });
  });

  it('is empty when nothing carries a stretch', () => {
    expect(timerSegments([sub('Set up'), sub('Tidy away')])).toEqual([]);
    expect(timerSegments([])).toEqual([]);
  });
});

describe('apportionedMinutes', () => {
  it('sums the stretches — that total is the task\'s countdown', () => {
    expect(apportionedMinutes(practice)).toBe(25);
  });

  it('ignores subtasks with no stretch', () => {
    expect(apportionedMinutes([sub('Set up'), sub('Scales', 5)])).toBe(5);
  });

  it('is null when nothing is apportioned, so the task keeps its own duration', () => {
    expect(apportionedMinutes([sub('Set up'), sub('Tidy away')])).toBeNull();
    expect(apportionedMinutes([])).toBeNull();
  });
});

describe('activeSegmentIndex', () => {
  const segments = timerSegments(practice);

  it('starts on the first stretch', () => {
    expect(activeSegmentIndex(segments, 0)).toBe(0);
  });

  it('follows the clock through the stretches', () => {
    expect(activeSegmentIndex(segments, 299)).toBe(0);
    expect(activeSegmentIndex(segments, 301)).toBe(1);
    expect(activeSegmentIndex(segments, 1200)).toBe(2);
  });

  it('hands the boundary instant to the stretch starting, not the one ending', () => {
    expect(activeSegmentIndex(segments, 300)).toBe(1);
    expect(activeSegmentIndex(segments, 900)).toBe(2);
  });

  it('has no stretch once the run is past the last one', () => {
    expect(activeSegmentIndex(segments, 1500)).toBe(-1);
    expect(activeSegmentIndex(segments, 9000)).toBe(-1);
  });

  it('has no stretch when nothing is apportioned', () => {
    expect(activeSegmentIndex([], 60)).toBe(-1);
  });

  it('treats a clock that ran backwards as the start of the run', () => {
    expect(activeSegmentIndex(segments, -30)).toBe(0);
  });
});

describe('activeSegment', () => {
  const segments = timerSegments(practice);

  it('names the stretch the clock is inside', () => {
    expect(activeSegment(segments, 600)?.title).toBe('Known pieces');
  });

  it('is null past the end of the last stretch', () => {
    expect(activeSegment(segments, 1500)).toBeNull();
  });
});

describe('segmentPhase', () => {
  const segments = timerSegments(practice);

  it('sorts the stretches around the clock', () => {
    expect(segments.map(s => segmentPhase(s, 600))).toEqual(['done', 'active', 'upcoming']);
  });

  it('counts a stretch done from the instant it runs out', () => {
    expect(segmentPhase(segments[0], 300)).toBe('done');
    expect(segmentPhase(segments[0], 299)).toBe('active');
  });

  it('reads every stretch as upcoming before the run starts', () => {
    expect(segments.map(s => segmentPhase(s, 0))).toEqual(['active', 'upcoming', 'upcoming']);
  });
});

describe('segmentRemaining', () => {
  const segments = timerSegments(practice);

  it('counts down within the stretch', () => {
    expect(segmentRemaining(segments[0], 0)).toBe(300);
    expect(segmentRemaining(segments[1], 400)).toBe(500);
  });

  it('bottoms out at 0 rather than going negative like the task-level countdown', () => {
    expect(segmentRemaining(segments[0], 900)).toBe(0);
  });
});
