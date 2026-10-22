import { sameGroupsApartFromFold } from '@/utils/groupFold';
import type { TaskGroup } from '@/types';

const makeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'group-1',
  title: 'Morning',
  notes: '',
  tags: [],
  category: null,
  sortOrder: 1,
  collapsed: false,
  onToday: false,
  projectId: null,
  ...overrides,
});

describe('sameGroupsApartFromFold', () => {
  it('treats a fold or an arrival on Today as no change', () => {
    const a = [makeGroup(), makeGroup({ id: 'group-2' })];
    const b = [{ ...a[0], collapsed: true }, { ...a[1], onToday: true, collapsed: true }];
    expect(sameGroupsApartFromFold(a, b)).toBe(true);
  });

  it('sees any other field change', () => {
    const a = [makeGroup()];
    expect(sameGroupsApartFromFold(a, [{ ...a[0], title: 'Evening' }])).toBe(false);
    expect(sameGroupsApartFromFold(a, [{ ...a[0], sortOrder: 2 }])).toBe(false);
    expect(sameGroupsApartFromFold(a, [{ ...a[0], category: 'home' }])).toBe(false);
  });

  it('counts a rebuilt field as a change even when it reads the same', () => {
    const a = [makeGroup({ tags: ['x'] })];
    expect(sameGroupsApartFromFold(a, [{ ...a[0], tags: ['x'] }])).toBe(false);
  });

  it('sees a stack added, removed or moved', () => {
    const g1 = makeGroup();
    const g2 = makeGroup({ id: 'group-2' });
    expect(sameGroupsApartFromFold([g1], [g1, g2])).toBe(false);
    expect(sameGroupsApartFromFold([g1, g2], [g1])).toBe(false);
    expect(sameGroupsApartFromFold([g1, g2], [g2, g1])).toBe(false);
  });

  it('sees a field that appears on only one side', () => {
    const a = [makeGroup()];
    expect(sameGroupsApartFromFold(a, [{ ...a[0], checklist: true }])).toBe(false);
  });
});
