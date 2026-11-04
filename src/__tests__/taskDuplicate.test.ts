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

  it('starts a target at zero, with no tap log, tally or penalty stamp of the original\'s', () => {
    const { copy } = duplicateRows(task({
      id: 'water', title: 'Water', targetCount: 8, progressCount: 5, quotaLoggedDayKey: '2026-02-01',
      quotaTapTimes: ['2026-02-01T09:00:00.000Z'], followUpTaskTally: 3, previousFollowUpTaskTally: 2,
      penaltyFiredAt: '2026-02-01T23:00:00.000Z', penaltyCreditedAt: '2026-02-01T23:30:00.000Z',
      followUpOn: '2026-02-05', timerElapsedSeconds: 300,
    }), [], { now: '2026-02-02T00:00:00.000Z', sortOrder: 1, newId: () => 'copy' });
    expect(copy).toMatchObject({
      targetCount: 8, progressCount: 0, quotaLoggedDayKey: null, quotaTapTimes: [], followUpTaskTally: 0,
      previousFollowUpTaskTally: 0, penaltyFiredAt: null, penaltyCreditedAt: null, followUpOn: null, timerElapsedSeconds: 0,
    });
  });

  it('is not the generated task it was copied from', () => {
    const { copy } = duplicateRows(task({
      id: 'review', generatedKind: 'projectReview', generatedSourceId: 'proj-1', generatedReadyAt: '2026-02-01T00:00:00.000Z',
    } as Partial<Task>), [], { now: '2026-02-02T00:00:00.000Z', sortOrder: 1, newId: () => 'copy' });
    expect(copy).toMatchObject({ generatedKind: null, generatedSourceId: null, generatedReadyAt: null });
  });
});
