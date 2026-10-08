import type { MedicationLog } from '../types';
import { describeDoseAction, searchActions, QUICK_ACTION_LIMIT } from '../utils/searchActions';
import type { MedicationSettingsMap } from '../utils/medicationSettings';

let seq = 0;

function dose(name: string, at: string, overrides: Partial<MedicationLog> = {}): MedicationLog {
  seq++;
  return {
    id: `d-${seq}`,
    name,
    takenAt: new Date(at).toISOString(),
    dayKey: at.slice(0, 10),
    amount: 220,
    unit: 'mg',
    asNeeded: true,
    taskId: null,
    note: null,
    ...overrides,
  };
}

const logs: MedicationLog[] = [
  dose('Aleve', '2026-10-01T09:00'),
  dose('Aleve', '2026-10-05T09:00', { amount: 440 }),
  dose('Advil', '2026-10-02T09:00', { amount: 200 }),
  dose('Vitamin D', '2026-10-03T09:00', { amount: 1, unit: 'tablet' }),
];

const names = (query: string, from: MedicationLog[] = logs, archived: string[] = []) =>
  searchActions(query, from, archived).actions.map(a => a.dose.name);

describe('searchActions', () => {
  it('offers a dose of a logged medication named after a verb', () => {
    const { actions, explicit } = searchActions('take aleve', logs);
    expect(explicit).toBe(true);
    expect(actions).toHaveLength(1);
    expect(actions[0].dose).toEqual({ name: 'Aleve', amount: 440, unit: 'mg', asNeeded: true });
    expect(names('Took ALEVE')).toEqual(['Aleve']);
    expect(names('log my aleve')).toEqual(['Aleve']);
  });

  it('repeats the most recent dose when no amount is typed, and records a typed one', () => {
    expect(searchActions('take aleve', logs).actions[0].dose.amount).toBe(440);
    expect(searchActions('take aleve 220mg', logs).actions[0].dose).toEqual(
      { name: 'Aleve', amount: 220, unit: 'mg', asNeeded: true });
    expect(searchActions('take 2 tablets of vitamin d', logs).actions[0].dose).toEqual(
      { name: 'Vitamin D', amount: 2, unit: 'tablet', asNeeded: true });
  });

  it('matches the start of a name or of one of its words', () => {
    expect(names('take a')).toEqual([]); // "a" is a filler word, and nothing is left
    expect(names('take al')).toEqual(['Aleve']);
    expect(names('take ad')).toEqual(['Advil']);
    expect(names('take d')).toEqual(['Vitamin D']);
    expect(names('take leve')).toEqual([]);
  });

  it('puts an exact name ahead of a longer one it starts', () => {
    const more = [...logs, dose('Aleve PM', '2026-10-06T21:00'), dose('Aleve PM', '2026-10-07T21:00')];
    expect(names('take aleve', more)).toEqual(['Aleve', 'Aleve PM']);
  });

  it('offers a bare name only once it is long enough to mean something', () => {
    expect(searchActions('aleve', logs)).toEqual({ actions: expect.any(Array), explicit: false });
    expect(names('ale')).toEqual(['Aleve']);
    expect(names('al')).toEqual([]);
  });

  it('offers nothing for a search that is about something else', () => {
    expect(names('buy aleve')).toEqual([]);
    expect(names('take out the trash')).toEqual([]);
    expect(names('take')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('take aleve', [])).toEqual([]);
  });

  it('leaves out archived medications', () => {
    expect(names('take aleve', logs, ['aleve'])).toEqual([]);
  });

  it('caps the rows it offers', () => {
    const many = ['Med A', 'Med B', 'Med C', 'Med D', 'Med E'].map(n => dose(n, '2026-10-01T09:00'));
    expect(names('take med', many)).toHaveLength(QUICK_ACTION_LIMIT);
    expect(searchActions('take med', many, [], 1).actions).toHaveLength(1);
    expect(searchActions('take med', many, [], 0)).toEqual({ actions: [], explicit: false });
  });
});

describe('describeDoseAction', () => {
  const now = new Date('2026-10-05T12:00');
  const [action] = searchActions('take aleve', logs).actions;

  it('says the dose and when it was last taken', () => {
    expect(describeDoseAction(action, logs, {}, now)).toEqual({
      title: 'Record a dose of Aleve',
      meta: ['440 mg', 'Last taken 9:00 AM'],
      tooSoon: false,
    });
    expect(describeDoseAction(action, logs, {}, new Date('2026-10-08T12:00')).meta[1])
      .toBe('Last taken Oct 5, 9:00 AM');
  });

  it('says when the limit you set allows the next dose, when that is not yet', () => {
    const settings: MedicationSettingsMap = {
      aleve: {
        limit: { minHours: 8, maxPer24h: null, notify: false, since: new Date('2026-01-01T00:00').toISOString() },
        supply: null,
      },
    };
    expect(describeDoseAction(action, logs, settings, now)).toEqual({
      title: 'Record a dose of Aleve',
      meta: ['440 mg', 'Within your limit at 5:00 PM'],
      tooSoon: true,
    });
  });

  it('leaves out an amount nobody recorded', () => {
    const bare = [dose('Tums', '2026-10-05T08:00', { amount: null, unit: null })];
    const [tums] = searchActions('take tums', bare).actions;
    expect(describeDoseAction(tums, bare, {}, now).meta).toEqual(['Last taken 8:00 AM']);
  });
});
