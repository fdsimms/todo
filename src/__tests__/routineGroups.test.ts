import { groupNames, resolveGroupName, routineSections } from '../utils/routineGroups';

const r = (id: string, sortOrder: number, groupName: string | null = null, archived = false) =>
  ({ id, sortOrder, groupName, archived });

describe('routineSections', () => {
  it('lists ungrouped routines apart and groups in the order of their first routine', () => {
    const s = routineSections([r('a', 3, 'Travel'), r('b', 1, 'Gym'), r('c', 2), r('d', 4, 'Gym')]);
    expect(s.ungrouped.map(x => x.id)).toEqual(['c']);
    expect(s.groups.map(g => [g.name, g.routines.map(x => x.id)])).toEqual([
      ['Gym', ['b', 'd']],
      ['Travel', ['a']],
    ]);
  });

  it('takes an archived routine out of its group and lists it under archived', () => {
    const s = routineSections([r('a', 1, 'Gym'), r('b', 2, 'Gym', true), r('c', 3, 'Solo', true)]);
    expect(s.groups).toEqual([{ name: 'Gym', routines: [r('a', 1, 'Gym')] }]);
    expect(s.archived.map(x => x.id)).toEqual(['b', 'c']);
  });

  it('treats a group name case-insensitively', () => {
    const s = routineSections([r('a', 1, 'Gym'), r('b', 2, 'gym ')]);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].routines).toHaveLength(2);
  });
});

describe('resolveGroupName', () => {
  const held = [r('a', 1, 'Gym')];
  it('reads blank and null as no group', () => {
    expect(resolveGroupName(null, held)).toBeNull();
    expect(resolveGroupName('   ', held)).toBeNull();
  });
  it('takes the spelling of a group already in use', () => {
    expect(resolveGroupName('  gym ', held)).toBe('Gym');
  });
  it('keeps a new name as typed, tidied', () => {
    expect(resolveGroupName('  Hotel   trips ', held)).toBe('Hotel trips');
  });
});

describe('groupNames', () => {
  it('counts the group of an archived routine, so a restore has a place to land', () => {
    expect(groupNames([r('a', 1, 'Gym', true)])).toEqual(['Gym']);
  });
});
