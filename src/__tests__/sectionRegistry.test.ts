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

  it('makes a list project\'s sections and loose rows list items, unless a section keeps tasks', () => {
    const groups = [group({ id: 'books' }), group({ id: 'chores', keepsTasks: true }), group({ id: 'elsewhere', projectId: 'p2' })];
    registerSectionSource(() => groups);
    const wish = { id: 'p1', list: true };
    expect(isChecklistRow({ groupId: 'books' }, wish)).toBe(true);
    expect(isChecklistRow({ groupId: 'chores' }, wish)).toBe(false);
    expect(isChecklistRow({ groupId: null }, wish)).toBe(true);
    // A section homed on another project answers for that project, not this one.
    expect(isChecklistRow({ groupId: 'elsewhere' }, wish)).toBe(false);
    expect(isChecklistRow({ groupId: 'books' }, { id: 'p1', list: false })).toBe(false);
  });
});
