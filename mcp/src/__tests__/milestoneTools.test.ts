/**
 * The milestone tools against a real replica, since every write goes through
 * `useMilestoneStore`'s own actions and a stub would test the stub. The store's
 * own rules (a blank label refused) are tested where it lives; this holds what
 * the tools say and the day each date lands on.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { addMilestone, deleteMilestone, listMilestones, updateMilestone } from '../milestoneTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the milestone tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM milestones');
    replica.refresh();
  });

  it('lists nothing with a note saying an empty list is not evidence', () => {
    const list = listMilestones(replica);
    expect(list.milestones).toEqual([]);
    expect(list.note).toMatch(/not evidence/);
    expect(list.note).toMatch(/do not pair them/);
  });

  it('adds a milestone on the day named, anchored at noon, and reports it by day', () => {
    const { milestone, note } = addMilestone(replica, { label: 'Started sertraline', date: '2026-09-01' });
    expect(milestone).toMatchObject({ label: 'Started sertraline', date: '2026-09-01' });
    expect(note).toMatch(/two milestones/);
    // Noon, the anchor the sheet uses, so a zone or DST boundary cannot move the day.
    const stored = replica.milestones().find(m => m.id === milestone.id)!;
    expect(new Date(stored.date).getHours()).toBe(12);
    expect(listMilestones(replica).milestones).toEqual([milestone]);
  });

  it('defaults the date to the logical today', () => {
    const { milestone } = addMilestone(replica, { label: 'New job' });
    expect(milestone.date).toBe(replica.todayKey());
  });

  it('refuses a blank label and a date it cannot read', () => {
    expect(() => addMilestone(replica, { label: '   ' })).toThrow(/needs a label/);
    expect(() => addMilestone(replica, { label: 'Moved house', date: 'next spring' })).toThrow(/not a date I can read/);
    expect(listMilestones(replica).milestones).toEqual([]);
  });

  it('updates the label, the date, or both, and refuses an empty patch or an unknown id', () => {
    const { milestone } = addMilestone(replica, { label: 'Started sertraline', date: '2026-09-01' });
    expect(updateMilestone(replica, milestone.id, { label: 'Started sertraline 50mg' }).milestone)
      .toMatchObject({ id: milestone.id, label: 'Started sertraline 50mg', date: '2026-09-01' });
    expect(updateMilestone(replica, milestone.id, { date: '2026-09-03' }).milestone.date).toBe('2026-09-03');
    expect(() => updateMilestone(replica, milestone.id, {})).toThrow(/Nothing to change/);
    expect(() => updateMilestone(replica, milestone.id, { label: ' ' })).toThrow(/needs a label/);
    expect(() => updateMilestone(replica, 'nope', { label: 'x' })).toThrow(/No milestone with id nope/);
  });

  it('deletes a milestone and hands back what it removed', () => {
    const { milestone } = addMilestone(replica, { label: 'Quit coffee', date: '2026-08-10' });
    expect(deleteMilestone(replica, milestone.id).removed).toEqual(milestone);
    expect(listMilestones(replica).milestones).toEqual([]);
    expect(() => deleteMilestone(replica, milestone.id)).toThrow(/No milestone with id/);
  });
});
