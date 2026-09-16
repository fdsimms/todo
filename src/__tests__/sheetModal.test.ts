import {
  canHideSheet,
  canShowSheet,
  claimPresentation,
  createPresentationLevel,
  mustYieldSheet,
  nextSheetVisibility,
  registerPresentation,
  releasePresentation,
  releasePresentationClaim,
  subscribePresentation,
} from '../utils/sheetModal';

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
    //
    // `canShowSheet` is not that hold coming back. This is about the keyboard,
    // which only the closing edge has anything to dismiss; that is about the
    // place a sheet appears in being taken, which is usually free — so an open
    // with nothing in its way still lands in the commit it was asked for.
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

describe('presentation levels', () => {
  it('says nothing about the only sheet at a level', () => {
    const level = createPresentationLevel();
    expect(registerPresentation(level, 'a', 'Scan')).toBeNull();
  });

  it('reports a second sheet presented from the same place', () => {
    const level = createPresentationLevel();
    registerPresentation(level, 'a', 'What did you eat?');
    const message = registerPresentation(level, 'b', 'Estimate a meal');
    expect(message).toContain('What did you eat?');
    expect(message).toContain('Estimate a meal');
  });

  it('stays quiet once the first has gone', () => {
    // Hiding the sheet underneath is one of the two fixes, so the check has
    // to agree that the hand-off it produces is fine.
    const level = createPresentationLevel();
    registerPresentation(level, 'a', 'What did you eat?');
    releasePresentation(level, 'a');
    expect(registerPresentation(level, 'b', 'Estimate a meal')).toBeNull();
  });

  it('treats separate levels as unrelated', () => {
    // The nested case: a sheet inside another presents from that sheet's own
    // view controller, which is presenting nothing. It must not be reported.
    const root = createPresentationLevel();
    const inner = createPresentationLevel();
    registerPresentation(root, 'a', 'What did you eat?');
    expect(registerPresentation(inner, 'b', 'Search a food database')).toBeNull();
  });

  it('lets a sheet re-register itself without tripping', () => {
    const level = createPresentationLevel();
    registerPresentation(level, 'a', 'Scan');
    expect(registerPresentation(level, 'a', 'Scan')).toBeNull();
  });

  it('names every sheet already there', () => {
    const level = createPresentationLevel();
    registerPresentation(level, 'a', 'One');
    releasePresentation(level, 'a');
    registerPresentation(level, 'b', 'Two');
    const message = registerPresentation(level, 'c', 'Three');
    expect(message).toContain('Two');
    expect(message).not.toContain('One');
  });
});

describe('canHideSheet', () => {
  it('lets a sheet with nothing above it go', () => {
    expect(canHideSheet(createPresentationLevel())).toBe(true);
  });

  it('holds a sheet back while it is presenting something', () => {
    // The blank-frozen-sheet bug: logging from the nested Scan or Describe
    // sheet closed the picker underneath and the sheet itself in one commit,
    // so iOS tore the inner view controller down with its presenter while RN
    // still thought it was presented, orphaning it on screen.
    const level = createPresentationLevel();
    registerPresentation(level, 'estimate', 'Estimate a meal');
    expect(canHideSheet(level)).toBe(false);
  });

  it('lets it go again once the sheet above has gone', () => {
    const level = createPresentationLevel();
    registerPresentation(level, 'estimate', 'Estimate a meal');
    releasePresentation(level, 'estimate');
    expect(canHideSheet(level)).toBe(true);
  });
});

describe('canShowSheet', () => {
  it('opens a sheet with nothing standing in its place', () => {
    // The overwhelmingly common case, and the one AppLockGate depends on: an
    // open is held only when it would actually collide, so the lock screen and
    // its shield still land in the commit they were asked for.
    expect(canShowSheet(createPresentationLevel())).toBe(true);
  });

  it('holds a sheet back while another is presented from the same place', () => {
    const level = createPresentationLevel();
    registerPresentation(level, 'setup', 'Focus setup');
    expect(canShowSheet(level)).toBe(false);
  });

  it('lets the hand-off through once the first has gone', () => {
    // Close one sheet and open another in one commit — what the app does in
    // ~25 places, and what froze three flows in three days once the keyboard
    // hold made the close land a commit late.
    const level = createPresentationLevel();
    registerPresentation(level, 'setup', 'Focus setup');
    expect(canShowSheet(level)).toBe(false);
    releasePresentation(level, 'setup');
    expect(canShowSheet(level)).toBe(true);
  });

  it('says nothing about a sheet nested inside another', () => {
    // A sheet rendered inside another presents from that sheet's own
    // controller, which is presenting nothing, so the outer one being up must
    // not hold it back.
    const root = createPresentationLevel();
    const inner = createPresentationLevel();
    registerPresentation(root, 'outer', 'What did you eat?');
    expect(canShowSheet(inner)).toBe(true);
  });

  it('agrees with canHideSheet about an empty level', () => {
    // They are two rules over one invariant — a level holds one sheet — and
    // differ only in which level the caller passes. Neither may drift into
    // letting two sheets share a presenting view controller.
    const level = createPresentationLevel();
    expect(canShowSheet(level)).toBe(canHideSheet(level));
    registerPresentation(level, 'a', 'One');
    expect(canShowSheet(level)).toBe(canHideSheet(level));
  });
});

describe('claiming a level', () => {
  it('leaves an unclaimed level alone', () => {
    const level = createPresentationLevel();
    expect(mustYieldSheet(level, 'editor')).toBe(false);
  });

  it('turns every other sheet there out', () => {
    // The app lock arriving over an open task editor. Without this the lock is
    // simply refused by iOS: no shield over the app-switcher snapshot, and a
    // resume past the grace period that doesn't lock the app at all.
    const level = createPresentationLevel();
    claimPresentation(level, 'lock');
    expect(mustYieldSheet(level, 'editor')).toBe(true);
  });

  it('never turns out the sheet that claimed it', () => {
    const level = createPresentationLevel();
    claimPresentation(level, 'lock');
    expect(mustYieldSheet(level, 'lock')).toBe(false);
  });

  it('stops anything else opening there while it holds', () => {
    // An empty level is otherwise open season — the claim is the only thing
    // saying "not this one" when nothing is presented yet.
    const level = createPresentationLevel();
    claimPresentation(level, 'lock');
    expect(canShowSheet(level, 'editor')).toBe(false);
    expect(canShowSheet(level, 'lock')).toBe(true);
  });

  it('still makes the claimant wait for the sheet standing down', () => {
    // Yielding is not instant: the sheet that is up has to be told, and go.
    // Presenting into a place still occupied is the refusal all over again.
    const level = createPresentationLevel();
    registerPresentation(level, 'editor', 'Task editor');
    claimPresentation(level, 'lock');
    expect(canShowSheet(level, 'lock')).toBe(false);
    releasePresentation(level, 'editor');
    expect(canShowSheet(level, 'lock')).toBe(true);
  });

  it('lets everything back in once the claim goes', () => {
    const level = createPresentationLevel();
    claimPresentation(level, 'lock');
    releasePresentationClaim(level, 'lock');
    expect(mustYieldSheet(level, 'editor')).toBe(false);
    expect(canShowSheet(level, 'editor')).toBe(true);
  });

  it('wakes the sheets that have to yield, and again when they may return', () => {
    // Both edges matter: the first is what tells a sheet to go, the second is
    // what puts it back. A claim that only notified once would leave the app
    // locked-looking with nothing on screen after the lock let go.
    const level = createPresentationLevel();
    const seen: boolean[] = [];
    subscribePresentation(level, () => seen.push(mustYieldSheet(level, 'editor')));
    claimPresentation(level, 'lock');
    releasePresentationClaim(level, 'lock');
    expect(seen).toEqual([true, false]);
  });

  it('stays quiet on a repeated claim or a release of one never made', () => {
    const level = createPresentationLevel();
    claimPresentation(level, 'lock');
    let calls = 0;
    subscribePresentation(level, () => { calls += 1; });
    claimPresentation(level, 'lock');
    releasePresentationClaim(level, 'nobody');
    expect(calls).toBe(0);
  });

  it('is scoped to its own level, which is what carries it down a nest', () => {
    // A sheet told to stand down claims its *own* level as it goes, so the
    // sheets it is presenting leave first — dismissing a presenter takes the
    // presented one down behind RN's back, which is the orphaned view
    // controller nothing can dismiss.
    const root = createPresentationLevel();
    const inner = createPresentationLevel();
    claimPresentation(root, 'lock');
    expect(mustYieldSheet(inner, 'picker')).toBe(false);
    claimPresentation(inner, 'editor');
    expect(mustYieldSheet(inner, 'picker')).toBe(true);
  });
});

describe('subscribePresentation', () => {
  it('reports a sheet arriving and leaving', () => {
    const level = createPresentationLevel();
    const seen: boolean[] = [];
    subscribePresentation(level, () => seen.push(canHideSheet(level)));
    registerPresentation(level, 'a', 'Scan');
    releasePresentation(level, 'a');
    // False on the way in, true on the way out: the second is what wakes the
    // sheet below and lets its own dismissal proceed.
    expect(seen).toEqual([false, true]);
  });

  it('stays quiet when nothing actually changed', () => {
    // A re-register of the same id and a release of one never there must not
    // wake the sheet below, or a settled pair re-renders each other forever.
    const level = createPresentationLevel();
    registerPresentation(level, 'a', 'Scan');
    let calls = 0;
    subscribePresentation(level, () => { calls += 1; });
    registerPresentation(level, 'a', 'Scan');
    releasePresentation(level, 'nobody');
    expect(calls).toBe(0);
  });

  it('stops reporting once unsubscribed', () => {
    const level = createPresentationLevel();
    let calls = 0;
    const off = subscribePresentation(level, () => { calls += 1; });
    off();
    registerPresentation(level, 'a', 'Scan');
    expect(calls).toBe(0);
  });

  it('survives a listener unsubscribing while being notified', () => {
    // React cleans effects up mid-notification, so the walk is over a copy.
    const level = createPresentationLevel();
    let calls = 0;
    const off = subscribePresentation(level, () => { calls += 1; off(); });
    subscribePresentation(level, () => { calls += 1; });
    expect(() => registerPresentation(level, 'a', 'Scan')).not.toThrow();
    expect(calls).toBe(2);
  });
});
