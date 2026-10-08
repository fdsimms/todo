import { isTabFocused, shouldFreezeTab, TAB_FREEZE_DELAY_MS } from '../utils/tabFreeze';

describe('shouldFreezeTab', () => {
  it('never freezes the focused tab', () => {
    expect(shouldFreezeTab({ focused: true, sheetPresented: false, frozen: false })).toBe(false);
    expect(shouldFreezeTab({ focused: true, sheetPresented: true, frozen: false })).toBe(false);
  });

  it('freezes a blurred tab once nothing is presented', () => {
    expect(shouldFreezeTab({ focused: false, sheetPresented: false, frozen: false })).toBe(true);
  });

  it('holds the freeze off while a sheet is on screen', () => {
    // Hiding a subtree with a presented sheet in it is the unmount-while-shown
    // failure SheetModal exists to prevent. The freeze waits for the sheet.
    expect(shouldFreezeTab({ focused: false, sheetPresented: true, frozen: false })).toBe(false);
  });

  it('keeps a frozen tab frozen when a sheet opens elsewhere', () => {
    // The side menu is a sheet. Thawing every frozen tab as it opened made them
    // all catch up at once, under the drawer's slide-in.
    expect(shouldFreezeTab({ focused: false, sheetPresented: true, frozen: true })).toBe(true);
  });

  it('thaws a frozen tab the moment it is focused', () => {
    expect(shouldFreezeTab({ focused: true, sheetPresented: false, frozen: true })).toBe(false);
    expect(shouldFreezeTab({ focused: true, sheetPresented: true, frozen: true })).toBe(false);
  });
});

describe('TAB_FREEZE_DELAY_MS', () => {
  it('outlasts a sheet dismissal, so a close that navigates away can finish', () => {
    // iOS dismisses a presented sheet in roughly 350ms, and SheetModal's close
    // needs a second commit after the first. A freeze inside that window strands
    // the second one.
    expect(TAB_FREEZE_DELAY_MS).toBeGreaterThanOrEqual(500);
  });
});

describe('isTabFocused', () => {
  it("trusts the container over the tab navigator's stale getState", () => {
    // navigateToTab('Rewards') from Today: the navigator still reports Today
    // until its write-back lands, and nothing re-asks it afterwards.
    expect(isTabFocused({ routeName: 'Rewards', containerTab: 'Rewards', navigatorFocused: false })).toBe(true);
    expect(isTabFocused({ routeName: 'Today', containerTab: 'Rewards', navigatorFocused: true })).toBe(false);
  });

  it("falls back to the navigator's answer before the container is ready", () => {
    expect(isTabFocused({ routeName: 'Today', containerTab: undefined, navigatorFocused: true })).toBe(true);
    expect(isTabFocused({ routeName: 'Rewards', containerTab: undefined, navigatorFocused: false })).toBe(false);
  });
});
