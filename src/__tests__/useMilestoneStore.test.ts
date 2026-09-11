import { useMilestoneStore } from '../store/useMilestoneStore';
import {
  dbGetAllMilestones,
  dbInsertMilestone,
  dbUpdateMilestone,
  dbDeleteMilestone,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllMilestones: jest.fn(() => []),
  dbInsertMilestone: jest.fn(),
  dbUpdateMilestone: jest.fn(),
  dbDeleteMilestone: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useMilestoneStore.setState({ milestones: [], initialized: false });
});

const state = () => useMilestoneStore.getState();

describe('addMilestone', () => {
  it('writes the milestone and holds it', () => {
    const date = new Date('2026-03-01T12:00:00.000Z');
    const milestone = state().addMilestone('Started sertraline', date);
    expect(milestone).not.toBeNull();
    expect(state().milestones).toHaveLength(1);
    expect(dbInsertMilestone).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Started sertraline', date: date.toISOString() })
    );
  });

  it('trims, and refuses a blank rather than writing an empty row', () => {
    const date = new Date('2026-03-01T12:00:00.000Z');
    expect(state().addMilestone('  New job  ', date)!.label).toBe('New job');
    expect(state().addMilestone('   ', date)).toBeNull();
    expect(state().milestones).toHaveLength(1);
  });

  it('keeps the list in date order regardless of insertion order', () => {
    state().addMilestone('Later', new Date('2026-03-10T12:00:00.000Z'));
    state().addMilestone('Earlier', new Date('2026-01-05T12:00:00.000Z'));
    expect(state().milestones.map(m => m.label)).toEqual(['Earlier', 'Later']);
  });
});

describe('updateMilestone', () => {
  it('patches and writes back', () => {
    const milestone = state().addMilestone('before', new Date('2026-03-01T12:00:00.000Z'))!;
    const newDate = new Date('2026-04-01T12:00:00.000Z');
    state().updateMilestone(milestone.id, { label: 'after', date: newDate.toISOString() });
    expect(state().milestones[0].label).toBe('after');
    expect(state().milestones[0].date).toBe(newDate.toISOString());
    expect(dbUpdateMilestone).toHaveBeenCalled();
  });

  it('trims a patched label too', () => {
    const milestone = state().addMilestone('before', new Date('2026-03-01T12:00:00.000Z'))!;
    state().updateMilestone(milestone.id, { label: '  after  ' });
    expect(state().milestones[0].label).toBe('after');
  });

  it('is a no-op for a milestone that is not there', () => {
    state().updateMilestone('missing', { label: 'x' });
    expect(dbUpdateMilestone).not.toHaveBeenCalled();
  });

  it('re-sorts when a patched date moves it', () => {
    const a = state().addMilestone('a', new Date('2026-01-01T12:00:00.000Z'))!;
    state().addMilestone('b', new Date('2026-02-01T12:00:00.000Z'));
    state().updateMilestone(a.id, { date: new Date('2026-03-01T12:00:00.000Z').toISOString() });
    expect(state().milestones.map(m => m.label)).toEqual(['b', 'a']);
  });
});

describe('removeMilestone', () => {
  it('drops the row and nothing else', () => {
    const a = state().addMilestone('a', new Date('2026-01-01T12:00:00.000Z'))!;
    state().addMilestone('b', new Date('2026-02-01T12:00:00.000Z'));
    state().removeMilestone(a.id);
    expect(state().milestones.map(m => m.label)).toEqual(['b']);
    expect(dbDeleteMilestone).toHaveBeenCalledWith(a.id);
  });
});

describe('initialize', () => {
  it('loads what the table holds', () => {
    (dbGetAllMilestones as jest.Mock).mockReturnValueOnce([
      { id: 'a', label: 'Started sertraline', date: '2026-03-01T12:00:00.000Z', createdAt: 'x' },
    ]);
    state().initialize();
    expect(state().milestones).toHaveLength(1);
    expect(state().initialized).toBe(true);
  });
});
