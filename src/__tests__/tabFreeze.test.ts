import { shouldFreezeTab, TAB_FREEZE_DELAY_MS } from '../utils/tabFreeze';

describe('shouldFreezeTab', () => {
  it('never freezes the focused tab', () => {
    expect(shouldFreezeTab({ focused: true, sheetPresented: false })).toBe(false);
    expect(shouldFreezeTab({ focused: true, sheetPresented: true })).toBe(false);
  });

  it('freezes a blurred tab once nothing is presented', () => {
    expect(shouldFreezeTab({ focused: false, sheetPresented: false })).toBe(true);
  });

  it('holds the freeze off while a sheet is on screen', () => {
    // Hiding a subtree with a presented sheet in it is the unmount-while-shown
    // failure SheetModal exists to prevent. The freeze waits for the sheet.
    expect(shouldFreezeTab({ focused: false, sheetPresented: true })).toBe(false);
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
