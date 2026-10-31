// The settings table, as a Map the tests can inspect and carry across a
// simulated app restart.
const mockSettings = new Map<string, string>();
jest.mock('../db/database', () => ({
  dbGetSetting: (key: string) => mockSettings.get(key) ?? null,
  dbSetSetting: (key: string, value: string) => { mockSettings.set(key, value); },
  dbDeleteSetting: (key: string) => { mockSettings.delete(key); },
}));

import {
  COOK_POSITION_MAX_AGE_MS,
  clearCookPosition,
  restingCookPosition,
  saveCookPosition,
  saveCookSetup,
  savedCookPosition,
  savedCookSetup,
} from '../utils/cookPosition';

beforeEach(() => mockSettings.clear());

describe('cookPosition', () => {
  afterEach(() => clearCookPosition('r1'));

  it('rests at the start when no cook timer is running, even with a saved place', () => {
    saveCookPosition('r1', { rawIndex: 3, finished: false });
    expect(restingCookPosition('r1', false, true)).toEqual({ rawIndex: -1, finished: false });
    expect(restingCookPosition('r1', false, false)).toEqual({ rawIndex: 0, finished: false });
  });

  it('keeps the saved place while a cook timer is running', () => {
    saveCookPosition('r1', { rawIndex: 3, finished: false });
    expect(restingCookPosition('r1', true, true)).toEqual({ rawIndex: 3, finished: false });
  });

  it('falls back to the start when nothing was saved', () => {
    expect(restingCookPosition('r1', true, true)).toEqual({ rawIndex: -1, finished: false });
  });

  it('keeps the scale and picks, and drops them with the place', () => {
    saveCookSetup('r1', { scale: 2, choices: ['a'], overrides: [] });
    expect(savedCookSetup('r1')).toEqual({ scale: 2, choices: ['a'], overrides: [] });
    clearCookPosition('r1');
    expect(savedCookSetup('r1')).toBeNull();
  });

  it('clears a saved place', () => {
    saveCookPosition('r1', { rawIndex: 2, finished: true });
    clearCookPosition('r1');
    expect(savedCookPosition('r1')).toBeNull();
  });
});

describe('cookPosition: surviving the app being killed', () => {
  afterEach(() => {
    jest.useRealTimers();
    clearCookPosition('r1');
  });

  // A fresh module registry has an empty in-memory cache, which is what a
  // cold launch from the Live Activity looks like. The settings table carries over.
  function coldStart(): typeof import('../utils/cookPosition') {
    let fresh!: typeof import('../utils/cookPosition');
    jest.isolateModules(() => {
      fresh = require('../utils/cookPosition');
    });
    return fresh;
  }

  it('resumes the step and the setup after a restart while the cook timer runs', () => {
    saveCookPosition('r1', { rawIndex: 4, finished: false, stepId: 's-bake' });
    saveCookSetup('r1', { scale: 2, choices: ['yellow'], overrides: [] });

    const relaunched = coldStart();
    expect(relaunched.restingCookPosition('r1', true, true, ['s-a', 's-bake'])).toEqual(
      expect.objectContaining({ rawIndex: 1, finished: false }),
    );
    expect(relaunched.savedCookSetup('r1')).toEqual({ scale: 2, choices: ['yellow'], overrides: [] });
  });

  it('still rests at the start after a restart when the cook timer is not running', () => {
    saveCookPosition('r1', { rawIndex: 4, finished: false });
    expect(coldStart().restingCookPosition('r1', false, true)).toEqual({ rawIndex: -1, finished: false });
  });

  it('forgets a cleared place across a restart', () => {
    saveCookPosition('r1', { rawIndex: 4, finished: false });
    clearCookPosition('r1');
    expect(coldStart().savedCookPosition('r1')).toBeNull();
  });

  it('treats a place left from an earlier sitting as gone', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 31, 12));
    saveCookPosition('r1', { rawIndex: 4, finished: false });
    jest.setSystemTime(new Date(2026, 9, 31, 12).getTime() + COOK_POSITION_MAX_AGE_MS + 1);
    expect(coldStart().savedCookPosition('r1')).toBeNull();
    expect(savedCookPosition('r1')).toBeNull();
  });

  it('ignores a row that is not a saved place', () => {
    mockSettings.set('cookPosition:r1', 'not json');
    expect(coldStart().savedCookPosition('r1')).toBeNull();
  });
});

describe('restingCookPosition: a step moved while the sheet was closed', () => {
  afterEach(() => clearCookPosition('r1'));

  it('resumes on the same step, found by its id', () => {
    saveCookPosition('r1', { rawIndex: 1, finished: false, stepId: 's-sear' });
    // A step was added above it.
    expect(restingCookPosition('r1', true, true, ['s-prep', 's-new', 's-sear'])).toEqual(
      expect.objectContaining({ rawIndex: 2, finished: false }),
    );
  });

  it('keeps the saved index when the step is gone', () => {
    saveCookPosition('r1', { rawIndex: 1, finished: false, stepId: 's-gone' });
    expect(restingCookPosition('r1', true, true, ['s-a', 's-b']).rawIndex).toBe(1);
  });
});
