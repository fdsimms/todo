/**
 * The experiment tools against a real replica, since every write goes through
 * `useExperimentStore`'s own actions and the read is the app's own
 * `experimentResult`. The read's arithmetic is tested in
 * src/__tests__/experiments.test.ts; this holds what the tools say and write.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { addExperiment, deleteExperiment, listExperiments, planExperiment, startExperiment, stopExperiment, updateExperiment } from '../experimentTools';
import { createTask, getTask, updateTask } from '../tools';
import { addMilestone } from '../milestoneTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the experiment tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM experiments');
    mockRaw.runSync('DELETE FROM milestones');
    mockRaw.runSync('DELETE FROM mood_logs');
    mockRaw.runSync('DELETE FROM tasks');
    replica.refresh();
  });

  it('lists nothing, with the rules saying an empty list is not evidence', () => {
    const list = listExperiments(replica);
    expect(list.experiments).toEqual([]);
    expect(list.rules).toMatch(/not evidence/);
    expect(list.rules).toMatch(/does not show the experiment caused it/);
  });

  it('starts one on the days named, anchored at noon, with a baseline of the same length', () => {
    const { experiment } = addExperiment(replica, {
      label: 'No caffeine after noon',
      startDate: '2026-09-01',
      endDate: '2026-09-14',
      symptoms: ['Headache', 'headache'],
      expected: 'Fewer headaches',
    });
    expect(experiment).toMatchObject({
      label: 'No caffeine after noon',
      startDate: '2026-09-01',
      endDate: '2026-09-14',
      comparedWith: { from: '2026-08-18', to: '2026-08-31' },
      expected: 'Fewer headaches',
    });
    const stored = replica.experiments().find(e => e.id === experiment.id)!;
    expect(new Date(stored.startDate!).getHours()).toBe(12);
    expect(stored.symptoms).toEqual(['Headache']);
  });

  it('defaults to starting today and lasting 28 days', () => {
    const { experiment } = addExperiment(replica, { label: 'Earlier bedtime' });
    expect(experiment.startDate).toBe(replica.todayKey());
    expect(experiment.status).toBe('running');
    expect(experiment.day).toBe('1 of 28');
  });

  it('refuses a blank name, an end before the start, and a date it cannot read', () => {
    expect(() => addExperiment(replica, { label: '  ' })).toThrow(/name/);
    expect(() => addExperiment(replica, { label: 'x', startDate: '2026-09-10', endDate: '2026-09-01' })).toThrow(/end before/);
    expect(() => addExperiment(replica, { label: 'x', startDate: 'soon' })).toThrow(/not a date I can read/);
    expect(listExperiments(replica).experiments).toEqual([]);
  });

  it('names a milestone inside its stretch', () => {
    addMilestone(replica, { label: 'Started magnesium', date: '2026-09-05' });
    const { experiment } = addExperiment(replica, { label: 'No dairy', startDate: '2026-09-01', endDate: '2026-09-14' });
    expect(experiment.alsoChanged).toEqual([{ kind: 'milestone', label: 'Started magnesium', date: '2026-09-05' }]);
  });

  it('changes only what it is given, and refuses an empty patch or an unknown id', () => {
    const { experiment } = addExperiment(replica, { label: 'No dairy', startDate: '2026-09-01', endDate: '2026-09-14', expected: 'Less bloating' });
    const changed = updateExperiment(replica, experiment.id, { endDate: '2026-09-20', symptoms: ['Bloating'], expected: null }).experiment;
    expect(changed).toMatchObject({ label: 'No dairy', startDate: '2026-09-01', endDate: '2026-09-20' });
    expect(changed.expected).toBeUndefined();
    expect(replica.experiments()[0].symptoms).toEqual(['Bloating']);
    expect(() => updateExperiment(replica, experiment.id, {})).toThrow(/Nothing to change/);
    expect(() => updateExperiment(replica, experiment.id, { endDate: '2026-08-01' })).toThrow(/end before/);
    expect(() => updateExperiment(replica, 'nope', { label: 'x' })).toThrow(/No experiment with id nope/);
  });

  it('sets, shows and forgets the time it started, and refuses one off its first day', () => {
    const { experiment } = addExperiment(replica, { label: 'Magnesium', startDate: '2026-09-01', endDate: '2026-09-14' });
    expect(experiment.startedAt).toBeUndefined();
    const set = updateExperiment(replica, experiment.id, { startedAt: '2026-09-01T18:30' }).experiment;
    expect(set.startedAt).toBe('2026-09-01T18:30');
    expect(replica.experiments()[0].startedAt).toBe(new Date('2026-09-01T18:30').toISOString());
    // An edit that leaves the first day alone keeps it.
    expect(updateExperiment(replica, experiment.id, { endDate: '2026-09-20' }).experiment.startedAt).toBe('2026-09-01T18:30');
    expect(() => updateExperiment(replica, experiment.id, { startedAt: '2026-09-02T09:00' })).toThrow(/first day, 2026-09-01/);
    expect(() => updateExperiment(replica, experiment.id, { startedAt: 'yesterday evening' })).toThrow(/YYYY-MM-DDTHH:MM/);
    // Moving the first day drops it, since it described the old one.
    expect(updateExperiment(replica, experiment.id, { startDate: '2026-09-02' }).experiment.startedAt).toBeUndefined();
    updateExperiment(replica, experiment.id, { startedAt: '2026-09-02T07:15' });
    expect(updateExperiment(replica, experiment.id, { startedAt: null }).experiment.startedAt).toBeUndefined();
  });

  it('refuses a start time for one that has not started', () => {
    const { experiment } = addExperiment(replica, { label: 'Zinc', planned: true });
    expect(() => updateExperiment(replica, experiment.id, { startedAt: '2026-09-01T18:30' })).toThrow(/has not started/);
  });

  it('deletes one and hands back what it removed', () => {
    const { experiment } = addExperiment(replica, { label: 'No dairy' });
    expect(deleteExperiment(replica, experiment.id).removed).toEqual({ id: experiment.id, label: 'No dairy' });
    expect(listExperiments(replica).experiments).toEqual([]);
    expect(() => deleteExperiment(replica, experiment.id)).toThrow(/No experiment with id/);
  });

  describe('planned experiments', () => {
    const planned = (extra: Partial<Parameters<typeof addExperiment>[1]> = {}) =>
      addExperiment(replica, { label: 'CoQ10', planned: true, days: 21, symptoms: ['Fatigue'], expected: 'More energy', ...extra }).experiment;

    it('adds one with no dates, listed apart and compared with nothing', () => {
      const e = planned();
      expect(e).toMatchObject({ status: 'planned', plannedDays: 21, expected: 'More energy', watched: [{ name: 'Fatigue' }] });
      expect(e.startDate).toBeUndefined();
      expect(e.comparedWith).toBeUndefined();
      expect(e.mood).toBeUndefined();
      const list = listExperiments(replica);
      expect(list.experiments).toEqual([]);
      expect(list.planned.map(p => p.id)).toEqual([e.id]);
      expect(replica.experiments()[0]).toMatchObject({ startDate: null, endDate: null, days: 21 });
    });

    it('refuses dates on a planned one, and a startDate on update', () => {
      expect(() => addExperiment(replica, { label: 'x', planned: true, startDate: '2026-09-01' })).toThrow(/no dates yet/);
      const e = planned();
      expect(() => updateExperiment(replica, e.id, { startDate: '2026-09-01' })).toThrow(/start_experiment/);
      expect(updateExperiment(replica, e.id, { days: 14 }).experiment.plannedDays).toBe(14);
    });

    it('starts today with the planned length and a baseline from the real start', () => {
      const e = planned();
      const { experiment } = startExperiment(replica, { id: e.id });
      expect(experiment.startDate).toBe(replica.todayKey());
      expect(experiment.status).toBe('running');
      expect(experiment.day).toBe('1 of 21');
      expect(experiment.comparedWith!.to < experiment.startDate!).toBe(true);
      expect(listExperiments(replica).planned).toEqual([]);
    });

    it('starts on an earlier day, with a new length, or with no end', () => {
      const a = startExperiment(replica, { id: planned().id, startDate: '2026-01-01', days: 10 }).experiment;
      expect(a).toMatchObject({ startDate: '2026-01-01', endDate: '2026-01-10', status: 'finished' });
      const b = startExperiment(replica, { id: planned().id, days: null }).experiment;
      expect(b).toMatchObject({ openEnded: true, status: 'running' });
      expect(b.endDate).toBeUndefined();
    });

    it('refuses a future start, one already started, and an unknown id', () => {
      const e = planned();
      expect(() => startExperiment(replica, { id: e.id, startDate: '2999-01-01' })).toThrow(/future/);
      startExperiment(replica, { id: e.id });
      expect(() => startExperiment(replica, { id: e.id })).toThrow(/already started/);
      expect(() => startExperiment(replica, { id: 'nope' })).toThrow(/No experiment with id/);
    });

    it('stops an open-ended one, fixing its window, and refuses a planned or ended one', () => {
      const open = startExperiment(replica, { id: planned().id, startDate: '2026-01-01', days: null }).experiment;
      expect(open.day).toMatch(/^\d+$/);
      const stopped = stopExperiment(replica, { id: open.id, endDate: '2026-01-10' }).experiment;
      expect(stopped).toMatchObject({ endDate: '2026-01-10', status: 'finished', comparedWith: { from: '2025-12-22', to: '2025-12-31' } });
      expect(() => stopExperiment(replica, { id: open.id })).toThrow(/already ended/);
      expect(() => stopExperiment(replica, { id: planned().id })).toThrow(/not started/);
    });

    it('checks off the linked start tasks when started, unless told not to', () => {
      const a = planned();
      const t = createTask(replica, { title: 'Start CoQ10', category: 'Health', newCategory: true, experimentId: a.id });
      expect(t.experiment).toEqual({ id: a.id, label: 'CoQ10', status: 'planned' });
      expect(listExperiments(replica).planned[0].startTasks).toEqual([{ id: t.task.id, title: 'Start CoQ10' }]);
      const result = startExperiment(replica, { id: a.id });
      expect(result.completedTasks).toEqual([{ id: t.task.id, title: 'Start CoQ10' }]);
      expect(getTask(replica, t.task.id)!.task.completed).toBe(true);

      const b = planned({ label: 'Magnesium' });
      const u = createTask(replica, { title: 'Start Mg', category: 'Health', experimentId: b.id });
      expect(startExperiment(replica, { id: b.id, completeStartTasks: false }).completedTasks).toEqual([]);
      expect(getTask(replica, u.task.id)!.task.completed).toBe(false);
    });

    it('refuses an unknown experimentId, and reads a deleted one as deleted', () => {
      expect(() => createTask(replica, { title: 'x', category: 'Health', newCategory: true, experimentId: 'gone' })).toThrow(/no experiment with id gone/);
      const e = planned();
      const t = createTask(replica, { title: 'Start', category: 'Health', newCategory: true, experimentId: e.id });
      deleteExperiment(replica, e.id);
      expect(getTask(replica, t.task.id)!.experiment).toEqual({ id: e.id, deleted: true });
      expect(updateTask(replica, t.task.id, { experimentId: null }).experiment).toBeUndefined();
    });

    it('plans an experiment and its start task in one step', () => {
      const result = planExperiment(replica, { label: 'Iron', days: 28, task: { category: 'Health', newCategory: true, notes: 'When the pharmacy has it' } });
      expect(result.experiment.status).toBe('planned');
      expect(result.task.task).toMatchObject({ title: 'Start Iron' });
      expect(result.task.experiment).toMatchObject({ id: result.experiment.id, status: 'planned' });
      expect(result.task.task.dueDate).toBeUndefined();
    });
  });
});
