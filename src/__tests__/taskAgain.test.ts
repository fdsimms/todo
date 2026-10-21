import { againDraft, againFields, describeAgainFields } from '../utils/taskAgain';
import type { Task } from '../types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Water plants', notes: 'Balcony first', completed: true, completedAt: '2026-10-01T09:00:00.000Z',
  dueDate: '2026-10-01T12:00:00.000Z', recurrenceType: 'none', category: 'Home', tags: ['balcony'], priority: 2,
  effort: 1, estimatedMinutes: 10, linkUrl: null, timeSegments: ['morning'], personIds: ['p1'],
  phoneNumber: null, emailAddress: null, location: null, projectId: 'proj',
  ...over,
}) as Task;

describe('againFields', () => {
  it('brings what the task was about and where it was filed', () => {
    expect(againFields(task())).toEqual({
      category: 'Home', tags: ['balcony'], priority: 2, effort: 1, estimatedMinutes: 10, linkUrl: null,
    });
  });
});

describe('describeAgainFields', () => {
  it('reads as one line, and as nothing when there is nothing to bring', () => {
    expect(describeAgainFields(againFields(task({ linkUrl: 'https://x.test' })))).toBe('Home · 10m · #balcony · Link');
    expect(describeAgainFields(againFields(task({ category: null, tags: [], estimatedMinutes: null })))).toBeNull();
  });
});

describe('againDraft', () => {
  it('drops the date and keeps a project only while it is open', () => {
    const draft = againDraft(task(), ['Fill can'], true);
    expect(draft).toMatchObject({ title: 'Water plants', notes: 'Balcony first', projectId: 'proj', subtaskTitles: ['Fill can'] });
    expect(draft).not.toHaveProperty('dueDate');
    expect(againDraft(task(), [], false).projectId).toBeNull();
  });
});
