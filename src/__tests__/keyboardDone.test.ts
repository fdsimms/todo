import {
  doneBarKind,
  floatingDoneWanted,
  resetFloatingDone,
  setFloatingDoneFocus,
  subscribeFloatingDone,
} from '../utils/keyboardDone';

beforeEach(() => resetFloatingDone());

describe('doneBarKind', () => {
  it('gives a plain single-line field the shared accessory', () => {
    expect(doneBarKind({})).toBe('accessory');
  });
  it('leaves a field with its own bar alone', () => {
    expect(doneBarKind({ ownAccessoryId: 'numberPadAccessory' })).toBe('none');
  });
  it('floats for a multiline field, since an accessory never attaches to one', () => {
    expect(doneBarKind({ multiline: true })).toBe('floating');
    expect(doneBarKind({ multiline: true, ownAccessoryId: 'x' })).toBe('floating');
  });
  it('honours the opt-out for a field with its own floating bar', () => {
    expect(doneBarKind({ multiline: true, dismissBar: false })).toBe('none');
    expect(doneBarKind({ dismissBar: false })).toBe('none');
  });
});

describe('floating focus', () => {
  it('is wanted while any field holds focus', () => {
    setFloatingDoneFocus('a', true);
    setFloatingDoneFocus('b', true);
    setFloatingDoneFocus('a', false);
    expect(floatingDoneWanted()).toBe(true);
    setFloatingDoneFocus('b', false);
    expect(floatingDoneWanted()).toBe(false);
  });
  it('notifies only on a change', () => {
    const fn = jest.fn();
    const off = subscribeFloatingDone(fn);
    setFloatingDoneFocus('a', true);
    setFloatingDoneFocus('a', true);
    setFloatingDoneFocus('a', false);
    off();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
