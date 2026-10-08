import { parseQuickDose } from '../utils/quickDose';

const vocab = ['Ibuprofen', 'Vitamin D'];

describe('parseQuickDose', () => {
  it('reads a known medication with an amount', () => {
    expect(parseQuickDose('took ibuprofen 400mg', vocab)).toEqual({ name: 'Ibuprofen', amount: 400, unit: 'mg' });
    expect(parseQuickDose('Took 400 mg of ibuprofen', vocab)).toEqual({ name: 'Ibuprofen', amount: 400, unit: 'mg' });
  });

  it('reads a known medication with no amount', () => {
    expect(parseQuickDose('took vitamin d', vocab)).toEqual({ name: 'Vitamin D', amount: null, unit: null });
  });

  it('records a new medication only when an amount says it is one', () => {
    expect(parseQuickDose('took 2 tablets of melatonin', vocab)).toEqual({ name: 'melatonin', amount: 2, unit: 'tablet' });
    expect(parseQuickDose('took melatonin', vocab)).toBeNull();
  });

  it('normalises unit words', () => {
    expect(parseQuickDose('took 2 pills ibuprofen', vocab)?.unit).toBe('tablet');
    expect(parseQuickDose('took ibuprofen 1.5 ml.', vocab)).toEqual({ name: 'Ibuprofen', amount: 1.5, unit: 'ml' });
  });

  it('leaves everything else as a task', () => {
    expect(parseQuickDose('take ibuprofen 400mg', vocab)).toBeNull();
    expect(parseQuickDose('took the car in', vocab)).toBeNull();
    expect(parseQuickDose('ibuprofen 400mg', vocab)).toBeNull();
    expect(parseQuickDose('took', vocab)).toBeNull();
  });
});
