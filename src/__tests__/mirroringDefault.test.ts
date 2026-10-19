import { shouldDefaultMirroringOn } from '../utils/mirroringDefault';

describe('shouldDefaultMirroringOn', () => {
  it('turns it on for a Mac that has never been asked', () => {
    expect(shouldDefaultMirroringOn(null, true)).toBe(true);
    expect(shouldDefaultMirroringOn(undefined, true)).toBe(true);
  });

  it('leaves a phone or an iPad alone', () => {
    expect(shouldDefaultMirroringOn(null, false)).toBe(false);
  });

  it('never overrides a stored answer, including a stored off', () => {
    expect(shouldDefaultMirroringOn('false', true)).toBe(false);
    expect(shouldDefaultMirroringOn('true', true)).toBe(false);
    expect(shouldDefaultMirroringOn('', true)).toBe(false);
  });
});
