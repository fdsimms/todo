import { groupProjectsByCategory, resolveProjectDrop, type ProjectListItem } from '../utils/projectGrouping';
import type { Project } from '../types';

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  title: 'Test Project',
  notes: '',
  deadline: null,
  category: null,
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: 14,
  autoSchedule: false,
  nudgeOptIn: true,
  reviewDeclinedAt: null,
  backfillDismissedFields: [],
  kind: 'project' as const,
  ...overrides,
});

describe('groupProjectsByCategory', () => {
  it('renders uncategorized projects first with no header, then named categories in order', () => {
    const projects = [
      makeProject({ id: 'a', category: 'Home' }),
      makeProject({ id: 'b', category: null }),
      makeProject({ id: 'c', category: 'Work' }),
    ];
    const items = groupProjectsByCategory(projects, ['Work', 'Home']);
    expect(items.map(i => (i.type === 'header' ? `h:${i.label}` : i.project.id))).toEqual([
      'b', 'h:Work', 'c', 'h:Home', 'a',
    ]);
  });
});

describe('resolveProjectDrop', () => {
  const reorder = (items: ProjectListItem[]) => resolveProjectDrop(items, ['Work', 'Home']);

  it('leaves category unchanged when a project stays under the same header', () => {
    const projects = [makeProject({ id: 'a', category: 'Work' }), makeProject({ id: 'b', category: 'Work' })];
    const reordered = groupProjectsByCategory(projects, ['Work']);
    const { categoryUpdates } = reorder(reordered);
    expect(categoryUpdates).toEqual([]);
  });

  it('recategorizes a project dropped under a different header', () => {
    const projects = [makeProject({ id: 'a', category: 'Work' }), makeProject({ id: 'b', category: 'Home' })];
    const reordered = groupProjectsByCategory(projects, ['Work', 'Home']);
    // Move project 'b' up into the Work section (right after its header).
    const workHeaderIdx = reordered.findIndex(i => i.type === 'header' && i.label === 'Work');
    const bIdx = reordered.findIndex(i => i.type === 'project' && i.project.id === 'b');
    const moved = reordered.slice();
    const [b] = moved.splice(bIdx, 1);
    moved.splice(workHeaderIdx + 1, 0, b);

    const { categoryUpdates, settled } = reorder(moved);
    expect(categoryUpdates).toEqual([{ id: 'b', category: 'Work' }]);
    expect(settled.filter(i => i.type === 'header')).toHaveLength(1);
  });

  it('uncategorizes a project dragged above every header', () => {
    const projects = [makeProject({ id: 'a', category: 'Work' })];
    const reordered = groupProjectsByCategory(projects, ['Work']);
    const aItem = reordered.find(i => i.type === 'project')!;
    const moved: ProjectListItem[] = [aItem, ...reordered.filter(i => i !== aItem)];

    const { categoryUpdates } = reorder(moved);
    expect(categoryUpdates).toEqual([{ id: 'a', category: null }]);
  });
});
