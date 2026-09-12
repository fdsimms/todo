import { isDemoModeActive, setDemoModeActive } from '../utils/demoState';

afterEach(() => setDemoModeActive(false));

describe('demoState', () => {
  it('starts inactive, so nothing gates on a demo that never started', () => {
    expect(isDemoModeActive()).toBe(false);
  });

  it('reports the flag it was last set to', () => {
    setDemoModeActive(true);
    expect(isDemoModeActive()).toBe(true);
    setDemoModeActive(false);
    expect(isDemoModeActive()).toBe(false);
  });

  // The whole point of the split: a leaf module reads this without importing
  // useDemoStore, which would close an import cycle back through the task
  // store. Every caller sees the one flag.
  it('is one flag shared by every reader', () => {
    setDemoModeActive(true);
    expect(isDemoModeActive()).toBe(isDemoModeActive());
    expect(isDemoModeActive()).toBe(true);
  });
});
