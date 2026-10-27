import {
  addLeftoverOptOut,
  isLeftoverOptedOut,
  leftoverOptOutKey,
  parseLeftoverOptOuts,
  removeLeftoverOptOut,
  serializeLeftoverOptOuts,
} from '../utils/leftoverOptOut';

describe('leftoverOptOut', () => {
  it('keys a recipe by id, so a rename keeps the answer', () => {
    expect(leftoverOptOutKey('r1', 'Anything')).toBe('recipe:r1');
  });

  it('keys a recipe-less meal by its title, ignoring case and spacing', () => {
    const list = addLeftoverOptOut([], null, 'Protein shake');
    expect(isLeftoverOptedOut(list, null, '  protein SHAKE ')).toBe(true);
    expect(isLeftoverOptedOut(list, null, 'Protein bar')).toBe(false);
  });

  it('does not let a recipe opt-out cover a free-text meal of the same name', () => {
    const list = addLeftoverOptOut([], 'r1', 'Protein shake');
    expect(isLeftoverOptedOut(list, null, 'Protein shake')).toBe(false);
    expect(isLeftoverOptedOut(list, 'r1', 'Protein shake')).toBe(true);
  });

  it('refuses a blank title and does not add one twice', () => {
    expect(leftoverOptOutKey(null, '   ')).toBeNull();
    expect(addLeftoverOptOut([], null, '   ')).toEqual([]);
    const once = addLeftoverOptOut([], 'r1', 'x');
    expect(addLeftoverOptOut(once, 'r1', 'x')).toEqual(once);
  });

  it('round-trips and survives junk', () => {
    const list = ['recipe:r1', 'title:protein shake'];
    expect(parseLeftoverOptOuts(serializeLeftoverOptOuts(list))).toEqual(list);
    expect(parseLeftoverOptOuts(null)).toEqual([]);
    expect(parseLeftoverOptOuts('not json')).toEqual([]);
    expect(parseLeftoverOptOuts('{"a":1}')).toEqual([]);
    expect(parseLeftoverOptOuts('[1,"a",""]')).toEqual(['a']);
  });
});

describe('removeLeftoverOptOut', () => {
  it('takes one meal back off the list and leaves the rest', () => {
    const list = addLeftoverOptOut(addLeftoverOptOut([], 'r1', 'Soup'), null, 'Protein shake');
    expect(removeLeftoverOptOut(list, 'r1', 'Soup')).toEqual(['title:protein shake']);
  });
});
