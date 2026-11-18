import type { Experiment } from '../types';
import {
  experimentLinkState,
  experimentStartedMessage,
  linkedExperimentTaskCounts,
  linkedExperimentTasksNote,
  startExperimentLabel,
} from '../utils/experimentLink';

const noon = (key: string) => new Date(`${key}T12:00:00`).toISOString();
const exp = (over: Partial<Experiment> = {}): Experiment => ({
  id: 'e1', label: 'CoQ10', startDate: null, endDate: null, days: 28, startedAt: null, symptoms: [], note: null, createdAt: '2026-10-01T09:00:00', ...over,
});
const task = (over: Partial<{ experimentId: string | null; completed: boolean; archived: boolean }> = {}) => ({
  experimentId: 'e1', completed: false, archived: false, ...over,
});

describe('experimentLinkState', () => {
  it('offers to start a planned experiment', () => {
    const e = exp();
    expect(experimentLinkState(task(), [e], '2026-11-10')).toEqual({ kind: 'start', experiment: e });
  });
  it('offers to view one that is running, upcoming or finished', () => {
    for (const e of [
      exp({ startDate: noon('2026-11-01'), endDate: noon('2026-11-28') }),
      exp({ startDate: noon('2026-11-20'), endDate: noon('2026-11-28') }),
      exp({ startDate: noon('2026-10-01'), endDate: noon('2026-10-10') }),
    ]) expect(experimentLinkState(task(), [e], '2026-11-10').kind).toBe('view');
  });
  it('says missing when the experiment is gone, and nothing for no link or a finished task', () => {
    expect(experimentLinkState(task(), [], '2026-11-10')).toEqual({ kind: 'missing' });
    expect(experimentLinkState(task({ experimentId: null }), [exp()], '2026-11-10')).toEqual({ kind: 'none' });
    expect(experimentLinkState(task({ completed: true }), [exp()], '2026-11-10')).toEqual({ kind: 'none' });
    expect(experimentLinkState(task({ archived: true }), [exp()], '2026-11-10')).toEqual({ kind: 'none' });
  });
});

describe('words', () => {
  it('labels the button and confirms with the end date', () => {
    expect(startExperimentLabel(exp())).toBe('Start CoQ10');
    expect(experimentStartedMessage(exp({ startDate: noon('2026-11-10'), endDate: noon('2026-12-07') }))).toBe('CoQ10 started, ends Dec 7.');
    expect(experimentStartedMessage(exp({ startDate: noon('2026-11-10') }))).toBe('CoQ10 started, runs until you stop it.');
  });
  it('counts open linked tasks and words the delete note', () => {
    const tasks = [task(), task(), task({ completed: true }), task({ experimentId: 'other' })].map(t => ({ ...t, parentId: null }));
    expect(linkedExperimentTaskCounts(tasks, ['e1']).get('e1')).toBe(2);
    expect(linkedExperimentTasksNote(0)).toBe('');
    expect(linkedExperimentTasksNote(1)).toContain('1 task starts');
    expect(linkedExperimentTasksNote(2)).toContain('2 tasks start');
  });
});
