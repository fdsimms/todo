import { duplicateRows } from '../utils/taskDuplicate';
import type { Task } from '../types';

const task = (over: Partial<Task>): Task => ({
  id: 'orig', title: 'Pack', completed: true, completedAt: '2026-01-01T00:00:00.000Z', streakCount: 4, pinned: true,
  tags: ['trip'], seriesId: 's', calendarEventId: 'ev', parentId: null, chainIndex: 2, deliverableValue: 'yes',
  ...over,
}) as Task;

describe('duplicateRows', () => {
  it('keeps the settings and starts the progress over, subtasks included', () => {
    let n = 0;
    const { copy, subtaskCopies } = duplicateRows(task({}), [task({ id: 'sub', title: 'Socks', parentId: 'orig' })], {
      now: '2026-02-01T00:00:00.000Z', sortOrder: 9, newId: () => `id${++n}`,
    });
    expect(copy).toMatchObject({
      id: 'id1', title: 'Pack', tags: ['trip'], sortOrder: 9, completed: false, completedAt: null, streakCount: 0,
      pinned: false, seriesId: null, calendarEventId: null, chainIndex: 0, deliverableValue: null, createdAt: '2026-02-01T00:00:00.000Z',
    });
    expect(subtaskCopies).toEqual([expect.objectContaining({ id: 'id2', title: 'Socks', parentId: 'id1', completed: false })]);
  });
});
