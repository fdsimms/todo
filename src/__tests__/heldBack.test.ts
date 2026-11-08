import {
  HELD_BACK_COPY,
  heldBackGroups,
  heldBackHasHeadings,
  heldBackIcon,
  heldBackToggleText,
  heldBackTotal,
} from '../utils/heldBack';

const tasks = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

describe('heldBackGroups', () => {
  it('keeps only the groups with something in them, in the order they have always appeared', () => {
    const groups = heldBackGroups({ expired: tasks(2), slot: [], waitingOn: tasks(1) });
    expect(groups.map(g => g.kind)).toEqual(['expired', 'waitingOn']);
  });

  it('is empty when nothing is held back', () => {
    expect(heldBackGroups({ expired: [], slot: [], waitingOn: [] })).toEqual([]);
  });
});

describe('heldBackToggleText', () => {
  it('says nothing when nothing is held back', () => {
    expect(heldBackToggleText([], false)).toBeNull();
  });

  it('keeps a lone reason’s own wording, exactly as each footer read before', () => {
    expect(heldBackToggleText(heldBackGroups({ expired: tasks(2), slot: [], waitingOn: [] }), false)).toBe('Show 2 expired');
    expect(heldBackToggleText(heldBackGroups({ expired: [], slot: tasks(3), waitingOn: [] }), false)).toBe('Show 3 waiting for a lighter day');
    expect(heldBackToggleText(heldBackGroups({ expired: [], slot: [], waitingOn: tasks(1) }), true)).toBe('Hide 1 waiting on another task');
  });

  it('counts every task across the reasons once there is more than one', () => {
    const groups = heldBackGroups({ expired: tasks(2), slot: tasks(3), waitingOn: tasks(2) });
    expect(heldBackTotal(groups)).toBe(7);
    expect(heldBackToggleText(groups, false)).toBe('Show 7 set aside');
    expect(heldBackToggleText(groups, true)).toBe('Hide 7 set aside');
  });
});

describe('headings and icon', () => {
  it('names each reason only when there is more than one', () => {
    expect(heldBackHasHeadings(heldBackGroups({ expired: tasks(2), slot: [], waitingOn: [] }))).toBe(false);
    expect(heldBackHasHeadings(heldBackGroups({ expired: tasks(2), slot: tasks(1), waitingOn: [] }))).toBe(true);
  });

  it('uses a lone reason’s own icon, and the waiting one for several', () => {
    expect(heldBackIcon(heldBackGroups({ expired: tasks(1), slot: [], waitingOn: [] }))).toBe(HELD_BACK_COPY.expired.icon);
    expect(heldBackIcon(heldBackGroups({ expired: tasks(1), slot: tasks(1), waitingOn: [] }))).toBe('hourglass-outline');
  });

  it('is written in the app’s own copy style', () => {
    for (const copy of Object.values(HELD_BACK_COPY)) {
      expect(copy.heading).not.toMatch(/—/);
      expect(copy.noun).toBe(copy.noun.toLowerCase());
    }
  });
});
