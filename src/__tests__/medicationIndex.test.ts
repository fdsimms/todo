import type { MedicationLog } from '../types';
import {
  buildMedicationIndex,
  parseQueuedDoses,
  resolveQueuedDoseName,
} from '../utils/medicationIndex';

let seq = 0;
function dose(name: string): MedicationLog {
  seq++;
  return {
    id: `d-${seq}`, name, takenAt: '2026-09-11T09:00:00.000Z', dayKey: '2026-09-11',
    amount: null, unit: null, asNeeded: true, taskId: null, note: null,
  };
}

describe('buildMedicationIndex', () => {
  it('lists current medications by key, sorted by name', () => {
    const logs = [dose('Zyrtec'), dose('ibuprofen'), dose('Ibuprofen'), dose('Amoxicillin')];
    expect(buildMedicationIndex(logs, ['amoxicillin'])).toEqual([
      { id: 'ibuprofen', name: 'ibuprofen' },
      { id: 'zyrtec', name: 'Zyrtec' },
    ]);
  });
});

describe('parseQueuedDoses', () => {
  it('reads well-formed entries and drops the rest', () => {
    const json = JSON.stringify([
      { id: 'ibuprofen', name: 'Ibuprofen', at: '2026-09-11T09:00:00Z' },
      { id: '', name: ' Zyrtec ', at: 'nonsense' },
      { name: '' },
      7,
    ]);
    expect(parseQueuedDoses(json)).toEqual([
      { id: 'ibuprofen', name: 'Ibuprofen', at: new Date('2026-09-11T09:00:00Z') },
      { id: null, name: 'Zyrtec', at: null },
    ]);
    expect(parseQueuedDoses('nope')).toEqual([]);
    expect(parseQueuedDoses('{}')).toEqual([]);
  });
});

describe('resolveQueuedDoseName', () => {
  const logs = [dose('Ibuprofen'), dose('Zyrtec')];

  it('prefers the id, then the spoken name, then the name as heard', () => {
    expect(resolveQueuedDoseName({ id: 'zyrtec', name: 'something', at: null }, logs)).toBe('Zyrtec');
    expect(resolveQueuedDoseName({ id: 'gone', name: 'IBUPROFEN', at: null }, logs)).toBe('Ibuprofen');
    expect(resolveQueuedDoseName({ id: null, name: 'Melatonin', at: null }, logs)).toBe('Melatonin');
  });
});
