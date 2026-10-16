const mockSettings: Record<string, string> = {};
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockSettings[key] ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockSettings[key] = value; }),
}));

import { useAppGroupStore, expandGroupNow, resolvedAssignments, resolveGroupNow } from '../store/useAppGroupStore';

const draft = {
  name: 'Work', groupIds: ['default'], days: [1, 2, 3, 4, 5], startMinutes: 540, endMinutes: 1020,
  enabled: true,
};
const WED_10 = new Date(2026, 7, 12, 10);

beforeEach(() => {
  for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  useAppGroupStore.getState().reload();
});

describe('groups', () => {
  it('adds, renames and removes, persisting each', () => {
    const added = useAppGroupStore.getState().addGroup('Social');
    expect(added.ok).toBe(true);
    const id = useAppGroupStore.getState().groups[0].id;
    expect(JSON.parse(mockSettings.appGroups)).toEqual([{ id, name: 'Social' }]);
    expect(useAppGroupStore.getState().renameGroup(id, 'Feeds').ok).toBe(true);
    useAppGroupStore.getState().removeGroup(id);
    expect(useAppGroupStore.getState().groups).toEqual([]);
  });

  it('keeps every group of a schedule, de-duplicated, and stores the first as groupId too', () => {
    const result = useAppGroupStore.getState().addSchedule({ ...draft, groupIds: ['social', 'games', 'social'] });
    expect(result.ok).toBe(true);
    expect(useAppGroupStore.getState().schedules[0].groupIds).toEqual(['social', 'games']);
    expect(JSON.parse(mockSettings.blockSchedules)[0]).toMatchObject({ groupId: 'social', groupIds: ['social', 'games'] });
    useAppGroupStore.getState().reload();
    expect(useAppGroupStore.getState().schedules[0].groupIds).toEqual(['social', 'games']);
  });

  it('refuses a schedule with no group', () => {
    expect(useAppGroupStore.getState().addSchedule({ ...draft, groupIds: [] })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('points a reason back at Default when its group is deleted, and a schedule resolves there too', () => {
    useAppGroupStore.getState().addGroup('Games');
    const id = useAppGroupStore.getState().groups[0].id;
    useAppGroupStore.getState().assignGroup('focus', id);
    expect(resolvedAssignments().focus).toBe(id);
    useAppGroupStore.getState().removeGroup(id);
    expect(useAppGroupStore.getState().assignments.focus).toBe('default');
    expect(resolveGroupNow(id)).toBe('default');
  });

  it('refuses to assign a group that does not exist', () => {
    useAppGroupStore.getState().assignGroup('gate', 'nope');
    expect(useAppGroupStore.getState().assignments.gate).toBe('default');
  });
});

describe('schedules', () => {
  it('adds a valid schedule and refuses an invalid one', () => {
    expect(useAppGroupStore.getState().addSchedule(draft).ok).toBe(true);
    const bad = useAppGroupStore.getState().addSchedule({ ...draft, days: [] });
    expect(bad).toMatchObject({ ok: false, reason: 'invalid' });
    expect(useAppGroupStore.getState().schedules).toHaveLength(1);
  });

  it('refuses a ninth', () => {
    for (let i = 0; i < 8; i += 1) useAppGroupStore.getState().addSchedule(draft);
    expect(useAppGroupStore.getState().addSchedule(draft)).toMatchObject({ ok: false, reason: 'full' });
  });

  it('clears a pause when the schedule is edited or toggled', () => {
    const result = useAppGroupStore.getState().addSchedule(draft);
    if (!result.ok) throw new Error('add failed');
    useAppGroupStore.getState().pauseOpenSchedules(WED_10);
    expect(useAppGroupStore.getState().schedules[0].pausedUntil).not.toBeNull();
    useAppGroupStore.getState().setScheduleEnabled(result.schedule.id, true);
    expect(useAppGroupStore.getState().schedules[0].pausedUntil).toBeNull();
  });
});

describe('the original group', () => {
  it('can be renamed, and the name survives a reload', () => {
    expect(useAppGroupStore.getState().renameGroup('default', 'Everything').ok).toBe(true);
    expect(mockSettings.appGroupBaseName).toBe('Everything');
    useAppGroupStore.getState().reload();
    expect(useAppGroupStore.getState().meta.baseName).toBe('Everything');
  });

  it('refuses a name a custom group has, and a custom group refuses its new name', () => {
    useAppGroupStore.getState().addGroup('Social');
    expect(useAppGroupStore.getState().renameGroup('default', 'social')).toEqual({ ok: false, reason: 'duplicate' });
    useAppGroupStore.getState().renameGroup('default', 'Everything');
    const id = useAppGroupStore.getState().groups[0].id;
    expect(useAppGroupStore.getState().renameGroup(id, 'everything')).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('hands the default role to another group, and back when that group is deleted', () => {
    useAppGroupStore.getState().addGroup('Social');
    const id = useAppGroupStore.getState().groups[0].id;
    useAppGroupStore.getState().setDefaultGroup(id);
    expect(resolveGroupNow('gone')).toBe(id);
    expect(resolveGroupNow('default')).toBe('default');
    useAppGroupStore.getState().removeGroup(id);
    expect(useAppGroupStore.getState().meta.fallbackId).toBe('default');
    expect(resolveGroupNow('gone')).toBe('default');
  });
});

describe('supergroups', () => {
  const addPlain = (name: string) => useAppGroupStore.getState().addGroup(name).group!.id;

  it('combines groups, persists the members and expands to them', () => {
    const a = addPlain('Social');
    const b = addPlain('News');
    const added = useAppGroupStore.getState().addSupergroup('Distractions', [b, a]);
    expect(added.ok).toBe(true);
    const id = added.group!.id;
    // Members are kept in listed order, not the order they were picked.
    expect(useAppGroupStore.getState().groups.find(g => g.id === id)?.members).toEqual([a, b]);
    expect(JSON.parse(mockSettings.appGroups).find((g: { id: string }) => g.id === id).members).toEqual([a, b]);
    expect(expandGroupNow(id)).toEqual([a, b]);
    expect(resolveGroupNow(id)).toBe(id);
  });

  it('can be what a reason blocks, and a deleted one hands the reason back to Default', () => {
    const a = addPlain('Social');
    const id = useAppGroupStore.getState().addSupergroup('Distractions', [a]).group!.id;
    useAppGroupStore.getState().assignGroup('focus', id);
    expect(resolvedAssignments().focus).toBe(id);
    useAppGroupStore.getState().removeGroup(id);
    expect(resolvedAssignments().focus).toBe('default');
    expect(useAppGroupStore.getState().groups.map(g => g.id)).toEqual([a]);
  });

  it('loses a member when that group is deleted, and keeps blocking something when none are left', () => {
    const a = addPlain('Social');
    const id = useAppGroupStore.getState().addSupergroup('Distractions', [a]).group!.id;
    useAppGroupStore.getState().removeGroup(a);
    expect(useAppGroupStore.getState().groups.find(g => g.id === id)?.members).toEqual([]);
    expect(expandGroupNow(id)).toEqual(['default']);
  });

  it('replaces its members and reads back after a reload', () => {
    const a = addPlain('Social');
    const b = addPlain('News');
    const id = useAppGroupStore.getState().addSupergroup('Distractions', [a]).group!.id;
    useAppGroupStore.getState().setSupergroupMembers(id, [b, 'default']);
    useAppGroupStore.getState().reload();
    expect(expandGroupNow(id)).toEqual(['default', b]);
  });
});
