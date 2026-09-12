import { PRIORITY_SEGMENTS } from '../utils/prioritySegments';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '../types';

describe('PRIORITY_SEGMENTS', () => {
  it('offers one segment per priority, in order', () => {
    expect(PRIORITY_SEGMENTS.map(s => s.value)).toEqual(PRIORITY_LABELS.map((_, i) => i));
  });

  it('uses the shared labels rather than its own words', () => {
    expect(PRIORITY_SEGMENTS.map(s => s.label)).toEqual([...PRIORITY_LABELS]);
  });

  // Every segment carries its colour, not only the chosen one: the dot is the
  // same one the task row draws, and ranking them at a glance is what it is
  // for. See the module's own note.
  it('gives every real priority its own dot', () => {
    for (const segment of PRIORITY_SEGMENTS.slice(1)) {
      expect(segment.dot).toBe(PRIORITY_COLORS[segment.value]);
    }
  });

  // "No priority" has no colour, and the missing swatch is the answer.
  it('gives the first option no dot', () => {
    expect(PRIORITY_SEGMENTS[0].value).toBe(0);
    expect(PRIORITY_SEGMENTS[0].dot).toBeUndefined();
  });
});
