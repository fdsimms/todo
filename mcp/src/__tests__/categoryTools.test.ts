/**
 * The category tools against a real database: a rename reaching every place
 * the app's rename reaches, the settings, and the order.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { createCategory, reorderCategories, updateCategory } from '../categoryTools';
import { listCategories } from '../tools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = () => require('../../../src/store/useCategoryStore').useCategoryStore as typeof import('../../../src/store/useCategoryStore').useCategoryStore;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const settings = () => require('../../../src/store/useSettingsStore').useSettingsStore as typeof import('../../../src/store/useSettingsStore').useSettingsStore;

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  mockRaw.runSync('DELETE FROM tasks');
  mockRaw.runSync('DELETE FROM task_groups');
  mockRaw.runSync('DELETE FROM categories');
  store().getState().initialize();
  ['Home', 'Work', 'Errands'].forEach(n => store().getState().addCategory(n));
  replica.refresh();
});

describe('create_category', () => {
  it('adds an empty category with its settings, and list_categories shows it', () => {
    const result = createCategory(replica, { name: ' Leave By ', emoji: '🚶', excludeFromSuggestions: true });
    expect(result).toMatchObject({ name: 'Leave By', emoji: '🚶', excludeFromSuggestions: true });
    expect(listCategories(replica).find(c => c.name === 'Leave By')).toMatchObject({ openTasks: 0, emoji: '🚶' });
  });

  it('refuses a name a category already has, in any capitalization, and an empty one', () => {
    expect(() => createCategory(replica, { name: 'home' })).toThrow(/already a category called "Home"/);
    expect(() => createCategory(replica, { name: '  ' })).toThrow(/needs a name/);
  });
});

describe('update_category', () => {
  it('renames a category on its tasks, stacks, rules and defaults', () => {
    const task = replica.createTask({ title: 'Mow', category: 'Home' });
    replica.createStack('Weekend', 'Home');
    settings().getState().setTitleRules([{ id: 'r1', keywords: ['mow'], match: 'contains', category: 'Home', projectId: null, tags: [], priority: 0, effort: 0, linkUrl: null, stripKeyword: false, enabled: true }]);
    settings().getState().setNewTaskDefaults({ category: 'Home' });
    const result = updateCategory(replica, { name: 'home', newName: 'House' });
    expect(result).toMatchObject({ name: 'House', renamedFrom: 'home' });
    expect(replica.taskById(task.id)!.category).toBe('House');
    expect(replica.stacks()[0].category).toBe('House');
    expect(settings().getState().titleRules[0].category).toBe('House');
    expect(settings().getState().newTaskDefaults.category).toBe('House');
    expect(replica.categories().map(c => c.name)).toContain('House');
  });

  it('refuses a name another category already has, and points at the merge', () => {
    expect(() => updateCategory(replica, { name: 'Home', newName: 'work' })).toThrow(/delete_category with moveTo/);
  });

  it('sets the schedule, emoji and vacation setting, and list_categories reads them back', () => {
    updateCategory(replica, { name: 'Work', emoji: '💼', hideOnVacation: true, schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } });
    const row = listCategories(replica).find(c => c.name === 'Work')!;
    expect(row).toMatchObject({ emoji: '💼', hideOnVacation: true, schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' } });
    updateCategory(replica, { name: 'Work', schedule: null });
    expect(listCategories(replica).find(c => c.name === 'Work')!.schedule).toBeUndefined();
    expect(() => updateCategory(replica, { name: 'Work', schedule: { days: [], start: '9', end: '17:00' } })).toThrow(/days are 0/);
  });
});

describe('reorder_categories', () => {
  it('puts the named first and keeps the rest in order', () => {
    expect(reorderCategories(replica, ['errands']).order).toEqual(['Errands', 'Home', 'Work']);
  });
});
