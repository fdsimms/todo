import { shouldFreezeTab } from '../utils/tabFreeze';

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
