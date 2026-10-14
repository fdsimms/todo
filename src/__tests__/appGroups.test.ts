import {
  DEFAULT_GROUP_ID, MAX_APP_GROUPS, allGroups, assignmentsAfterRemoval, cleanGroupName, groupName,
  parseAppGroups, parseGroupAssignments, resolveAssignments, resolveGroupId, withGroupAdded,
  withGroupRemoved, withGroupRenamed,
} from '../utils/appGroups';

const social = { id: 'g1', name: 'Social' };

describe('parseAppGroups', () => {
  it('reads groups and drops anything malformed, repeated or unsafe as a file name', () => {
    const raw = JSON.stringify([
      social,
      { id: 'g1', name: 'Again' },
      { id: 'default', name: 'Imposter' },
      { id: '../etc', name: 'Bad' },
      { id: 'g2' },
      'nope',
      { id: 'g3', name: '  Games  ' },
    ]);
    expect(parseAppGroups(raw)).toEqual([social, { id: 'g3', name: 'Games' }]);
  });

  it('is empty for missing, unparseable or non-array input', () => {
    expect(parseAppGroups(null)).toEqual([]);
    expect(parseAppGroups('{')).toEqual([]);
    expect(parseAppGroups('{"a":1}')).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_APP_GROUPS + 3 }, (_, i) => ({ id: `g${i}`, name: `G${i}` }));
    expect(parseAppGroups(JSON.stringify(many))).toHaveLength(MAX_APP_GROUPS);
  });
});

describe('adding, renaming and removing', () => {
  it('refuses a repeated name regardless of case, and the name Default', () => {
    expect(withGroupAdded([social], { id: 'g2', name: 'social' })).toEqual({ ok: false, reason: 'duplicate' });
    expect(withGroupAdded([], { id: 'g2', name: 'default' })).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('refuses the default id and a full list', () => {
    expect(withGroupAdded([], { id: DEFAULT_GROUP_ID, name: 'X' })).toEqual({ ok: false, reason: 'invalid' });
    const full = Array.from({ length: MAX_APP_GROUPS }, (_, i) => ({ id: `g${i}`, name: `G${i}` }));
    expect(withGroupAdded(full, { id: 'new', name: 'New' })).toEqual({ ok: false, reason: 'full' });
  });

  it('renames in place and allows keeping the same name', () => {
    expect(withGroupRenamed([social], 'g1', 'Social')).toEqual({ ok: true, groups: [social] });
    expect(withGroupRenamed([social], 'g1', 'Feeds')).toEqual({ ok: true, groups: [{ id: 'g1', name: 'Feeds' }] });
  });

  it('removes by id', () => {
    expect(withGroupRemoved([social], 'g1')).toEqual([]);
  });

  it('cleans a name to something never empty', () => {
    expect(cleanGroupName('   ')).toBe('New group');
    expect(cleanGroupName('a   b')).toBe('a b');
    expect(cleanGroupName('x'.repeat(40))).toHaveLength(24);
  });
});

describe('resolving a group that is gone', () => {
  it('falls back to Default rather than to nothing', () => {
    expect(resolveGroupId([social], 'g1')).toBe('g1');
    expect(resolveGroupId([social], 'removed')).toBe(DEFAULT_GROUP_ID);
    expect(resolveGroupId([social], null)).toBe(DEFAULT_GROUP_ID);
    expect(groupName([social], 'removed')).toBe('Default');
    expect(groupName([social], 'g1')).toBe('Social');
  });

  it('lists Default first', () => {
    expect(allGroups([social]).map(g => g.id)).toEqual([DEFAULT_GROUP_ID, 'g1']);
  });
});

describe('assignments', () => {
  it('start as Default for every reason and ignore junk', () => {
    expect(parseGroupAssignments(null)).toEqual({ focus: 'default', gate: 'default', penalty: 'default', key: 'default' });
    expect(parseGroupAssignments('{"focus":"g1","gate":5,"penalty":"../x"}'))
      .toEqual({ focus: 'g1', gate: 'default', penalty: 'default', key: 'default' });
  });

  it('resolve a removed group to Default', () => {
    const a = parseGroupAssignments('{"focus":"g1","gate":"gone"}');
    expect(resolveAssignments([social], a)).toEqual({ focus: 'g1', gate: 'default', penalty: 'default', key: 'default' });
  });

  it('go back to Default when their group is deleted', () => {
    const a = parseGroupAssignments('{"focus":"g1","key":"g1","gate":"g2"}');
    expect(assignmentsAfterRemoval(a, 'g1')).toEqual({ focus: 'default', gate: 'g2', penalty: 'default', key: 'default' });
  });
});
