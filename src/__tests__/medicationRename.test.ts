import type { ChainItem, MedicationLog, Task, TemplateItem } from '../types';
import {
  renamedChain,
  renamedKeys,
  renamedLogs,
  renamedSettings,
  renamedTask,
  renamedTemplateItem,
  splitStrength,
} from '../utils/medicationRename';

const log = (over: Partial<MedicationLog>): MedicationLog => ({
  id: 'l1',
  name: 'Ibuprofen 200',
  takenAt: '2026-09-01T09:00:00.000Z',
  dayKey: '2026-09-01',
  amount: null,
  unit: null,
  asNeeded: true,
  taskId: null,
  note: null,
  ...over,
});

describe('renamedLogs', () => {
  it('renames only the named medication', () => {
    const out = renamedLogs([log({ id: 'a' }), log({ id: 'b', name: 'Tylenol' })], 'ibuprofen 200', 'Ibuprofen', null);
    expect(out.map(l => [l.id, l.name])).toEqual([['a', 'Ibuprofen']]);
  });

  it('fills a strength only onto doses with no amount', () => {
    const out = renamedLogs(
      [log({ id: 'a' }), log({ id: 'b', amount: 400, unit: 'mg' })],
      'ibuprofen 200',
      'Ibuprofen',
      { amount: 200, unit: 'mg' },
    );
    expect(out.find(l => l.id === 'a')).toMatchObject({ amount: 200, unit: 'mg' });
    expect(out.find(l => l.id === 'b')).toMatchObject({ amount: 400, unit: 'mg' });
  });

  it('reports nothing for a dose the rename would not change', () => {
    expect(renamedLogs([log({ name: 'Ibuprofen' })], 'ibuprofen', 'Ibuprofen', null)).toEqual([]);
  });

  it('fixes capitalization on a same-key rename', () => {
    const out = renamedLogs([log({ name: 'ibuprofen' })], 'ibuprofen', 'Ibuprofen', null);
    expect(out[0].name).toBe('Ibuprofen');
  });
});

describe('renamedSettings', () => {
  const limit = { minHours: 6, maxPer24h: null, notify: false, since: '2026-01-01T00:00:00.000Z' };
  const supply = { count: 10, unit: 'tablet', refillCount: null, reorderAt: 5, since: '2026-01-01T00:00:00.000Z', declinedAt: null };

  it('moves the settings to the new key', () => {
    const out = renamedSettings({ a: { limit, supply: null } }, 'a', 'b');
    expect(out).toEqual({ b: { limit, supply: null } });
  });

  it('keeps the target limit and supply when both have one', () => {
    const other = { ...limit, minHours: 4 };
    const out = renamedSettings({ a: { limit, supply }, b: { limit: other, supply: null } }, 'a', 'b');
    expect(out.b).toEqual({ limit: other, supply });
    expect(out.a).toBeUndefined();
  });

  it('carries a supplement panel to the new key', () => {
    const nutrition = { per: 'tablet', amounts: { vitaminCMg: 90 } } as never;
    const out = renamedSettings({ a: { limit: null, supply: null, nutrition } }, 'a', 'b');
    expect(out.b.nutrition).toBe(nutrition);
  });

  it('returns the same map when there is nothing to move', () => {
    const map = { b: { limit, supply: null } };
    expect(renamedSettings(map, 'a', 'b')).toBe(map);
  });
});

describe('renamedKeys', () => {
  it('moves a key and carries it when asked', () => {
    expect(renamedKeys(['a', 'c'], 'a', 'b', true)).toEqual(['c', 'b']);
  });
  it('drops the key without carrying it', () => {
    expect(renamedKeys(['a'], 'a', 'b', false)).toEqual([]);
  });
  it('does not duplicate the target', () => {
    expect(renamedKeys(['a', 'b'], 'a', 'b', true)).toEqual(['b']);
  });
  it('leaves a list that never held the key alone', () => {
    expect(renamedKeys(['c'], 'a', 'b', true)).toEqual(['c']);
  });
});

describe('chain, task and template item', () => {
  const steps = [
    { id: 's1', title: 'AM', medicationName: 'Ibuprofen 200' },
    { id: 's2', title: 'PM', medicationName: 'Tylenol' },
  ] as unknown as ChainItem[];

  it('renames only the steps naming the medication', () => {
    const out = renamedChain(steps, 'ibuprofen 200', 'Ibuprofen')!;
    expect(out.map(s => s.medicationName)).toEqual(['Ibuprofen', 'Tylenol']);
  });

  it('returns the same array when no step names it', () => {
    expect(renamedChain(steps, 'aspirin', 'X')).toBe(steps);
  });

  it('renames a task on its own name or a step', () => {
    const named = renamedTask({ medicationName: 'Ibuprofen 200', chainItems: [] } as unknown as Task, 'ibuprofen 200', 'Ibuprofen');
    expect(named?.medicationName).toBe('Ibuprofen');
    const viaStep = renamedTask({ medicationName: null, chainItems: steps } as unknown as Task, 'ibuprofen 200', 'Ibuprofen');
    expect(viaStep?.chainItems[0].medicationName).toBe('Ibuprofen');
    expect(renamedTask({ medicationName: 'Tylenol', chainItems: [] } as unknown as Task, 'ibuprofen 200', 'Ibuprofen')).toBeNull();
  });

  it('renames a template item', () => {
    const item = { medicationName: 'Ibuprofen 200', chainItems: [] } as unknown as TemplateItem;
    expect(renamedTemplateItem(item, 'ibuprofen 200', 'Ibuprofen')?.medicationName).toBe('Ibuprofen');
    expect(renamedTemplateItem(item, 'other', 'X')).toBeNull();
  });
});

describe('splitStrength', () => {
  it('splits a trailing number', () => {
    expect(splitStrength('Ibuprofen 200')).toEqual({ stem: 'Ibuprofen', amount: 200, unit: null });
  });
  it('reads a stated unit', () => {
    expect(splitStrength('Sertraline 25 mcg')).toEqual({ stem: 'Sertraline', amount: 25, unit: 'mcg' });
  });
  it('returns null for a name with no strength', () => {
    expect(splitStrength('Ibuprofen')).toBeNull();
    expect(splitStrength('200')).toBeNull();
  });
});
