import {
  FIRST_RUN_DEFAULTS, firstRunSettings, shouldOfferFirstRun, type FirstRunState,
} from '../utils/firstRun';

const fresh: FirstRunState = { done: false, loaded: true, taskCount: 0, syncEnabled: false, demoActive: false };

describe('shouldOfferFirstRun', () => {
  it('offers it on a loaded, empty install that has not answered', () => {
    expect(shouldOfferFirstRun(fresh)).toBe(true);
  });

  it('never offers it twice', () => {
    expect(shouldOfferFirstRun({ ...fresh, done: true })).toBe(false);
  });

  it('waits for the stores to load, since mid-load every install has no tasks', () => {
    expect(shouldOfferFirstRun({ ...fresh, loaded: false })).toBe(false);
  });

  it('does not offer it to an install that already has tasks', () => {
    expect(shouldOfferFirstRun({ ...fresh, taskCount: 1 })).toBe(false);
  });

  it('does not offer it with sync on, whose other device may hold the answers', () => {
    expect(shouldOfferFirstRun({ ...fresh, syncEnabled: true })).toBe(false);
  });

  it('does not offer it in demo mode', () => {
    expect(shouldOfferFirstRun({ ...fresh, demoActive: true })).toBe(false);
  });
});

describe('firstRunSettings', () => {
  it('writes the two settings the answers name', () => {
    expect(firstRunSettings({ groceriesAndMeals: false, keepItSimple: true, reminders: true }))
      .toEqual({ kitchenEnabled: false, simpleMode: true });
  });

  it('leaves the defaults unchanged when nothing is answered', () => {
    // The sheet opens on these, so Done without touching anything is a no-op
    // for the settings, the same as Skip.
    expect(firstRunSettings(FIRST_RUN_DEFAULTS)).toEqual({ kitchenEnabled: true, simpleMode: false });
  });
});
