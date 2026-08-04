import { useTemplateStore } from '../store/useTemplateStore';
import {
  dbInsertTemplate,
  dbUpdateTemplate,
  dbDeleteTemplate,
  dbGetAllTemplates,
} from '../db/database';
import type { TaskTemplate, TemplateItem, TaskDraft } from '../types';

jest.mock('../db/database', () => ({
  dbGetAllTemplates: jest.fn().mockReturnValue([]),
  dbInsertTemplate: jest.fn(),
  dbUpdateTemplate: jest.fn(),
  dbDeleteTemplate: jest.fn(),
}));

const mockAddTask = jest.fn();
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: {
    getState: () => ({ addTask: mockAddTask }),
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
  timeSegments: [],
  tags: [],
  category: null,
  priority: 0,
  effort: 0,
  ...overrides,
});

const makeTemplate = (overrides: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id: 'tpl-1',
  name: 'Pre-vacation',
  items: [],
  createdAt: '2025-01-01T00:00:00.000Z',
  sortOrder: 1,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetAllTemplates as jest.Mock).mockReturnValue([]);
  mockAddTask.mockImplementation((draft: Partial<TaskDraft>) => ({ id: `task-${draft.title}`, ...draft }));
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
});
