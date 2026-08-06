import { groupTemplatesByCategory, resolveTemplateDrop, type TemplateListItem } from '../utils/templateGrouping';
import type { TaskTemplate } from '../types';

const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'template-1',
  name: 'Test Template',
  items: [],
  itemGroups: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  applyContainer: 'stack',
  ...overrides,
});

describe('groupTemplatesByCategory', () => {
  it('renders uncategorized templates first with no header, then named categories in order', () => {
    const templates = [
      makeTemplate({ id: 'a', category: 'Trips' }),
      makeTemplate({ id: 'b', category: null }),
      makeTemplate({ id: 'c', category: 'Chores' }),
    ];
    const items = groupTemplatesByCategory(templates, ['Chores', 'Trips']);
    expect(items.map(i => (i.type === 'header' ? `h:${i.label}` : i.template.id))).toEqual([
      'b', 'h:Chores', 'c', 'h:Trips', 'a',
    ]);
  });
});

describe('resolveTemplateDrop', () => {
  const reorder = (items: TemplateListItem[]) => resolveTemplateDrop(items, ['Chores', 'Trips']);

  it('leaves category unchanged when a template stays under the same header', () => {
    const templates = [makeTemplate({ id: 'a', category: 'Chores' }), makeTemplate({ id: 'b', category: 'Chores' })];
    const reordered = groupTemplatesByCategory(templates, ['Chores']);
    const { categoryUpdates } = reorder(reordered);
    expect(categoryUpdates).toEqual([]);
  });

  it('recategorizes a template dropped under a different header', () => {
    const templates = [makeTemplate({ id: 'a', category: 'Chores' }), makeTemplate({ id: 'b', category: 'Trips' })];
    const reordered = groupTemplatesByCategory(templates, ['Chores', 'Trips']);
    const choresHeaderIdx = reordered.findIndex(i => i.type === 'header' && i.label === 'Chores');
    const bIdx = reordered.findIndex(i => i.type === 'template' && i.template.id === 'b');
    const moved = reordered.slice();
    const [b] = moved.splice(bIdx, 1);
    moved.splice(choresHeaderIdx + 1, 0, b);

    const { categoryUpdates, settled } = reorder(moved);
    expect(categoryUpdates).toEqual([{ id: 'b', category: 'Chores' }]);
    expect(settled.filter(i => i.type === 'header')).toHaveLength(1);
  });

  it('uncategorizes a template dragged above every header', () => {
    const templates = [makeTemplate({ id: 'a', category: 'Chores' })];
    const reordered = groupTemplatesByCategory(templates, ['Chores']);
    const aItem = reordered.find(i => i.type === 'template')!;
    const moved: TemplateListItem[] = [aItem, ...reordered.filter(i => i !== aItem)];

    const { categoryUpdates } = reorder(moved);
    expect(categoryUpdates).toEqual([{ id: 'a', category: null }]);
  });
});
