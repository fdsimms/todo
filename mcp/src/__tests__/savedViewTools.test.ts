/**
 * The saved view tools against a real replica: the matcher and the parser are
 * the app's own (`savedViews.ts`, tested where it lives), so what is checked
 * here is the composition. A view's count is the count the app would show, a
 * create refuses what the parser would silently drop, and a view is found by
 * the name the person uses.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { createSavedView, deleteSavedView, getSavedView, listSavedViews, updateSavedView } from '../savedViewTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the saved view tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useCategoryStore } = require('../../../src/store/useCategoryStore');
    useCategoryStore.getState().addCategory('Home');
    useCategoryStore.getState().addCategory('Work');
    replica.refresh();
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM saved_views');
    mockRaw.runSync('DELETE FROM tasks');
    replica.refresh();
  });

  it('lists nothing yet, and says what a view is', () => {
    const list = listSavedViews(replica);
    expect(list.views).toEqual([]);
    expect(list.note).toMatch(/every clause/);
  });

  it('creates a view and counts the open top-level tasks it holds, the way the app does', () => {
    replica.createTask({ title: 'Fix the tap', category: 'Home' });
    replica.createTask({ title: 'Paint the fence', category: 'Home' });
    const done = replica.createTask({ title: 'Mow the lawn', category: 'Home' });
    replica.completeTask(done.id, {});
    replica.createTask({ title: 'Send the invoice', category: 'Work' });

    const { view } = createSavedView(replica, { name: 'Around the house', clauses: [{ kind: 'category', values: ['Home'] }] });
    expect(view).toMatchObject({ name: 'Around the house', count: 2, clauses: [{ kind: 'category', values: ['Home'] }] });
    expect(view.selects).toMatch(/Home/);
    expect(listSavedViews(replica).views.map(v => v.name)).toEqual(['Around the house']);
  });

  it('refuses a name already taken, an icon a view cannot wear, and a blank name', () => {
    createSavedView(replica, { name: 'Errands' });
    expect(() => createSavedView(replica, { name: ' errands ' })).toThrow(/already a saved view called "Errands"/);
    expect(() => createSavedView(replica, { name: 'Odd', icon: 'not-an-icon' })).toThrow(/not an icon a view can wear/);
    expect(() => createSavedView(replica, { name: '  ' })).toThrow(/needs a name/);
  });

  it('refuses the clauses the parser would drop or merge, naming each problem', () => {
    expect(() => createSavedView(replica, { name: 'A', clauses: [{ kind: 'colour', values: ['red'] }] }))
      .toThrow(/"colour" is not a clause kind/);
    expect(() => createSavedView(replica, { name: 'B', clauses: [{ kind: 'maxMinutes', minutes: -5 }] }))
      .toThrow(/maxMinutes clause is not in the shape the app stores/);
    expect(() => createSavedView(replica, { name: 'C', clauses: [{ kind: 'overdue', overdue: true }, { kind: 'overdue', overdue: false }] }))
      .toThrow(/Two overdue clauses/);
    expect(() => createSavedView(replica, { name: 'D', clauses: [{ kind: 'category', values: ['Garden'] }] }))
      .toThrow(/No category called "Garden"/);
    expect(() => createSavedView(replica, { name: 'E', clauses: [{ kind: 'project', values: ['p-missing'] }] }))
      .toThrow(/No project with id p-missing/);
    expect(listSavedViews(replica).views).toEqual([]);
  });

  it('finds a view by id or by name, case aside, and caps the tasks it returns', () => {
    for (let i = 0; i < 3; i += 1) replica.createTask({ title: `Chore ${i}`, category: 'Home' });
    const { view } = createSavedView(replica, { name: 'Around the house', clauses: [{ kind: 'category', values: ['Home'] }] });

    const byName = getSavedView(replica, 'around THE house');
    expect(byName.view.id).toBe(view.id);
    expect(byName.tasks).toHaveLength(3);
    expect(byName.truncated).toBeUndefined();

    const capped = getSavedView(replica, view.id, 2);
    expect(capped.tasks).toHaveLength(2);
    expect(capped.truncated).toEqual({ shown: 2, of: 3 });

    expect(() => getSavedView(replica, 'Garden')).toThrow(/No saved view called "Garden"\. The views are "Around the house"\./);
  });

  it('deletes a view by name and hands back what it removed', () => {
    const { view } = createSavedView(replica, { name: 'Errands' });
    expect(deleteSavedView(replica, 'errands').removed).toEqual(view);
    expect(listSavedViews(replica).views).toEqual([]);
    expect(() => deleteSavedView(replica, 'Errands')).toThrow(/There are none yet/);
  });

  it('edits a view by the rules a new one is checked by, and moves it in the list', () => {
    createSavedView(replica, { name: 'Errands' });
    const { view } = createSavedView(replica, { name: 'Around the house', clauses: [{ kind: 'category', values: ['Home'] }] });
    const edited = updateSavedView(replica, view.id, { name: 'House', clauses: [{ kind: 'overdue', overdue: true }], position: 0 });
    expect(edited.view.name).toBe('House');
    expect(listSavedViews(replica).views.map(v => v.name)[0]).toBe('House');
    expect(() => updateSavedView(replica, 'House', { name: 'errands' })).toThrow(/already a saved view called "Errands"/);
    expect(() => updateSavedView(replica, 'House', { clauses: [{ kind: 'colour', values: ['red'] }] })).toThrow();
  });
});
