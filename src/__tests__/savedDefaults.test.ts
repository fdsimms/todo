import { savedDefaultRows } from '../utils/savedDefaults';
import { NO_TASK_FIELD_DEFAULTS } from '../utils/taskFieldDefaults';
import type { Project, TaskFieldDefaults } from '../types';

const d = (over: Partial<TaskFieldDefaults>): TaskFieldDefaults => ({ ...NO_TASK_FIELD_DEFAULTS, ...over });
const project = (id: string, title: string, taskDefaults: TaskFieldDefaults | null) =>
  ({ id, title, taskDefaults } as unknown as Project);
const labels: Record<string, string> = { groceryUseUp: 'Use up groceries', weather: 'Weather rules' };
const label = (kind: string) => labels[kind] ?? null;

describe('savedDefaultRows', () => {
  it('lists only projects that carry an answer, sorted by name', () => {
    const rows = savedDefaultRows(
      [project('b', 'Wish list', d({ priority: 0, difficulty: 'easy' })), project('a', 'Gift ideas', d({ effort: 0 })), project('c', 'Empty', null), project('e', 'Blank', d({}))],
      {}, label,
    );
    expect(rows.projects.map(r => r.label)).toEqual(['Gift ideas', 'Wish list']);
    expect(rows.projects[1]).toMatchObject({ key: 'project:b', home: 'project', id: 'b', summary: 'No priority, Easy' });
    expect(rows.automatic).toEqual([]);
  });

  it('lists automatic kinds by their own wording and drops a kind it cannot name', () => {
    const rows = savedDefaultRows([], {
      weather: d({ priority: 0 }),
      groceryUseUp: d({ difficulty: 'hard' }),
      fromANewerBuild: d({ priority: 1 }),
    }, label);
    expect(rows.automatic.map(r => r.label)).toEqual(['Use up groceries', 'Weather rules']);
    expect(rows.automatic[0]).toMatchObject({ key: 'automatic:groceryUseUp', home: 'automatic', id: 'groceryUseUp', summary: 'Hard' });
  });

  it('treats a false toggle as an answer', () => {
    const rows = savedDefaultRows([project('a', 'A', d({ excludeFromSuggestions: false }))], {}, label);
    expect(rows.projects[0].summary).toBe('Allow in suggestions');
  });
});
