import {
  registerAccessory,
  unregisterAccessory,
  topAccessory,
  isTopAccessory,
  subscribeAccessories,
  resetAccessoryStacks,
} from '../utils/accessoryStack';

const ID = 'numberPadAccessory';
const OTHER = 'titleTokenAccessory';

describe('accessoryStack', () => {
  beforeEach(() => {
    resetAccessoryStacks();
  });

  it('reports nobody on top before anything registers', () => {
    expect(topAccessory(ID)).toBeNull();
    expect(isTopAccessory(ID, 'a')).toBe(false);
  });

  it('gives a lone registration the slot', () => {
    registerAccessory(ID, 'screen');
    expect(topAccessory(ID)).toBe('screen');
    expect(isTopAccessory(ID, 'screen')).toBe(true);
  });

  it('hands the slot to the newest registration', () => {
    // A sheet's subtree mounts after the screen that opened it, so the sheet
    // is the one whose window the keyboard is actually in.
    registerAccessory(ID, 'screen');
    registerAccessory(ID, 'sheet');
    expect(topAccessory(ID)).toBe('sheet');
    expect(isTopAccessory(ID, 'screen')).toBe(false);
  });

  it('hands the slot back when the newest unregisters', () => {
    registerAccessory(ID, 'screen');
    registerAccessory(ID, 'sheet');
    unregisterAccessory(ID, 'sheet');
    expect(topAccessory(ID)).toBe('screen');
  });

  it('keeps the top intact when something underneath unregisters', () => {
    registerAccessory(ID, 'screen');
    registerAccessory(ID, 'sheet');
    unregisterAccessory(ID, 'screen');
    expect(topAccessory(ID)).toBe('sheet');
  });

  it('walks all the way back down as a stack of sheets closes', () => {
    registerAccessory(ID, 'screen');
    registerAccessory(ID, 'sheet');
    registerAccessory(ID, 'nested');
    expect(topAccessory(ID)).toBe('nested');
    unregisterAccessory(ID, 'nested');
    expect(topAccessory(ID)).toBe('sheet');
    unregisterAccessory(ID, 'sheet');
    expect(topAccessory(ID)).toBe('screen');
    unregisterAccessory(ID, 'screen');
    expect(topAccessory(ID)).toBeNull();
  });

  it('moves a repeat registration up rather than adding a second entry', () => {
    registerAccessory(ID, 'screen');
    registerAccessory(ID, 'sheet');
    registerAccessory(ID, 'screen');
    expect(topAccessory(ID)).toBe('screen');
    // One entry, not two: unregistering once must give the slot up entirely.
    unregisterAccessory(ID, 'screen');
    expect(topAccessory(ID)).toBe('sheet');
  });

  it('ignores unregistering something that never registered', () => {
    registerAccessory(ID, 'screen');
    unregisterAccessory(ID, 'ghost');
    expect(topAccessory(ID)).toBe('screen');
  });

  it('keeps different nativeIDs independent', () => {
    registerAccessory(ID, 'numberBar');
    registerAccessory(OTHER, 'tokenBar');
    expect(topAccessory(ID)).toBe('numberBar');
    expect(topAccessory(OTHER)).toBe('tokenBar');
    unregisterAccessory(OTHER, 'tokenBar');
    expect(topAccessory(ID)).toBe('numberBar');
    expect(topAccessory(OTHER)).toBeNull();
  });

  it('notifies subscribers when the top changes', () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeAccessories(() => seen.push(topAccessory(ID)));
    registerAccessory(ID, 'screen');
    registerAccessory(ID, 'sheet');
    unregisterAccessory(ID, 'sheet');
    unsubscribe();
    registerAccessory(ID, 'after');
    expect(seen).toEqual(['screen', 'sheet', 'screen']);
  });

  it('does not notify for an unregister that changed nothing', () => {
    registerAccessory(ID, 'screen');
    let calls = 0;
    const unsubscribe = subscribeAccessories(() => { calls += 1; });
    unregisterAccessory(ID, 'ghost');
    expect(calls).toBe(0);
    unsubscribe();
  });
});
