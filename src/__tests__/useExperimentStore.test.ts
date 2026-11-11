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
    expect(new Date(e.startDate).getHours()).toBe(12);
    expect(new Date(e.startDate).getDate()).toBe(1);
    expect(new Date(e.endDate).getDate()).toBe(28);
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
    expect(new Date(next.endDate).getDate()).toBe(5);
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
