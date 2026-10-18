import type { WorkoutSession } from '../types';
import {
  MAX_PENDING_CLASHES,
  clashPrompt,
  describeSpan,
  nextClash,
  overlappingSessions,
  parseWatchClashes,
  sessionToDelete,
  withClash,
  withoutClash,
} from '../utils/watchWorkoutClash';

const NOW = new Date(2026, 9, 18, 19, 30);
const at = (h: number, m: number, day = 18) => new Date(2026, 9, day, h, m).toISOString();

const session = (id: string, startedAt: string, endedAt: string | null, extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id,
  routineId: null,
  programId: null,
  taskId: null,
  title: 'Push A',
  startedAt,
  endedAt,
  notes: '',
  effort: null,
  healthWorkoutId: null,
  healthWritePending: false,
  ...extra,
});

describe('overlappingSessions', () => {
  const watch = session('watch', at(18, 0), at(18, 50));

  it('finds a session whose span overlaps, and leaves the session itself out', () => {
    const sessions = [watch, session('phone', at(18, 30), at(19, 10)), session('morning', at(7, 0), at(7, 45))];
    expect(overlappingSessions(watch, sessions, NOW)).toEqual(['phone']);
  });

  it('counts two workouts back to back as two in a row, not two at once', () => {
    expect(overlappingSessions(watch, [session('after', at(18, 50), at(19, 20))], NOW)).toEqual([]);
    expect(overlappingSessions(watch, [session('before', at(17, 0), at(18, 0))], NOW)).toEqual([]);
  });

  it('reads a workout still going on the phone as running until now', () => {
    expect(overlappingSessions(watch, [session('live', at(18, 40), null)], NOW)).toEqual(['live']);
    expect(overlappingSessions(watch, [session('later', at(19, 0), null)], NOW)).toEqual([]);
  });

  it('skips a session whose times can’t be read', () => {
    expect(overlappingSessions(watch, [session('bad', 'never', at(18, 10))], NOW)).toEqual([]);
  });
});

describe('the pending list', () => {
  const a = { watchSessionId: 'watch', otherSessionId: 'phone' };
  const b = { watchSessionId: 'watch2', otherSessionId: 'phone2' };

  it('reads what was stored, dropping anything malformed', () => {
    expect(parseWatchClashes(null)).toEqual([]);
    expect(parseWatchClashes('not json')).toEqual([]);
    expect(parseWatchClashes(JSON.stringify([a, { watchSessionId: '' }, 4, b]))).toEqual([a, b]);
  });

  it('adds a pair once, and never a session against itself', () => {
    expect(withClash(withClash([], a), a)).toEqual([a]);
    expect(withClash([], { watchSessionId: 'x', otherSessionId: 'x' })).toEqual([]);
  });

  it('keeps no more than the ceiling, oldest dropped first', () => {
    let list = [a];
    for (let i = 0; i < MAX_PENDING_CLASHES; i++) list = withClash(list, { watchSessionId: `w${i}`, otherSessionId: `p${i}` });
    expect(list).toHaveLength(MAX_PENDING_CLASHES);
    expect(list).not.toContainEqual(a);
  });

  it('takes an answered pair off, with every other pair naming a session it deleted', () => {
    const c = { watchSessionId: 'watch', otherSessionId: 'phone3' };
    expect(withoutClash([a, b, c], a)).toEqual([b, c]);
    expect(withoutClash([a, b, c], a, ['watch'])).toEqual([b]);
  });
});

describe('nextClash', () => {
  const pair = { watchSessionId: 'watch', otherSessionId: 'phone' };

  it('asks about the first pair with both workouts still there', () => {
    const watch = session('watch', at(18, 0), at(18, 50));
    const phone = session('phone', at(18, 30), at(19, 10));
    expect(nextClash([pair], [watch, phone])).toEqual({ kind: 'ask', clash: pair, watch, other: phone });
  });

  it('drops a pair one of whose workouts has gone, rather than asking about it', () => {
    expect(nextClash([pair], [session('watch', at(18, 0), at(18, 50))])).toEqual({ kind: 'drop', clash: pair });
    expect(nextClash([], [])).toBeNull();
  });
});

describe('sessionToDelete', () => {
  const pair = { watchSessionId: 'watch', otherSessionId: 'phone' };
  it('names the session each answer deletes', () => {
    expect(sessionToDelete(pair, 'deleteWatch')).toBe('watch');
    expect(sessionToDelete(pair, 'deleteOther')).toBe('phone');
    expect(sessionToDelete(pair, 'keepBoth')).toBeNull();
  });
});

describe('the question', () => {
  it('names both times in the clock style chosen, and a day that isn’t today', () => {
    expect(describeSpan(session('w', at(18, 2), at(18, 54)), NOW, false)).toBe('6:02 PM to 6:54 PM');
    expect(describeSpan(session('w', at(18, 2), at(18, 54)), NOW, true)).toBe('18:02 to 18:54');
    expect(describeSpan(session('w', at(18, 2, 16), at(18, 54, 16)), NOW, false)).toBe('Oct 16, 6:02 PM to 6:54 PM');
    expect(describeSpan(session('w', at(18, 5), null), NOW, false)).toBe('since 6:05 PM');
  });

  it('says what happened, then what each button does', () => {
    const words = clashPrompt(
      session('w', at(18, 2), at(18, 54)),
      session('p', at(18, 5), at(18, 50), { title: 'Pull A' }),
      NOW,
      false,
      false,
    );
    expect(words).toEqual({
      title: 'Two workouts at the same time',
      message: 'Your Apple Watch saved “Push A” from 6:02 PM to 6:54 PM. Your iPhone has “Pull A” from 6:05 PM to 6:50 PM. Keep both, or delete the one you don’t want.',
      keepBoth: 'Keep both',
      deleteWatch: 'Delete the watch’s',
      deleteOther: 'Delete the iPhone’s',
    });
  });

  it('says a workout in progress is going, and names Apple Health only when either is in it', () => {
    const { message } = clashPrompt(session('w', at(18, 2), at(18, 54)), session('p', at(18, 5), null), NOW, false, true);
    expect(message).toContain('Your iPhone has “Push A” going since 6:05 PM.');
    expect(message).toMatch(/Deleting a workout also takes it out of Apple Health\.$/);
  });
});
