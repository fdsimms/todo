import {
  DEFAULT_GROUP_ID, MAX_APP_GROUPS, MAX_SUPERGROUPS, allGroups, assignmentsAfterRemoval, cleanGroupName, expandGroupId, groupName, isSupergroup, plainGroups,
  parseAppGroups, parseGroupAssignments, parseGroupsMeta, resolveAssignments, resolveGroupId, withGroupAdded,
  supergroupMembers, withGroupRemoved, withGroupRenamed, withMembersSet,
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

describe('supergroups', () => {
  const games = { id: 'g2', name: 'Games' };
  const mix = { id: 's1', name: 'Distractions', members: ['g1', 'default'] };
  const all = [social, games, mix];

  it('parses members, dropping any that are not plain groups and keeping the cap apart from plain groups', () => {
    const raw = JSON.stringify([
      social,
      { id: 's1', name: 'Mix', members: ['g1', 'g1', 'gone', 's2', 'default'] },
      { id: 's2', name: 'Nested', members: ['s1', 'g1'] },
    ]);
    const parsed = parseAppGroups(raw);
    expect(parsed[1].members).toEqual(['g1', 'default']);
    expect(parsed[2].members).toEqual(['g1']);
    const many = [
      ...Array.from({ length: MAX_APP_GROUPS }, (_, i) => ({ id: `g${i}`, name: `G${i}` })),
      ...Array.from({ length: MAX_SUPERGROUPS + 2 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, members: ['g0'] })),
    ];
    const capped = parseAppGroups(JSON.stringify(many));
    expect(capped.filter(isSupergroup)).toHaveLength(MAX_SUPERGROUPS);
    expect(capped.filter(g => !isSupergroup(g))).toHaveLength(MAX_APP_GROUPS);
  });

  it('expands to its members, in listed order, and a plain group to itself', () => {
    expect(expandGroupId(all, 's1')).toEqual(['default', 'g1']);
    expect(expandGroupId(all, 'g2')).toEqual(['g2']);
    expect(expandGroupId(all, 'default')).toEqual(['default']);
  });

  it('falls back when the id is missing or the supergroup has no members left', () => {
    expect(expandGroupId(all, 'nope')).toEqual(['default']);
    const empty = [social, { id: 's1', name: 'Empty', members: [] }];
    expect(expandGroupId(empty, 's1')).toEqual(['default']);
    expect(expandGroupId(empty, 's1', { baseName: 'Default', fallbackId: 'g1' })).toEqual(['g1']);
  });

  it('is removed from, not left dangling in, a supergroup when a member group is deleted', () => {
    const after = withGroupRemoved(all, 'g1');
    expect(after.find(g => g.id === 's1')?.members).toEqual(['default']);
    expect(expandGroupId(after, 's1')).toEqual(['default']);
  });

  it('sets members in listed order and ignores unknown or supergroup ids', () => {
    const next = withMembersSet(all, 's1', ['g2', 's1', 'zzz', 'g1']);
    expect(next.find(g => g.id === 's1')?.members).toEqual(['g1', 'g2']);
    expect(withMembersSet(all, 'g1', ['g2'])).toEqual(all);
  });

  it('lists only plain groups as pickable apps groups, and its members by name', () => {
    expect(plainGroups(all).map(g => g.id)).toEqual(['default', 'g1', 'g2']);
    expect(supergroupMembers(all, 's1').map(g => g.name)).toEqual(['Default', 'Social']);
    expect(supergroupMembers(all, 'g1')).toEqual([]);
  });

  it('counts against its own cap and shares the name rule', () => {
    expect(withGroupAdded([social], { id: 's9', name: 'social', members: ['g1'] })).toEqual({ ok: false, reason: 'duplicate' });
    const fullSupers = Array.from({ length: MAX_SUPERGROUPS }, (_, i) => ({ id: `s${i}`, name: `S${i}`, members: [] as string[] }));
    expect(withGroupAdded(fullSupers, { id: 'sx', name: 'More', members: [] })).toEqual({ ok: false, reason: 'full' });
    expect(withGroupAdded(fullSupers, { id: 'gx', name: 'Plain' }).ok).toBe(true);
  });

  it('is never the group a missing group falls back to', () => {
    expect(parseGroupsMeta(null, 's1', all).fallbackId).toBe('default');
    expect(groupName(all, 's1')).toBe('Distractions');
  });
});
