import {
  MAX_TASK_ATTACHMENTS,
  attachmentBadge,
  isTaskFileName,
  taskFileNamesInUse,
  taskFileProblem,
  unreferencedTaskFiles,
} from '../utils/taskFiles';

jest.mock('../utils/recipePhoto', () => ({}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => false }));

describe('task files', () => {
  it('knows a task file by its prefix', () => {
    expect(isTaskFileName('task-abc.pdf')).toBe(true);
    expect(isTaskFileName('abc.jpg')).toBe(false);
  });

  it('collects every name a task holds, completed rows included', () => {
    const names = taskFileNamesInUse([
      { attachments: [{ name: 'task-a.jpg', kind: 'photo', title: 'Photo' }] },
      { attachments: undefined },
      { attachments: [{ name: 'task-b.pdf', kind: 'file', title: 'Form.pdf' }, { name: 'task-a.jpg', kind: 'photo', title: 'Photo' }] },
    ]);
    expect([...names].sort()).toEqual(['task-a.jpg', 'task-b.pdf']);
  });

  it('sweeps only what nothing names', () => {
    expect(unreferencedTaskFiles(['task-a.jpg', 'task-b.pdf'], new Set(['task-a.jpg']))).toEqual(['task-b.pdf']);
  });

  it('refuses a file past the sync ceiling, and one too many', () => {
    expect(taskFileProblem(8 * 1024 * 1024, 0)).toMatch(/over 7 MB/);
    expect(taskFileProblem(1024, MAX_TASK_ATTACHMENTS)).toMatch(/can hold 10/);
    expect(taskFileProblem(null, 0)).toBeNull();
  });

  it('badges a file by its extension', () => {
    expect(attachmentBadge('Insurance card.pdf')).toBe('PDF');
    expect(attachmentBadge('notes')).toBe('FILE');
  });
});
