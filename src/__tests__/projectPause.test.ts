import { PLANNING_PAUSE_KEY, pauseSignature, isPausedOn, isPlanning, isProjectPaused, notifyPauseEnded, pauseEndedByChange, pauseEndsOn, projectPausedUntil, registerPauseEndListener, registerPausedProjectSource } from '../utils/projectPause';

afterEach(() => registerPausedProjectSource(null));

describe('isPausedOn', () => {
  it('holds until the day before and lifts on the day itself', () => {
    const project = { pausedUntil: '2026-03-01' };
    expect(isPausedOn(project, '2026-02-28')).toBe(true);
    expect(isPausedOn(project, '2026-03-01')).toBe(false);
  });

  it('is never paused without a date', () => {
    expect(isPausedOn({ pausedUntil: null }, '2026-02-28')).toBe(false);
  });
});

describe('isPlanning', () => {
  it('is a pause no day lifts, and only that pause', () => {
    const planning = { pausedUntil: PLANNING_PAUSE_KEY };
    expect(isPlanning(planning)).toBe(true);
    expect(isPausedOn(planning, '2999-06-01')).toBe(true);
    expect(isPlanning({ pausedUntil: '2026-03-01' })).toBe(false);
    expect(isPlanning({ pausedUntil: null })).toBe(false);
  });
});

describe('isProjectPaused', () => {
  it('answers from the registered projects', () => {
    const projects = [
      { id: 'garden', pausedUntil: '2026-03-01', archived: false, completed: false },
      { id: 'car', pausedUntil: null, archived: false, completed: false },
    ];
    registerPausedProjectSource(() => projects);
    expect(isProjectPaused('garden', '2026-01-10')).toBe(true);
    expect(isProjectPaused('car', '2026-01-10')).toBe(false);
  });

  it('pauses nothing with no source registered', () => {
    expect(isProjectPaused('garden', '2026-01-10')).toBe(false);
  });
});

describe('projectPausedUntil', () => {
  it('says the day a paused project comes back, and nothing otherwise', () => {
    registerPausedProjectSource(() => [
      { id: 'garden', pausedUntil: '2026-03-01', archived: false, completed: false },
      { id: 'car', pausedUntil: null, archived: false, completed: false },
    ]);
    expect(projectPausedUntil('garden', '2026-01-10')).toBe('2026-03-01');
    expect(projectPausedUntil('garden', '2026-03-01')).toBeNull();
    expect(projectPausedUntil('car', '2026-01-10')).toBeNull();
  });
});

describe('when a pause ends', () => {
  const today = '2026-10-10';

  it('finds every dated pause that has run out, and never Planning', () => {
    const ends = pauseEndsOn([
      { id: 'lifted', pausedUntil: '2026-10-10' },
      { id: 'long-ago', pausedUntil: '2026-01-05' },
      { id: 'still', pausedUntil: '2026-10-11' },
      { id: 'planning', pausedUntil: PLANNING_PAUSE_KEY },
      { id: 'never', pausedUntil: null },
    ], today);
    expect([...ends]).toEqual([['lifted', '2026-10-10'], ['long-ago', '2026-01-05']]);
  });

  it('ends a pause cut short today, and one that had already lifted on its own day', () => {
    expect(pauseEndedByChange('2026-10-20', null, today)).toBe(today);
    expect(pauseEndedByChange(PLANNING_PAUSE_KEY, null, today)).toBe(today);
    expect(pauseEndedByChange('2026-10-08', null, today)).toBe('2026-10-08');
    // Moved to a day still to come: not ended.
    expect(pauseEndedByChange('2026-10-20', '2026-10-25', today)).toBeNull();
    expect(pauseEndedByChange(null, '2026-10-25', today)).toBeNull();
    expect(pauseEndedByChange('2026-10-20', '2026-10-20', today)).toBeNull();
  });

  it('tells whoever is listening, and nobody when no one is', () => {
    const heard: [string, string][] = [];
    registerPauseEndListener((id, on) => heard.push([id, on]));
    notifyPauseEnded('garden', today);
    registerPauseEndListener(null);
    notifyPauseEnded('garden', today);
    expect(heard).toEqual([['garden', today]]);
  });
});

describe('pauseSignature', () => {
  const p = (id: string, pausedUntil: string | null) => ({ id, pausedUntil });

  it('changes when a pause is set, moved or lifted', () => {
    const none = pauseSignature([p('a', null), p('b', null)]);
    const set = pauseSignature([p('a', '2026-03-01'), p('b', null)]);
    const moved = pauseSignature([p('a', '2026-04-01'), p('b', null)]);
    expect(new Set([none, set, moved]).size).toBe(3);
    expect(pauseSignature([p('a', null), p('b', null)])).toBe(none);
  });

  it('does not depend on the order projects are listed in', () => {
    expect(pauseSignature([p('a', '2026-03-01'), p('b', '2026-04-01')]))
      .toBe(pauseSignature([p('b', '2026-04-01'), p('a', '2026-03-01')]));
  });

  it('is empty when nothing is paused', () => {
    expect(pauseSignature([])).toBe('');
    expect(pauseSignature([p('a', null)])).toBe('');
  });
});
