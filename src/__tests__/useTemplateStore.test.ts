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

const mockCreateGroup = jest.fn();
jest.mock('../store/useTaskGroupStore', () => ({
  useTaskGroupStore: { getState: () => ({ createGroup: mockCreateGroup }) },
}));

const mockCreateProject = jest.fn();
jest.mock('../store/useProjectStore', () => ({
  useProjectStore: { getState: () => ({ createProject: mockCreateProject }) },
}));

// checkScheduledTemplates reads vacationMode/weekStartsOn/dayResetTime, and
// templateSchedule reaches dateUtils which reaches this store too.
const mockSettings = { vacationMode: false, weekStartsOn: 0 as const, dayResetTime: '00:00' };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
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
  deliverableKind: null,
  chainEnabled: false,
  chainItems: [],
  chainIndex: 0,
  subtasks: [],
  groupId: null,
  refTemplateId: null,
  refTemplateName: '',
  conditions: [],
  ...overrides,
});

const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'tpl-1',
  name: 'Pre-vacation',
  items: [],
  itemGroups: [],
  questions: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  category: null,
  applyContainer: 'stack',
  schedule: null,
  scheduleLastFiredKey: null,
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
  mockCreateGroup.mockImplementation((title: string, category: string | null) => ({
    id: `group-${title}`, title, category,
  }));
  mockCreateProject.mockImplementation((title: string, targetStartDate: string | null, targetEndDate: string | null) => ({
    id: `project-${title}`, title, targetStartDate, targetEndDate,
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

  it('removeTemplateRow removes from state and persists', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    useTemplateStore.getState().removeTemplateRow(tpl.id);
    expect(useTemplateStore.getState().templates).toHaveLength(0);
    expect(dbDeleteTemplate).toHaveBeenCalledWith(tpl.id);
  });

  it('restoreTemplate re-inserts a template snapshot', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    useTemplateStore.getState().removeTemplateRow(tpl.id);
    useTemplateStore.getState().restoreTemplate(tpl);
    expect(useTemplateStore.getState().templates.map(t => t.id)).toEqual([tpl.id]);
    expect(dbInsertTemplate).toHaveBeenCalledWith(tpl);
  });
});

describe('item CRUD', () => {
  it('addItem normalizes partial items and persists the template', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const item = useTemplateStore.getState().addItem(tpl.id, { title: 'Trash', dueOffsetDays: 0 })!;
    expect(item.id).toBeTruthy();
    expect(item.optional).toBe(false);
    const stored = useTemplateStore.getState().templates[0].items;
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('Trash');
    expect(dbUpdateTemplate).toHaveBeenCalled();
  });

  // The regression this guards: addItem used to return the item it *would*
  // have stored even when the template was gone, so a caller couldn't tell an
  // add apart from a no-op and dismissed its sheet either way. Every add
  // surface reports failure now, so this must stay falsy.
  it('addItem stores nothing and returns null for an unknown template', () => {
    useTemplateStore.getState().addTemplate('A');
    (dbUpdateTemplate as jest.Mock).mockClear();
    const item = useTemplateStore.getState().addItem('no-such-template', { title: 'Trash' });
    expect(item).toBeNull();
    expect(useTemplateStore.getState().templates[0].items).toHaveLength(0);
    expect(dbUpdateTemplate).not.toHaveBeenCalled();
  });

  it('updateItem patches a single item', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const item = useTemplateStore.getState().addItem(tpl.id, { title: 'Trash' })!;
    useTemplateStore.getState().updateItem(tpl.id, item.id, { optional: true, dueOffsetDays: -1 });
    const stored = useTemplateStore.getState().templates[0].items[0];
    expect(stored.optional).toBe(true);
    expect(stored.dueOffsetDays).toBe(-1);
  });

  it('deleteItem removes only that item', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' })!;
    useTemplateStore.getState().addItem(tpl.id, { title: 'B' });
    useTemplateStore.getState().deleteItem(tpl.id, a.id);
    expect(useTemplateStore.getState().templates[0].items.map(i => i.title)).toEqual(['B']);
  });

  it('reorderItems applies the given order and ignores incomplete id lists', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' })!;
    const b = useTemplateStore.getState().addItem(tpl.id, { title: 'B' })!;
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

  it('carries an item\'s deliverableKind onto the task it creates (#1471)', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [
          makeItem({ id: 'a', title: 'Pick dates', deliverableKind: 'date' }),
          makeItem({ id: 'b', title: 'Pack' }),
        ],
      })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a', 'b']), { start: null, end: null });
    expect(mockAddTask.mock.calls[0][0].deliverableKind).toBe('date');
    expect(mockAddTask.mock.calls[1][0].deliverableKind).toBeNull();
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
        questions: [],
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
          questions: [],
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

describe('questions', () => {
  it('addQuestion stores a normalized question', () => {
    const tpl = useTemplateStore.getState().addTemplate('Packing list');
    const q = useTemplateStore.getState().addQuestion(tpl.id, {
      prompt: 'What kind of trip?',
      name: 'trip type',
      kind: 'choice',
      options: ['Work', 'Vacation'],
    })!;
    expect(q.id).toBeTruthy();
    expect(useTemplateStore.getState().templates[0].questions).toEqual([
      { ...q, defaultValue: '', fromDates: 'none' },
    ]);
  });

  it('addQuestion returns null for a template that no longer exists', () => {
    expect(useTemplateStore.getState().addQuestion('gone', { prompt: 'x' })).toBeNull();
  });

  it('updateQuestion normalizes what it is handed — a source only a number can have is dropped', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const q = useTemplateStore.getState().addQuestion(tpl.id, { prompt: 'How many nights?', kind: 'number', fromDates: 'nights' })!;
    expect(q.fromDates).toBe('nights');
    useTemplateStore.getState().updateQuestion(tpl.id, q.id, { kind: 'text' });
    expect(useTemplateStore.getState().templates[0].questions[0].fromDates).toBe('none');
  });

  // A dangling condition is already shrugged off by every reader, but an item
  // still carrying one would show an "Only when" with nothing under it.
  it('deleteQuestion takes the question off the items conditioned on it', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const q = useTemplateStore.getState().addQuestion(tpl.id, { prompt: 'Kind?', kind: 'choice', options: ['Work'] })!;
    const other = useTemplateStore.getState().addQuestion(tpl.id, { prompt: 'Long?', kind: 'choice', options: ['Yes'] })!;
    const item = useTemplateStore.getState().addItem(tpl.id, { title: 'Laptop' })!;
    useTemplateStore.getState().updateItem(tpl.id, item.id, {
      conditions: [{ questionId: q.id, values: ['Work'] }, { questionId: other.id, values: ['Yes'] }],
    });
    useTemplateStore.getState().deleteQuestion(tpl.id, q.id);
    const state = useTemplateStore.getState().templates[0];
    expect(state.questions.map(x => x.id)).toEqual([other.id]);
    expect(state.items[0].conditions).toEqual([{ questionId: other.id, values: ['Yes'] }]);
  });

  it('reorderQuestions rewrites the order, and refuses a list that does not name every one', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addQuestion(tpl.id, { prompt: 'A' })!;
    const b = useTemplateStore.getState().addQuestion(tpl.id, { prompt: 'B' })!;
    useTemplateStore.getState().reorderQuestions(tpl.id, [b.id, a.id]);
    expect(useTemplateStore.getState().templates[0].questions.map(q => q.prompt)).toEqual(['B', 'A']);
    useTemplateStore.getState().reorderQuestions(tpl.id, [a.id]);
    expect(useTemplateStore.getState().templates[0].questions.map(q => q.prompt)).toEqual(['B', 'A']);
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
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' })!;
    const group = useTemplateStore.getState().addItemGroup(tpl.id, 'Supplements');
    useTemplateStore.getState().updateItem(tpl.id, a.id, { groupId: group.id });
    useTemplateStore.getState().deleteItemGroup(tpl.id, group.id);
    const state = useTemplateStore.getState().templates[0];
    expect(state.itemGroups).toHaveLength(0);
    expect(state.items[0].groupId).toBeNull();
  });

  it('groupItems creates a group and stamps groupId on the given items in one call', () => {
    const tpl = useTemplateStore.getState().addTemplate('A');
    const a = useTemplateStore.getState().addItem(tpl.id, { title: 'A' })!;
    const b = useTemplateStore.getState().addItem(tpl.id, { title: 'B' })!;
    useTemplateStore.getState().addItem(tpl.id, { title: 'C' });
    const group = useTemplateStore.getState().groupItems(tpl.id, [a.id, b.id], 'Errands');
    const state = useTemplateStore.getState().templates[0];
    expect(state.itemGroups.map(g => g.title)).toEqual(['Errands']);
    expect(state.items.find(i => i.id === a.id)?.groupId).toBe(group.id);
    expect(state.items.find(i => i.id === b.id)?.groupId).toBe(group.id);
    expect(state.items.find(i => i.title === 'C')?.groupId).toBeNull();
  });
});

describe('applyTemplate — naming the run', () => {
  const oneItem = (overrides: Partial<TemplateItem> = {}) =>
    makeTemplate({ items: [makeItem({ id: 'a', title: 'Buy tickets', ...overrides })] });

  it('creates no container and changes no title when the run is unnamed', () => {
    useTemplateStore.setState({ templates: [oneItem()] });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null });
    expect(mockCreateGroup).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
    const [draft] = mockAddTask.mock.calls[0];
    expect(draft.title).toBe('Buy tickets');
    expect(draft.groupId).toBeUndefined();
    expect(draft.projectId).toBeUndefined();
  });

  it('treats a whitespace-only run name as unnamed', () => {
    useTemplateStore.setState({ templates: [oneItem()] });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null }, { runName: '   ' });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it('files every created task under one stack named after the run', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [makeItem({ id: 'a', title: 'Buy tickets' }), makeItem({ id: 'b', title: 'Decide date' })],
      })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a', 'b']), { start: null, end: null }, { runName: 'Camping w/ Dan' }
    );
    expect(mockCreateGroup).toHaveBeenCalledWith('Camping w/ Dan', null);
    expect(mockAddTask.mock.calls.map(([d]) => d.groupId)).toEqual(['group-Camping w/ Dan', 'group-Camping w/ Dan']);
  });

  it('files the run stack under the category its items share, and stamps it onto every task (#1750)', () => {
    // Before this, a run stack was always created uncategorized
    // (createGroup(runName, null)), so it filed under Uncategorized on
    // Today no matter what category its items were configured with —
    // makeCategoryGroups sorts a stack by its own category, not its
    // members'. Members must adopt it too, the same "stack members share
    // the stack's category" rule groupTasks/applyGroupCategory enforce
    // everywhere else a stack exists.
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [
          makeItem({ id: 'a', title: 'Buy tickets', category: 'Health' }),
          makeItem({ id: 'b', title: 'Decide date', category: 'Health' }),
        ],
      })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a', 'b']), { start: null, end: null }, { runName: 'Camping w/ Dan' }
    );
    expect(mockCreateGroup).toHaveBeenCalledWith('Camping w/ Dan', 'Health');
    expect(mockAddTask.mock.calls.map(([d]) => d.category)).toEqual(['Health', 'Health']);
  });

  it('takes the category most of the run\'s items share when they disagree', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [
          makeItem({ id: 'a', title: 'Buy tickets', category: 'Health' }),
          makeItem({ id: 'b', title: 'Decide date', category: 'Health' }),
          makeItem({ id: 'c', title: 'Odd one out', category: 'Work' }),
        ],
      })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a', 'b', 'c']), { start: null, end: null }, { runName: 'Camping w/ Dan' }
    );
    expect(mockCreateGroup).toHaveBeenCalledWith('Camping w/ Dan', 'Health');
    expect(mockAddTask.mock.calls.map(([d]) => d.category)).toEqual(['Health', 'Health', 'Health']);
  });

  it('trims the run name before it becomes a container title', () => {
    useTemplateStore.setState({ templates: [oneItem()] });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a']), { start: null, end: null }, { runName: '  Camping  ' }
    );
    expect(mockCreateGroup).toHaveBeenCalledWith('Camping', null);
  });

  it('creates a project dated by the two anchors when the template asks for one', () => {
    const start = new Date('2026-09-12T12:00:00');
    const end = new Date('2026-09-14T12:00:00');
    useTemplateStore.setState({ templates: [makeTemplate({ applyContainer: 'project', items: [makeItem({ id: 'a' })] })] });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start, end }, { runName: 'Denver' });
    expect(mockCreateProject).toHaveBeenCalledWith('Denver', start.toISOString(), end.toISOString());
    expect(mockAddTask.mock.calls[0][0].projectId).toBe('project-Denver');
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it('leaves a project undated when the run picked no anchors', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ applyContainer: 'project', items: [makeItem({ id: 'a' })] })] });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null }, { runName: 'Denver' });
    expect(mockCreateProject).toHaveBeenCalledWith('Denver', null, null);
  });

  it('honors a template that opts out of containers entirely', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ applyContainer: 'none', items: [makeItem({ id: 'a' })] })] });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null }, { runName: 'Denver' });
    expect(mockCreateGroup).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it('upgrades a run stack to a project when the template already makes stacks from item groups', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        applyContainer: 'stack',
        schedule: null,
        scheduleLastFiredKey: null,
        itemGroups: [{ id: 'g1', title: 'Flights', sortOrder: 1 }],
        questions: [],
        items: [makeItem({ id: 'a', title: 'Book', groupId: 'g1' })],
      })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null }, { runName: 'Denver' });
    // The run becomes the project; the item group still becomes its own stack inside it.
    expect(mockCreateProject).toHaveBeenCalledWith('Denver', null, null);
    expect(mockCreateGroup).not.toHaveBeenCalled();
    expect(mockGroupTasks).toHaveBeenCalledWith(['task-Book'], 'Flights', null);
    expect(mockAddTask.mock.calls[0][0].projectId).toBe('project-Denver');
  });

  it('creates one run task and turns every item into a subtask of it when the template asks for a task', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        applyContainer: 'task',
        items: [makeItem({ id: 'a', title: 'Buy tickets' }), makeItem({ id: 'b', title: 'Decide date' })],
      })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a', 'b']), { start: null, end: null }, { runName: 'Camping w/ Dan' }
    );
    expect(mockCreateGroup).not.toHaveBeenCalled();
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockAddTask.mock.calls[0][0]).toEqual(expect.objectContaining({ title: 'Camping w/ Dan' }));
    const itemCalls = mockAddTask.mock.calls.slice(1);
    expect(itemCalls.map(([d]) => d.title)).toEqual(['Buy tickets', 'Decide date']);
    expect(itemCalls.every(([d]) => d.parentId === 'task-Camping w/ Dan')).toBe(true);
    expect(itemCalls.every(([d]) => d.groupId === undefined)).toBe(true);
  });

  it('categorizes the run task by the category most of its items share, same as a run stack (#1748)', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        applyContainer: 'task',
        items: [
          makeItem({ id: 'a', title: 'Buy tickets', category: 'Health' }),
          makeItem({ id: 'b', title: 'Decide date', category: 'Health' }),
          makeItem({ id: 'c', title: 'Odd one out', category: 'Work' }),
        ],
      })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a', 'b', 'c']), { start: null, end: null }, { runName: 'Camping w/ Dan' }
    );
    expect(mockAddTask.mock.calls[0][0].category).toBe('Health');
    // Unlike a run stack, the individual subtasks keep their own category —
    // subtasks aren't independently filterable by category anywhere.
    expect(mockAddTask.mock.calls.slice(1).map(([d]) => d.category)).toEqual(['Health', 'Health', 'Work']);
  });

  it("flattens an item's own subtask stubs onto the run task, since a subtask of a subtask renders nowhere", () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        applyContainer: 'task',
        items: [makeItem({ id: 'a', title: 'Buy tickets', subtasks: [{ id: 's1', title: 'Compare prices' }] })],
      })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null }, { runName: 'Denver' });
    expect(mockAddSubtask).toHaveBeenCalledWith('task-Denver', 'Compare prices');
  });

  it("does not stack an item group's members into a sub-stack when the run is a task — they're already subtasks", () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        applyContainer: 'task',
        itemGroups: [{ id: 'g1', title: 'Flights', sortOrder: 1 }],
        questions: [],
        items: [makeItem({ id: 'a', title: 'Book', groupId: 'g1' })],
      })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null }, { runName: 'Denver' });
    expect(mockGroupTasks).not.toHaveBeenCalled();
    expect(mockAddTask.mock.calls[1][0].parentId).toBe('task-Denver');
  });

  it('lands the run task inside a target project without giving its subtasks their own projectId', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ applyContainer: 'task', items: [makeItem({ id: 'a', title: 'Buy tickets' })] })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a']), { start: null, end: null }, { runName: 'Denver', targetProjectId: 'proj-1' }
    );
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockAddTask.mock.calls[0][0]).toEqual(expect.objectContaining({ title: 'Denver', projectId: 'proj-1' }));
    expect(mockAddTask.mock.calls[1][0].projectId).toBeUndefined();
  });
});

describe('applyTemplate — placeholders', () => {
  it('substitutes values into titles and notes', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ items: [makeItem({ id: 'a', title: 'Book {where}', notes: 'ask {who}' })] })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a']), { start: null, end: null },
      { placeholders: { where: 'Denver', who: 'Dan' } }
    );
    const [draft] = mockAddTask.mock.calls[0];
    expect(draft.title).toBe('Book Denver');
    expect(draft.notes).toBe('ask Dan');
  });

  it('binds {run} to the run name without a separate input', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ items: [makeItem({ id: 'a', title: 'Put in for PTO for {run}' })] })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a']), { start: null, end: null }, { runName: 'Camping w/ Dan' }
    );
    expect(mockAddTask.mock.calls[0][0].title).toBe('Put in for PTO for Camping w/ Dan');
  });

  it('drops an unfilled {run} rather than leaving braces in the task title', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ items: [makeItem({ id: 'a', title: 'Put in for PTO for {run}' })] })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null });
    expect(mockAddTask.mock.calls[0][0].title).toBe('Put in for PTO for');
  });

  it('substitutes into subtask titles too', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [makeItem({ id: 'a', title: 'Pack', subtasks: [{ id: 's1', title: 'Charge the {device}' }] })],
      })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a']), { start: null, end: null }, { placeholders: { device: 'headlamp' } }
    );
    expect(mockAddSubtask).toHaveBeenCalledWith('task-Pack', 'Charge the headlamp');
  });

  it('carries placeholder values into items pulled from a nested template', () => {
    useTemplateStore.setState({
      templates: [
        makeTemplate({ id: 'tpl-1', items: [makeItem({ id: 'ref', refTemplateId: 'tpl-2', refTemplateName: 'Packing' })] }),
        makeTemplate({ id: 'tpl-2', name: 'Packing', items: [makeItem({ id: 'n1', title: 'Pack for {where}' })] }),
      ],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['ref', 'n1']), { start: null, end: null }, { placeholders: { where: 'Denver' } }
    );
    expect(mockAddTask.mock.calls[0][0].title).toBe('Pack for Denver');
  });
});

describe('applyTemplate — personIds', () => {
  it('stamps personIds onto every task the run creates', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({
        items: [makeItem({ id: 'a', title: 'Book campsite' }), makeItem({ id: 'b', title: 'Pack tent' })],
      })],
    });
    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a', 'b']), { start: null, end: null },
      { personIds: ['p1', 'p2'] }
    );
    expect(mockAddTask.mock.calls[0][0].personIds).toEqual(['p1', 'p2']);
    expect(mockAddTask.mock.calls[1][0].personIds).toEqual(['p1', 'p2']);
  });

  it('leaves personIds untouched when none are named — omitted or empty alike', () => {
    useTemplateStore.setState({
      templates: [makeTemplate({ items: [makeItem({ id: 'a', title: 'Book campsite' })] })],
    });
    useTemplateStore.getState().applyTemplate('tpl-1', new Set(['a']), { start: null, end: null });
    expect(mockAddTask.mock.calls[0][0].personIds).toBeUndefined();

    useTemplateStore.getState().applyTemplate(
      'tpl-1', new Set(['a']), { start: null, end: null }, { personIds: [] }
    );
    expect(mockAddTask.mock.calls[1][0].personIds).toBeUndefined();
  });
});

describe('setTemplateContainer', () => {
  it('persists the choice', () => {
    useTemplateStore.setState({ templates: [makeTemplate()] });
    useTemplateStore.getState().setTemplateContainer('tpl-1', 'project');
    expect(useTemplateStore.getState().templates[0].applyContainer).toBe('project');
    expect(dbUpdateTemplate).toHaveBeenCalledWith(expect.objectContaining({ applyContainer: 'project' }));
  });

  it('ignores an unknown template', () => {
    useTemplateStore.setState({ templates: [] });
    expect(() => useTemplateStore.getState().setTemplateContainer('nope', 'none')).not.toThrow();
    expect(dbUpdateTemplate).not.toHaveBeenCalled();
  });
});

describe('bulkSetTemplateCategory', () => {
  it('files every named template, leaving the rest alone', () => {
    useTemplateStore.setState({
      templates: [
        makeTemplate({ id: 'tpl-1', category: null }),
        makeTemplate({ id: 'tpl-2', category: 'Chores' }),
        makeTemplate({ id: 'tpl-3', category: null }),
      ],
    });
    useTemplateStore.getState().bulkSetTemplateCategory(['tpl-1', 'tpl-2'], 'Trips');
    expect(useTemplateStore.getState().templates.map(t => t.category)).toEqual(['Trips', 'Trips', null]);
    expect(dbUpdateTemplate).toHaveBeenCalledTimes(2);
  });

  it('clears the category when passed null', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ id: 'tpl-1', category: 'Trips' })] });
    useTemplateStore.getState().bulkSetTemplateCategory(['tpl-1'], null);
    expect(useTemplateStore.getState().templates[0].category).toBeNull();
  });

  it('writes nothing when every named template already has that category', () => {
    useTemplateStore.setState({ templates: [makeTemplate({ id: 'tpl-1', category: 'Trips' })] });
    useTemplateStore.getState().bulkSetTemplateCategory(['tpl-1', 'missing'], 'Trips');
    expect(dbUpdateTemplate).not.toHaveBeenCalled();
  });
});

describe('renameItemCategory', () => {
  const seed = (templates: TaskTemplate[]) => {
    useTemplateStore.setState({ templates, initialized: true });
    (dbUpdateTemplate as jest.Mock).mockClear();
  };

  it('rewrites every item that named the old category', () => {
    seed([makeTemplate({
      id: 'tpl-1',
      items: [
        makeItem({ id: 'a', category: 'Errands' }),
        makeItem({ id: 'b', category: 'Home' }),
        makeItem({ id: 'c', category: 'Errands' }),
      ],
    })]);

    useTemplateStore.getState().renameItemCategory('Errands', 'Chores');

    const items = useTemplateStore.getState().templates[0].items;
    expect(items.map(i => i.category)).toEqual(['Chores', 'Home', 'Chores']);
  });

  it('rewrites across several templates and persists each one touched', () => {
    seed([
      makeTemplate({ id: 'tpl-1', items: [makeItem({ id: 'a', category: 'Errands' })] }),
      makeTemplate({ id: 'tpl-2', items: [makeItem({ id: 'b', category: 'Errands' })] }),
    ]);

    useTemplateStore.getState().renameItemCategory('Errands', 'Chores');

    expect(dbUpdateTemplate).toHaveBeenCalledTimes(2);
    expect(useTemplateStore.getState().templates.flatMap(t => t.items).map(i => i.category))
      .toEqual(['Chores', 'Chores']);
  });

  it('leaves untouched templates alone, and does not write them back', () => {
    const untouched = makeTemplate({ id: 'tpl-2', items: [makeItem({ id: 'b', category: 'Home' })] });
    seed([
      makeTemplate({ id: 'tpl-1', items: [makeItem({ id: 'a', category: 'Errands' })] }),
      untouched,
    ]);

    useTemplateStore.getState().renameItemCategory('Errands', 'Chores');

    // One write, for the one template that actually mentioned the old name.
    expect(dbUpdateTemplate).toHaveBeenCalledTimes(1);
    expect((dbUpdateTemplate as jest.Mock).mock.calls[0][0].id).toBe('tpl-1');
    // And the untouched template keeps its identity, so nothing downstream
    // re-renders for a rename that didn't concern it.
    expect(useTemplateStore.getState().templates[1]).toBe(untouched);
  });

  it('does nothing when no item names the old category', () => {
    seed([makeTemplate({ items: [makeItem({ category: 'Home' })] })]);

    useTemplateStore.getState().renameItemCategory('Errands', 'Chores');

    expect(dbUpdateTemplate).not.toHaveBeenCalled();
  });

  it('does nothing when the name is unchanged', () => {
    seed([makeTemplate({ items: [makeItem({ category: 'Errands' })] })]);

    useTemplateStore.getState().renameItemCategory('Errands', 'Errands');

    expect(dbUpdateTemplate).not.toHaveBeenCalled();
  });

  it('leaves an item with no category null rather than adopting the new name', () => {
    seed([makeTemplate({ items: [makeItem({ id: 'a', category: null })] })]);

    useTemplateStore.getState().renameItemCategory('Errands', 'Chores');

    expect(useTemplateStore.getState().templates[0].items[0].category).toBeNull();
    expect(dbUpdateTemplate).not.toHaveBeenCalled();
  });

  it('matches exactly, so a differently-cased category is left alone', () => {
    seed([makeTemplate({ items: [makeItem({ id: 'a', category: 'errands' })] })]);

    useTemplateStore.getState().renameItemCategory('Errands', 'Chores');

    expect(useTemplateStore.getState().templates[0].items[0].category).toBe('errands');
  });
});

// ─── scheduled applies (#1781) ──────────────────────────────────────────────

describe('setSchedule', () => {
  const weekly = {
    frequency: 'weekly' as const,
    weekday: 0,
    monthDay: 1,
    month: 1,
    time: '09:00',
    anchorSpanDays: null,
  };

  beforeEach(() => {
    (dbGetAllTemplates as jest.Mock).mockReturnValue([makeTemplate()]);
    useTemplateStore.getState().initialize();
  });

  it('stores a schedule on the template', () => {
    useTemplateStore.getState().setSchedule('tpl-1', weekly);
    expect(useTemplateStore.getState().templates[0].schedule).toEqual(weekly);
  });

  // Editing the schedule asks a new question about this period, which this
  // period hasn't answered — see the note on setSchedule.
  it('clears the last-fired key when the schedule changes', () => {
    (dbGetAllTemplates as jest.Mock).mockReturnValue([
      makeTemplate({ schedule: weekly, scheduleLastFiredKey: '2026-08-23' }),
    ]);
    useTemplateStore.getState().initialize();

    useTemplateStore.getState().setSchedule('tpl-1', { ...weekly, weekday: 3 });
    expect(useTemplateStore.getState().templates[0].scheduleLastFiredKey).toBeNull();
  });

  it('keeps the key when the schedule is re-set to the same values', () => {
    (dbGetAllTemplates as jest.Mock).mockReturnValue([
      makeTemplate({ schedule: weekly, scheduleLastFiredKey: '2026-08-23' }),
    ]);
    useTemplateStore.getState().initialize();

    useTemplateStore.getState().setSchedule('tpl-1', { ...weekly });
    expect(useTemplateStore.getState().templates[0].scheduleLastFiredKey).toBe('2026-08-23');
  });

  it('turns firing off without forgetting which period already ran', () => {
    (dbGetAllTemplates as jest.Mock).mockReturnValue([
      makeTemplate({ schedule: weekly, scheduleLastFiredKey: '2026-08-23' }),
    ]);
    useTemplateStore.getState().initialize();

    useTemplateStore.getState().setSchedule('tpl-1', null);
    expect(useTemplateStore.getState().templates[0].schedule).toBeNull();
  });
});

describe('checkScheduledTemplates', () => {
  const weekly = {
    frequency: 'weekly' as const,
    weekday: 0,
    monthDay: 1,
    month: 1,
    time: '09:00',
    anchorSpanDays: null,
  };

  // Sunday 23 Aug 2026, 10am — past a 09:00 trigger.
  const SUNDAY_10AM = new Date(2026, 7, 23, 10, 0, 0);

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(SUNDAY_10AM);
    mockSettings.vacationMode = false;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function seedDue(overrides: Partial<TaskTemplate> = {}) {
    (dbGetAllTemplates as jest.Mock).mockReturnValue([
      makeTemplate({
        name: 'Sunday reset',
        schedule: weekly,
        items: [makeItem({ id: 'i1', title: 'Laundry' })],
        ...overrides,
      }),
    ]);
    useTemplateStore.getState().initialize();
  }

  it('applies a template whose schedule has come due', () => {
    seedDue();
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Laundry' }));
  });

  it('names the run with its own date, so two firings are told apart', () => {
    seedDue();
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockCreateGroup).toHaveBeenCalledWith('Sunday reset · 23 Aug', null);
  });

  it('records the period so a second launch the same week does nothing', () => {
    seedDue();
    useTemplateStore.getState().checkScheduledTemplates();
    expect(useTemplateStore.getState().templates[0].scheduleLastFiredKey).toBe('2026-08-23');

    mockAddTask.mockClear();
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  it('leaves a template with no schedule alone', () => {
    seedDue({ schedule: null });
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  // Vacation is a deliberate "hide work from me", and the period is
  // deliberately not consumed while it's on.
  it('writes nothing during vacation, and does not burn the period', () => {
    mockSettings.vacationMode = true;
    seedDue();
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask).not.toHaveBeenCalled();
    expect(useTemplateStore.getState().templates[0].scheduleLastFiredKey).toBeNull();

    mockSettings.vacationMode = false;
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask).toHaveBeenCalled();
  });

  it('answers a template’s questions with their own defaults', () => {
    seedDue({
      questions: [{
        id: 'q1',
        name: 'trip',
        prompt: 'What kind?',
        kind: 'choice',
        options: ['Work', 'Leisure'],
        defaultValue: '',
        fromDates: 'none',
      }],
      items: [makeItem({ id: 'i1', title: 'Pack for a {trip} trip' })],
    });
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Pack for a Work trip' })
    );
  });

  // The safety property the whole 'people' question design rests on: nobody
  // is present to answer an unattended run, so it must never name anyone,
  // even when the template carries a 'people' question. See
  // personIdsForAnswers and defaultAnswer.
  it('never names anyone from a people question — an unattended run has nobody to ask', () => {
    seedDue({
      questions: [{
        id: 'q1', name: '', prompt: "Who's coming?", kind: 'people',
        options: [], defaultValue: '', fromDates: 'none',
      }],
      items: [makeItem({ id: 'i1', title: 'Pack for the trip' })],
    });
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask.mock.calls[0][0].personIds).toBeUndefined();
  });

  it('drops an item conditioned off by the default answer', () => {
    seedDue({
      questions: [{
        id: 'q1',
        name: 'trip',
        prompt: 'What kind?',
        kind: 'choice',
        options: ['Leisure', 'Work'],
        defaultValue: '',
        fromDates: 'none',
      }],
      items: [
        makeItem({ id: 'i1', title: 'Passport' }),
        makeItem({
          id: 'i2',
          title: 'Laptop',
          conditions: [{ questionId: 'q1', values: ['Work'] }],
        }),
      ],
    });
    useTemplateStore.getState().checkScheduledTemplates();
    const titles = mockAddTask.mock.calls.map(c => c[0].title);
    expect(titles).toContain('Passport');
    expect(titles).not.toContain('Laptop');
  });

  // The period is still consumed — otherwise this is re-diagnosed as due on
  // every launch for the rest of the week.
  it('records the period even when the run creates nothing', () => {
    seedDue({ items: [makeItem({ id: 'i1', title: 'Optional thing', optional: true })] });
    useTemplateStore.getState().checkScheduledTemplates();
    expect(mockAddTask).not.toHaveBeenCalled();
    expect(useTemplateStore.getState().templates[0].scheduleLastFiredKey).toBe('2026-08-23');
  });
});
