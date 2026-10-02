import { isChecklistRow, registerSectionSource, sectionsNow } from '../utils/sectionRegistry';
import type { TaskGroup } from '../types';

const group = (o: Partial<TaskGroup>): TaskGroup => ({
  id: 'g', title: '', notes: '', tags: [], category: null, sortOrder: 0,
  collapsed: false, onToday: false, projectId: 'p1', ...o,
});

afterEach(() => registerSectionSource(null));

describe('sectionRegistry', () => {
  it('knows no sections, and so no checklist rows, before a source is registered', () => {
    expect(sectionsNow()).toEqual([]);
    expect(isChecklistRow({ groupId: 'g' })).toBe(false);
  });

  it('reads the checklist flag off the task\'s section', () => {
    const groups = [group({ id: 'pack', checklist: true }), group({ id: 'walls' })];
    registerSectionSource(() => groups);
    expect(isChecklistRow({ groupId: 'pack' })).toBe(true);
    expect(isChecklistRow({ groupId: 'walls' })).toBe(false);
    expect(isChecklistRow({ groupId: null })).toBe(false);
    expect(isChecklistRow({ groupId: 'gone' })).toBe(false);
  });

  it('follows the live list, not the one it first saw', () => {
    let groups = [group({ id: 'pack' })];
    registerSectionSource(() => groups);
    expect(isChecklistRow({ groupId: 'pack' })).toBe(false);
    groups = [group({ id: 'pack', checklist: true })];
    expect(isChecklistRow({ groupId: 'pack' })).toBe(true);
  });
});
