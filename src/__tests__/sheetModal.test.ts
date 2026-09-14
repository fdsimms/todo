import { nextSheetVisibility } from '../utils/sheetModal';

describe('nextSheetVisibility', () => {
  it('does nothing while the modal already agrees with the prop', () => {
    expect(nextSheetVisibility(true, true)).toBeNull();
    expect(nextSheetVisibility(false, false)).toBeNull();
  });

  it('opens without touching the keyboard', () => {
    // The sheet that raised this one may have a field focused, and taking the
    // keyboard off it on the way in is not this modal's business. It is also
    // what lets SheetModal apply this edge during render instead of from an
    // effect — there is no side effect on it to smuggle into a render pass.
    expect(nextSheetVisibility(true, false)).toEqual({ shown: true, dismissKeyboard: false });
  });

  it('marks only the closing edge as needing a dismissal', () => {
    // The asymmetry AppLockGate depends on: opening is applied immediately, so
    // the lock screen and its app-switcher shield cannot miss a frame, while
    // closing is the edge held back a commit. Collapsing the two into one
    // symmetric hold is the regression this pins.
    expect(nextSheetVisibility(true, false)?.dismissKeyboard).toBe(false);
    expect(nextSheetVisibility(false, true)?.dismissKeyboard).toBe(true);
  });

  it('dismisses the keyboard on the closing edge', () => {
    expect(nextSheetVisibility(false, true)).toEqual({ shown: false, dismissKeyboard: true });
  });

  it('never closes without dismissing first', () => {
    // The whole rule, stated as one: there is no step that hides the modal
    // and leaves the keyboard up.
    for (const visible of [true, false]) {
      for (const shown of [true, false]) {
        const step = nextSheetVisibility(visible, shown);
        if (step && !step.shown) expect(step.dismissKeyboard).toBe(true);
      }
    }
  });

  it('walks a full open/close cycle in two steps', () => {
    let shown = false;
    const seen: SheetStep[] = [];
    for (const visible of [true, true, false, false]) {
      const step = nextSheetVisibility(visible, shown);
      if (step) { shown = step.shown; seen.push(step); }
    }
    expect(seen).toEqual([
      { shown: true, dismissKeyboard: false },
      { shown: false, dismissKeyboard: true },
    ]);
    expect(shown).toBe(false);
  });
});

type SheetStep = { shown: boolean; dismissKeyboard: boolean };
