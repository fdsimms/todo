import type { WorkoutSet } from '../types';
import { WORKOUT_OPEN_URL, planWorkoutLink, workoutLinkUrl, type WorkoutLink } from '../utils/workoutLink';

const DONE = '2026-10-18T09:00:00.000Z';

function set(id: string, setIndex: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id,
    sessionId: 'w1',
    exerciseId: 'lib:barbell-bench-press',
    position: 0,
    setIndex,
    kind: 'working',
    weightKg: 82.5,
    reps: 8,
    durationSeconds: null,
    distanceM: null,
    rpe: null,
    completedAt: null,
    supersetKey: null,
    note: null,
    ...extra,
  };
}

const link = (extra: Partial<WorkoutLink>): WorkoutLink => ({ verb: null, sessionId: 'w1', setId: null, restId: null, ...extra });
const live = { id: 'w1' };
const rest = { id: 'r1', sessionId: 'w1' };
const sets = [set('a', 0, { completedAt: DONE }), set('b', 1), set('c', 2)];

describe('workoutLinkUrl', () => {
  it('builds each button’s link, naming what it acts on', () => {
    expect(workoutLinkUrl('set-done', 'w1', { set: 'b' })).toBe('dundundun://workout?do=set-done&session=w1&set=b');
    expect(workoutLinkUrl('rest-add', 'w1', { rest: 'r1' })).toBe('dundundun://workout?do=rest-add&session=w1&rest=r1');
    expect(workoutLinkUrl('skip-rest', 'w1')).toBe('dundundun://workout?do=skip-rest&session=w1');
  });

  it('escapes what it carries', () => {
    expect(workoutLinkUrl('set-done', 'a b', { set: 'x&y' })).toBe('dundundun://workout?do=set-done&session=a%20b&set=x%26y');
  });

  it('has a bare link that only opens', () => {
    expect(WORKOUT_OPEN_URL).toBe('dundundun://workout');
  });
});

describe('planWorkoutLink', () => {
  it('logs the set it names while that set is still the next one open', () => {
    expect(planWorkoutLink(link({ verb: 'set-done', setId: 'b' }), live, sets, rest)).toEqual({ kind: 'setDone', setId: 'b' });
  });

  it('never logs a set the app has moved past since the Lock Screen was drawn', () => {
    // "b" was logged in the app; the stale button still names it.
    const moved = [set('a', 0, { completedAt: DONE }), set('b', 1, { completedAt: DONE }), set('c', 2)];
    expect(planWorkoutLink(link({ verb: 'set-done', setId: 'b' }), live, moved, rest)).toEqual({ kind: 'open' });
    // Nor a later set than the next one, nor a set the link doesn't name.
    expect(planWorkoutLink(link({ verb: 'set-done', setId: 'c' }), live, sets, rest)).toEqual({ kind: 'open' });
    expect(planWorkoutLink(link({ verb: 'set-done' }), live, sets, rest)).toEqual({ kind: 'open' });
  });

  it('does nothing once every set is done', () => {
    const allDone = sets.map(s => ({ ...s, completedAt: DONE }));
    expect(planWorkoutLink(link({ verb: 'set-done', setId: 'c' }), live, allDone, rest)).toEqual({ kind: 'open' });
  });

  it('acts only for the session in progress', () => {
    expect(planWorkoutLink(link({ verb: 'set-done', setId: 'b', sessionId: 'w0' }), live, sets, rest)).toEqual({ kind: 'open' });
    expect(planWorkoutLink(link({ verb: 'set-done', setId: 'b' }), null, sets, rest)).toEqual({ kind: 'open' });
    expect(planWorkoutLink(link({ verb: 'skip-rest', sessionId: null }), live, sets, rest)).toEqual({ kind: 'open' });
  });

  it('nudges and skips the rest it names', () => {
    expect(planWorkoutLink(link({ verb: 'rest-add', restId: 'r1' }), live, sets, rest)).toEqual({ kind: 'restAdd', restId: 'r1' });
    expect(planWorkoutLink(link({ verb: 'skip-rest', restId: 'r1' }), live, sets, rest)).toEqual({ kind: 'skipRest', restId: 'r1' });
  });

  it('leaves a rest alone that replaced the one the button was drawn about', () => {
    const newer = { id: 'r2', sessionId: 'w1' };
    expect(planWorkoutLink(link({ verb: 'skip-rest', restId: 'r1' }), live, sets, newer)).toEqual({ kind: 'open' });
    expect(planWorkoutLink(link({ verb: 'rest-add', restId: 'r1' }), live, sets, newer)).toEqual({ kind: 'open' });
  });

  it('takes the session’s current rest for a link that names none', () => {
    expect(planWorkoutLink(link({ verb: 'skip-rest' }), live, sets, rest)).toEqual({ kind: 'skipRest', restId: 'r1' });
  });

  it('does nothing to a rest that is gone or belongs to another session', () => {
    expect(planWorkoutLink(link({ verb: 'rest-add', restId: 'r1' }), live, sets, null)).toEqual({ kind: 'open' });
    expect(planWorkoutLink(link({ verb: 'rest-add', restId: 'r1' }), live, sets, { id: 'r1', sessionId: 'w0' })).toEqual({ kind: 'open' });
  });

  it('only opens for the bare link', () => {
    expect(planWorkoutLink(link({}), live, sets, rest)).toEqual({ kind: 'open' });
  });
});
