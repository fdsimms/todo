import { describeTaskDose } from '../utils/taskDose';

const base = { name: 'Vitamin D', amount: '', unit: null as string | null, usual: null, strength: null };

describe('describeTaskDose', () => {
  it('says a task with no amount records the usual one', () => {
    const p = describeTaskDose({ ...base, usual: { amount: 125, unit: 'mcg' } });
    expect(p.dose).toBe('125 mcg');
    expect(p.text).toBe('Each time you complete this task, it logs 125 mcg of Vitamin D.');
    expect(p.needsUnit).toBe(false);
  });

  it('reads a counted usual amount through the strength', () => {
    const p = describeTaskDose({ ...base, usual: { amount: 1, unit: 'capsule' }, strength: { amount: 125, unit: 'mcg' } });
    expect(p.dose).toBe('1 capsule (125 mcg)');
  });

  it('prefers an amount the task names', () => {
    const p = describeTaskDose({ ...base, amount: '200', unit: 'mcg', usual: { amount: 125, unit: 'mcg' } });
    expect(p.dose).toBe('200 mcg');
  });

  it('says so when there is nothing to record an amount from', () => {
    const p = describeTaskDose(base);
    expect(p.dose).toBeNull();
    expect(p.text).toBe('Each time you complete this task, it logs a dose of Vitamin D with no amount.');
  });

  it('flags a number typed with no unit, and falls back to the usual amount', () => {
    const p = describeTaskDose({ ...base, amount: '125', usual: { amount: 1, unit: 'capsule' } });
    expect(p.needsUnit).toBe(true);
    expect(p.dose).toBe('1 capsule');
  });

  it('does not apply a strength to a measured amount', () => {
    const p = describeTaskDose({ ...base, amount: '400', unit: 'mg', strength: { amount: 125, unit: 'mcg' } });
    expect(p.dose).toBe('400 mg');
  });
});
