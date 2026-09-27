import { isPausedOn, isProjectPaused, registerPausedProjectSource } from '../utils/projectPause';

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
