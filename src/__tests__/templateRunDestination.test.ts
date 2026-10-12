import type { Task } from '../types';
import { templateRunDestination, templateRunDestinationLabel } from '../utils/templateRunDestination';

// The view of a task is visibilityUtils' business and tested there; here each
// fake task just says which view it is in.
jest.mock('../utils/visibilityUtils', () => ({
  isInboxTask: (t: any) => t.view === 'inbox',
  isTaskVisible: (t: any) => t.view === 'today',
  isUnscheduledTask: (t: any) => t.view === 'unscheduled',
}));

const task = (view: string, extra: Partial<Task> = {}): Task =>
  ({ id: view, view, parentId: null, projectId: null, ...extra }) as unknown as Task;

describe('templateRunDestination', () => {
  it('is null when nothing was created', () => {
    expect(templateRunDestination([])).toBeNull();
  });

  it('goes to the project when the run made tasks in one', () => {
    expect(templateRunDestination([task('later', { projectId: 'p1' }), task('today', { projectId: 'p1' })]))
      .toEqual({ kind: 'project', projectId: 'p1' });
  });

  it('prefers Today, then Later, then Unscheduled, then Inbox', () => {
    expect(templateRunDestination([task('inbox'), task('later'), task('today')])).toEqual({ kind: 'view', mode: 'today' });
    expect(templateRunDestination([task('inbox'), task('unscheduled'), task('later')])).toEqual({ kind: 'view', mode: 'later' });
    expect(templateRunDestination([task('inbox'), task('unscheduled')])).toEqual({ kind: 'view', mode: 'unscheduled' });
    expect(templateRunDestination([task('inbox')])).toEqual({ kind: 'view', mode: 'inbox' });
  });

  it('ignores subtasks when a parent exists', () => {
    expect(templateRunDestination([task('later'), task('today', { parentId: 'x' })])).toEqual({ kind: 'view', mode: 'later' });
  });
});

describe('templateRunDestinationLabel', () => {
  it('names the project or the view', () => {
    expect(templateRunDestinationLabel({ kind: 'project', projectId: 'p' })).toBe('View project');
    expect(templateRunDestinationLabel({ kind: 'view', mode: 'later' })).toBe('Go to Later');
  });
});
