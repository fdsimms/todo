import {
  clearCookPosition,
  restingCookPosition,
  saveCookPosition,
  saveCookSetup,
  savedCookPosition,
  savedCookSetup,
} from '../utils/cookPosition';

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
