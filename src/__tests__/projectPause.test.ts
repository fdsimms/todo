import { PLANNING_PAUSE_KEY, isPausedOn, isPlanning, isProjectPaused, projectPausedUntil, registerPausedProjectSource } from '../utils/projectPause';

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
