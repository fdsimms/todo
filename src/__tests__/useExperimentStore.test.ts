import { useExperimentStore, type ExperimentDraft } from '../store/useExperimentStore';
import {
  dbInsertExperiment,
  dbUpdateExperiment,
  dbDeleteExperiment,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllExperiments: jest.fn(() => []),
  dbInsertExperiment: jest.fn(),
  dbUpdateExperiment: jest.fn(),
  dbDeleteExperiment: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useExperimentStore.setState({ experiments: [], initialized: false });
});

const state = () => useExperimentStore.getState();

const draft = (over: Partial<ExperimentDraft> = {}): ExperimentDraft => ({
  label: 'No caffeine after noon',
  startDate: new Date('2026-11-01T08:00:00'),
  endDate: new Date('2026-11-28T22:00:00'),
  symptoms: ['Headache'],
  note: null,
  ...over,
});

describe('addExperiment', () => {
  it('writes it with noon-anchored days, cleaned symptoms and a trimmed note', () => {
    const e = state().addExperiment({
      ...draft(),
      label: '  No caffeine after noon ',
      symptoms: ['Headache', ' headache ', '', 'Brain fog'],
      note: '  Fewer headaches  ',
    })!;
    expect(e.label).toBe('No caffeine after noon');
    expect(new Date(e.startDate!).getHours()).toBe(12);
    expect(new Date(e.startDate!).getDate()).toBe(1);
    expect(new Date(e.endDate!).getDate()).toBe(28);
    expect(e.symptoms).toEqual(['Headache', 'Brain fog']);
    expect(e.note).toBe('Fewer headaches');
    expect(dbInsertExperiment).toHaveBeenCalledWith(e);
    expect(state().experiments).toEqual([e]);
  });

  it('refuses a blank name or an end before the start', () => {
    expect(state().addExperiment({ ...draft(), label: '  ' })).toBeNull();
    expect(state().addExperiment({ ...draft(), endDate: new Date('2026-10-31T12:00:00') })).toBeNull();
    expect(dbInsertExperiment).not.toHaveBeenCalled();
  });

  it('stores an emptied note as null', () => {
    expect(state().addExperiment({ ...draft(), note: '   ' })!.note).toBeNull();
  });

  it('keeps the list in start order', () => {
    state().addExperiment({ ...draft(), label: 'Later', startDate: new Date('2026-12-01T12:00:00'), endDate: new Date('2026-12-10T12:00:00') });
    state().addExperiment({ ...draft(), label: 'Earlier' });
    expect(state().experiments.map(e => e.label)).toEqual(['Earlier', 'Later']);
  });
});

describe('updateExperiment', () => {
  it('changes only what it is given', () => {
    const e = state().addExperiment(draft())!;
    const next = state().updateExperiment(e.id, { endDate: new Date('2026-12-05T09:00:00') })!;
    expect(next.label).toBe(e.label);
    expect(next.startDate).toBe(e.startDate);
    expect(new Date(next.endDate!).getDate()).toBe(5);
    expect(dbUpdateExperiment).toHaveBeenCalledWith(next);
  });

  it('refuses a change that would end it before it starts', () => {
    const e = state().addExperiment(draft())!;
    expect(state().updateExperiment(e.id, { startDate: new Date('2026-12-15T12:00:00') })).toBeNull();
    expect(dbUpdateExperiment).not.toHaveBeenCalled();
    expect(state().experiments[0]).toEqual(e);
  });

  it('clears the note when given null', () => {
    const e = state().addExperiment({ ...draft(), note: 'x' })!;
    expect(state().updateExperiment(e.id, { note: null })!.note).toBeNull();
  });

  it('does nothing for an unknown id', () => {
    expect(state().updateExperiment('nope', { label: 'x' })).toBeNull();
  });
});

describe('removeExperiment', () => {
  it('deletes the row', () => {
    const e = state().addExperiment(draft())!;
    state().removeExperiment(e.id);
    expect(dbDeleteExperiment).toHaveBeenCalledWith(e.id);
    expect(state().experiments).toEqual([]);
  });
});

describe('planned experiments', () => {
  const planned = () => state().addExperiment({ ...draft(), startDate: null, endDate: null, days: 14 })!;

  it('is stored with no days and the planned length', () => {
    const e = planned();
    expect(e.startDate).toBeNull();
    expect(e.endDate).toBeNull();
    expect(e.days).toBe(14);
    expect(dbInsertExperiment).toHaveBeenCalledWith(e);
  });

  it('defaults the planned length to 28 days', () => {
    const e = state().addExperiment({ ...draft(), startDate: null, endDate: null })!;
    expect(e.days).toBe(28);
  });

  it('starts on the given day with the last day from the planned length', () => {
    const e = planned();
    const started = state().startExperiment(e.id, { startDate: new Date('2026-11-10T09:00:00') })!;
    expect(new Date(started.startDate!).getDate()).toBe(10);
    expect(new Date(started.endDate!).getDate()).toBe(23);
    expect(started.days).toBe(14);
    expect(dbUpdateExperiment).toHaveBeenCalledWith(started);
  });

  it('takes a different length at start, or none for open-ended', () => {
    const a = state().startExperiment(planned().id, { startDate: new Date('2026-11-10T09:00:00'), days: 7 })!;
    expect(new Date(a.endDate!).getDate()).toBe(16);
    const b = state().startExperiment(planned().id, { startDate: new Date('2026-11-10T09:00:00'), days: null })!;
    expect(b.endDate).toBeNull();
    expect(b.days).toBeNull();
  });

  it('refuses to start one that already started, or an unknown one', () => {
    const e = planned();
    expect(state().startExperiment(e.id, { startDate: new Date('2026-11-10T09:00:00') })).not.toBeNull();
    expect(state().startExperiment(e.id, { startDate: new Date('2026-11-11T09:00:00') })).toBeNull();
    expect(state().startExperiment('nope', { startDate: new Date('2026-11-11T09:00:00') })).toBeNull();
  });

  it('stops a started one on the given day, and refuses a planned one or a day before the start', () => {
    const open = state().startExperiment(planned().id, { startDate: new Date('2026-11-10T09:00:00'), days: null })!;
    expect(state().stopExperiment(open.id, new Date('2026-11-09T09:00:00'))).toBeNull();
    const stopped = state().stopExperiment(open.id, new Date('2026-11-14T09:00:00'))!;
    expect(new Date(stopped.endDate!).getDate()).toBe(14);
    expect(state().stopExperiment(planned().id, new Date('2026-11-14T09:00:00'))).toBeNull();
  });

  it('keeps planned ones after dated ones', () => {
    const p = planned();
    const d = state().addExperiment(draft())!;
    expect(state().experiments.map(e => e.id)).toEqual([d.id, p.id]);
  });
});
