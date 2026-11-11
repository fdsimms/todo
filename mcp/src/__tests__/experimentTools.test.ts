/**
 * The experiment tools against a real replica, since every write goes through
 * `useExperimentStore`'s own actions and the read is the app's own
 * `experimentResult`. The read's arithmetic is tested in
 * src/__tests__/experiments.test.ts; this holds what the tools say and write.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { addExperiment, deleteExperiment, listExperiments, updateExperiment } from '../experimentTools';
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
    expect(new Date(stored.startDate).getHours()).toBe(12);
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

  it('deletes one and hands back what it removed', () => {
    const { experiment } = addExperiment(replica, { label: 'No dairy' });
    expect(deleteExperiment(replica, experiment.id).removed).toEqual({ id: experiment.id, label: 'No dairy' });
    expect(listExperiments(replica).experiments).toEqual([]);
    expect(() => deleteExperiment(replica, experiment.id)).toThrow(/No experiment with id/);
  });
});
