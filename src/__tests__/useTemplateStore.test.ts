import { useTemplateStore } from '../store/useTemplateStore';
import {
  dbInsertTemplate,
  dbUpdateTemplate,
  dbDeleteTemplate,
  dbGetAllTemplates,
  dbTransaction,
} from '../db/database';
import type { TaskTemplate, TemplateItem, TaskDraft } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllTemplates: jest.fn().mockReturnValue([]),
  dbInsertTemplate: jest.fn(),
  dbUpdateTemplate: jest.fn(),
  dbDeleteTemplate: jest.fn(),
  dbTransaction: jest.fn((fn: () => void) => fn()),
}));

const mockAddTask = jest.fn();
const mockAddSubtask = jest.fn();
const mockGroupTasks = jest.fn();
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: {
    getState: () => ({ addTask: mockAddTask, addSubtask: mockAddSubtask, groupTasks: mockGroupTasks }),
  },
}));

const makeItem = (overrides: Partial<TemplateItem> = {}): TemplateItem => ({
  id: 'item-1',
  title: 'Pack bags',
  notes: '',
  optional: false,
  anchor: 'start',
  dueOffsetDays: null,
  deferOffsetDays: null,
  deadlineOffsetDays: null,
  windowStart: null,
  windowEnd: null,
  reminderOffsetMinutes: null,
  timeSegments: [],
  tags: [],
  category: null,
  priority: 0,
  effort: 0,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceFromCompletion: false,
  recurrenceCount: null,
  vacationPause: false,
  estimatedMinutes: null,
  chainEnabled: false,
  chainItems: [],
  subtasks: [],
  groupId: null,
  refTemplateId: null,
  refTemplateName: '',
  ...overrides,
});

const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'tpl-1',
  name: 'Pre-vacation',
  items: [],
  itemGroups: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllTemplates as jest.Mock).mockReturnValue([]);
  mockAddTask.mockImplementation((draft: Partial<TaskDraft>) => ({ id: `task-${draft.title}`, ...draft }));
  mockAddSubtask.mockImplementation((parentId: string, title: string) => ({ id: `sub-${title}`, parentId, title }));
  mockGroupTasks.mockImplementation((taskIds: string[], title: string, category: string | null) => ({
    id: `group-${title}`, title, category, taskIds,
  }));
  useTemplateStore.setState({ templates: [], initialized: false });
});

describe('initialize', () => {
  it('loads templates from the database', () => {
    (dbGetAllTemplates as jest.Mock).mockReturnValue([makeTemplate()]);
    useTemplateStore.getState().initialize();
    expect(useTemplateStore.getState().templates).toHaveLength(1);
    expect(useTemplateStore.getState().initialized).toBe(true);
  });
});

describe('template CRUD', () => {
  it('addTemplate persists and assigns incrementing sortOrder', () => {
    const a = useTemplateStore.getState().addTemplate('A');
    const b = useTemplateStore.getState().addTemplate('B');
    expect(a.sortOrder).toBe(1);
    expect(b.sortOrder).toBe(2);
    expect(dbInsertTemplate).toHaveBeenCalledTimes(2);
    expect(useTemplateStore.getState().templates.map(t => t.name)).toEqual(['A', 'B']);
  });

  it('renameTemplate updates state and persists', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    useTemplateStore.getState().renameTemplate(tpl.id, 'Renamed');
    expect(useTemplateStore.getState().templates[0].name).toBe('Renamed');
    expect(dbUpdateTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed' }));
  });

  it('deleteTemplate removes from state and persists', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    useTemplateStore.getState().deleteTemplate(tpl.id);
    expect(useTemplateStore.getState().templates).toHaveLength(0);
    expect(dbDeleteTemplate).toHaveBeenCalledWith(tpl.id);
  });
});

describe('item CRUD', () => {
  it('addItem normalizes partial items and persists the template', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const item = useTemplateStore.getState().addItem(tpl.id, { title: 'Trash', dueOffsetDays: 0 });
    expect(item.id).toBeTruthy();
    expect(item.optional).toBe(false);
    const stored = useTemplateStore.getState().templates[0].items;
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Trash');
    expect(dbUpdateTemplate).toHaveBeenCalled();
  });

  it('updateItem patches a single item', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const item = useTemplateStore.getState().addItem(tpl.id, { title: 'Trash' });
    useTemplateStore.getState().updateItem(tpl.id, item.id, { optional: true, dueOffsetDays: -1 });
    const stored = useTemplateStore.getState().templates[0].items[0];
    expect(stored.optional).toBe(true);
    expect(stored.dueOffsetDays).toBe(-1);
  });

  it('deleteItem removes only that item', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' });
    useTemplateStore.getState().addItem(tpl.id, { title: 'B' });
    useTemplateStore.getState().deleteItem(tpl.id, a.id);
    expect(useTemplateStore.getState().templates[0].items.map(i => i.title)).toEqual(['B']);
  });

  it('reorderItems applies the given order and ignores incomplete id lists', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' });
    const b = useTemplateStore.getState().addItem(tpl.id, { title: 'B' });
    useTemplateStore.getState().reorderItems(tpl.id, [b.id, a.id]);
    expect(useTemplateStore.getState().templates[0].items.map(i => i.title)).toEqual(['B', 'A']);
    useTemplateStore.getState().reorderItems(tpl.id, [a.id]);
    expect(useTemplateStore.getState().templates[0].items).toHaveLength(2);
  });
});

describe('applyTemplate', () => {
  it('creates tasks only for the selected items', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [
          makeItem({ id: 'a', title: 'Pack' }),
          makeItem({ id: 'b', title: 'Trash' }),
          makeItem({ id: 'c', title: 'Rental car', optional: true }),
        ],
      })],
    });
    const created = useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a', 'b']), { start: null, end: null });
    expect(mockAddTask).toHaveBeenCalledTimes(2);
    expect(created).toHaveLength(2);
    expect(mockAddTask.mock.calls.map(([d]) => d.title)).toEqual(['Pack', 'Trash']);
  });

  it('runs its writes inside a single db transaction', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [makeItem({ id: 'a', title: 'Pack' }), makeItem({ id: 'b', title: 'Trash' })],
      })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a', 'b']), { start: null, end: null });
    expect(dbTransaction).toHaveBeenCalledTimes(1);
  });

  it('computes dueDate/deferUntil from the start anchor', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [makeItem({ id: 'a', title: 'Trash', anchor: 'start', dueOffsetDays: 0, deferOffsetDays: -1 })],
      })],
    });
    const start = new Date('2026-06-20T09:00:00');
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start, end: null });
    const [draft] = mockAddTask.mock.calls[0];
    expect(new Date(draft.dueDate).getDate()).toBe(20);
    expect(new Date(draft.deferUntil).getDate()).toBe(19);
  });

  it('computes dueDate from the end anchor for items pinned to "end"', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [makeItem({ id: 'a', title: 'Pack', anchor: 'end', dueOffsetDays: -2 })],
      })],
    });
    const start = new Date('2026-06-20T09:00:00');
    const end = new Date('2026-06-27T09:00:00');
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start, end });
    const [draft] = mockAddTask.mock.calls[0];
    expect(new Date(draft.dueDate).getDate()).toBe(25);
  });

  it('creates undated tasks when no anchor is given', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ items: [makeItem({ id: 'a', dueOffsetDays: -2 })] })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null });
    expect(mockAddTask.mock.calls[0][0].dueDate).toBeNull();
  });

  it('returns [] for an unknown template', () => {
    expect(useTemplateStore.getState().applyTemplate('missing', new Set(['a']), { start: null, end: null })).toEqual([]);
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  it('creates subtask rows for each item stub via addSubtask', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [makeItem({ id: 'a', title: 'Pack', subtasks: [{ id: 's1', title: 'Passport' }, { id: 's2', title: 'Charger' }] })],
      })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null });
    expect(mockAddSubtask).toHaveBeenCalledTimes(2);
    expect(mockAddSubtask).toHaveBeenCalledWith('task-Pack', 'Passport');
    expect(mockAddSubtask).toHaveBeenCalledWith('task-Pack', 'Charger');
  });

  it('carries an itemGroup into a real TaskGroup via groupTasks', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        itemGroups: [{ id: 'g1', title: 'Supplements', sortOrder: 1 }],
        items: [
          makeItem({ id: 'a', title: 'Coq10', groupId: 'g1', category: 'Health' }),
          makeItem({ id: 'b', title: 'Vitamin D', groupId: 'g1', category: 'Health' }),
          makeItem({ id: 'c', title: 'Solo task' }),
        ],
      })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a', 'b', 'c']), { start: null, end: null });
    expect(mockGroupTasks).toHaveBeenCalledTimes(1);
    expect(mockGroupTasks).toHaveBeenCalledWith(['task-Coq10', 'task-Vitamin D'], 'Supplements', 'Health');
  });

  it('expands a nested template item into that template\'s own tasks', () => {
    useTemplateStore.setState({
      templates: [
        makeTemplate({
          id: 'packing',
          name: 'Packing List',
          items: [makeItem({ id: 'p1', title: 'Passport' }), makeItem({ id: 'p2', title: 'Charger' })],
        }),
        makeTemplate({
          id: 'trip',
          name: 'Trip Planning',
          items: [
            makeItem({ id: 't1', title: 'Book flights' }),
            makeItem({ id: 't2', title: 'Packing List', refTemplateId: 'packing', refTemplateName: 'Packing List' }),
          ],
        }),
      ],
    });
    const created = useTemplateStore.getState().applyTemplate(
      'trip',
      new Set(['t1', 't2', 'p1', 'p2']),
      { start: null, end: null }
    );
    expect(created).toHaveLength(3);
    expect(mockAddTask.mock.calls.map(([d]) => d.title)).toEqual(['Book flights', 'Passport', 'Charger']);
  });

  it('groups a nested template\'s own itemGroup using that template\'s group metadata', () => {
    useTemplateStore.setState({
      templates: [
        makeTemplate({
          id: 'packing',
          name: 'Packing List',
          itemGroups: [{ id: 'g1', title: 'Documents', sortOrder: 1 }],
          items: [
            makeItem({ id: 'p1', title: 'Passport', groupId: 'g1', category: 'Travel' }),
            makeItem({ id: 'p2', title: 'Visa', groupId: 'g1', category: 'Travel' }),
          ],
        }),
        makeTemplate({
          id: 'trip',
          name: 'Trip Planning',
          items: [makeItem({ id: 't2', refTemplateId: 'packing', refTemplateName: 'Packing List' })],
        }),
      ],
    });
    useTemplateStore.getState().applyTemplate('trip', new Set(['t2', 'p1', 'p2']), { start: null, end: null });
    expect(mockGroupTasks).toHaveBeenCalledWith(['task-Passport', 'task-Visa'], 'Documents', 'Travel');
  });

  it('yields zero tasks for a ref item pointing at a deleted template', () => {
    useTemplateStore.setState({
      templates: [
        makeTemplate({
          id: 'trip',
          name: 'Trip Planning',
          items: [
            makeItem({ id: 't1', title: 'Book flights' }),
            makeItem({ id: 't2', refTemplateId: 'missing', refTemplateName: 'Gone' }),
          ],
        }),
      ],
    });
    const created = useTemplateStore.getState().applyTemplate('trip', new Set(['t1', 't2']), { start: null, end: null });
    expect(created).toHaveLength(1);
    expect(mockAddTask.mock.calls.map(([d]) => d.title)).toEqual(['Book flights']);
  });
});

describe('reorderTemplates', () => {
  it('rewrites sortOrder to match the given order', () => {
    const a = useTemplateStore.getState().addTemplate('A');
    const b = useTemplateStore.getState().addTemplate('B');
    useTemplateStore.getState().reorderTemplates([b.id, a.id]);
    expect(useTemplateStore.getState().templates.map(t => t.name)).toEqual(['B', 'A']);
    expect(useTemplateStore.getState().templates.map(t => t.sortOrder)).toEqual([1, 2]);
  });

  it('ignores incomplete id lists', () => {
    const a = useTemplateStore.getState().addTemplate('A');
    useTemplateStore.getState().addTemplate('B');
    useTemplateStore.getState().reorderTemplates([a.id]);
    expect(useTemplateStore.getState().templates).toHaveLength(2);
  });
});

describe('reorderTemplatesWithCategoryUpdates', () => {
  it('reorders and applies category changes together', () => {
    const a = useTemplateStore.getState().addTemplate('A');
    const b = useTemplateStore.getState().addTemplate('B');
    useTemplateStore.getState().reorderTemplatesWithCategoryUpdates(
      [b.id, a.id],
      [{ id: b.id, category: 'Trips' }],
    );
    expect(useTemplateStore.getState().templates.map(t => t.name)).toEqual(['B', 'A']);
    expect(useTemplateStore.getState().templates.find(t => t.id === b.id)?.category).toBe('Trips');
  });
});

describe('item groups', () => {
  it('addItemGroup creates a group scoped to the template', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const group = useTemplateStore.getState().addItemGroup(tpl.id, 'Supplements');
    expect(group.title).toBe('Supplements');
    expect(useTemplateStore.getState().templates[0].itemGroups).toHaveLength(1);
  });

  it('renameItemGroup updates the title', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const group = useTemplateStore.getState().addItemGroup(tpl.id, 'Supplements');
    useTemplateStore.getState().renameItemGroup(tpl.id, group.id, 'Vitamins');
    expect(useTemplateStore.getState().templates[0].itemGroups[0].title).toBe('Vitamins');
  });

  it('deleteItemGroup ungroups member items instead of deleting them', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' });
    const group = useTemplateStore.getState().addItemGroup(tpl.id, 'Supplements');
    useTemplateStore.getState().updateItem(tpl.id, a.id, { groupId: group.id });
    useTemplateStore.getState().deleteItemGroup(tpl.id, group.id);
    const state = useTemplateStore.getState().templates[0];
    expect(state.itemGroups).toHaveLength(0);
    expect(state.items[0].groupId).toBeNull();
  });

  it('groupItems creates a group and stamps groupId on the given items in one call', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' });
    const b = useTemplateStore.getState().addItem(tpl.id, { title: 'B' });
    useTemplateStore.getState().addItem(tpl.id, { title: 'C' });
    const group = useTemplateStore.getState().groupItems(tpl.id, [a.id, b.id], 'Errands');
    const state = useTemplateStore.getState().templates[0];
    expect(state.itemGroups.map(g => g.title)).toEqual(['Errands']);
    expect(state.items.find(i => i.id === a.id)?.groupId).toBe(group.id);
    expect(state.items.find(i => i.id === b.id)?.groupId).toBe(group.id);
    expect(state.items.find(i => i.title === 'C')?.groupId).toBeNull();
  });
});
