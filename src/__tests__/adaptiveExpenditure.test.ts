import {
  KCAL_PER_KG,
  MIN_EXPENDITURE_DAYS,
  describeExpenditureShortfall,
  describeLogBasis,
  measuredExpenditure,
} from '../utils/adaptiveExpenditure';

const TODAY = '2026-10-22';
/** The day key `back` days before TODAY. */
const daysBack = (back: number) => {
  const d = new Date(2026, 9, 22 - back);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** `count` logged days ending yesterday, each at `kcal`. */
const intake = (count: number, kcal = 2200) =>
  Array.from({ length: count }, (_, i) => ({ dayKey: daysBack(i + 1), calorieKcal: kcal }));

/** Weigh-ins on the given days back, on a straight line falling `perDay` kg a day from `start`. */
const weighIns = (backs: number[], start = 82, perDay = 0) =>
  backs.map(back => ({ dayKey: daysBack(back), kilograms: start - perDay * (backs[0] - back) }));

describe('measuredExpenditure', () => {
  it('reads a steady weight as eating at maintenance', () => {
    const result = measuredExpenditure(intake(20), weighIns([27, 20, 13, 6, 1]), TODAY);
    expect(result).toMatchObject({ kind: 'measured', kcal: 2200, days: 20, weighIns: 5, averageIntakeKcal: 2200 });
  });

  it('adds the energy a falling trend came from to what was eaten', () => {
    // 0.05 kg a day is 0.35 kg a week, about 385 kcal a day.
    const result = measuredExpenditure(intake(21, 2000), weighIns([26, 19, 12, 5], 82, 0.05), TODAY);
    expect(result.kind).toBe('measured');
    if (result.kind !== 'measured') return;
    expect(result.kcal).toBe(Math.round((2000 + 0.05 * KCAL_PER_KG) / 10) * 10);
    expect(result.trendStartKg).toBeCloseTo(82);
    expect(result.trendEndKg).toBeCloseTo(82 - 0.05 * 21);
  });

  it('lets one heavy morning move the line less than it moves the endpoints', () => {
    const steady = weighIns([27, 22, 17, 12, 7, 2]);
    steady[steady.length - 1] = { ...steady[steady.length - 1], kilograms: 83.5 };
    const result = measuredExpenditure(intake(20), steady, TODAY);
    if (result.kind !== 'measured') throw new Error('expected a figure');
    // Endpoints alone read 1.5 kg gained in 25 days, about 460 kcal a day off.
    const endpointShift = (1.5 / 25) * KCAL_PER_KG;
    expect(2200 - result.kcal).toBeLessThan(endpointShift * 0.8);
  });

  it('leaves out today and anything older than the window', () => {
    const days = [...intake(MIN_EXPENDITURE_DAYS - 1), { dayKey: TODAY, calorieKcal: 900 }, { dayKey: daysBack(40), calorieKcal: 900 }];
    expect(measuredExpenditure(days, weighIns([27, 14, 1]), TODAY)).toMatchObject({ kind: 'short', days: MIN_EXPENDITURE_DAYS - 1 });
  });

  it('skips a day whose calories some entry did not state', () => {
    const days = [...intake(MIN_EXPENDITURE_DAYS - 1), { dayKey: daysBack(20), calorieKcal: undefined }];
    expect(measuredExpenditure(days, weighIns([27, 14, 1]), TODAY).kind).toBe('short');
  });

  it('refuses too few weigh-ins, or weigh-ins too close together', () => {
    expect(measuredExpenditure(intake(20), weighIns([10, 1]), TODAY)).toMatchObject({ kind: 'short', weighIns: 2 });
    expect(measuredExpenditure(intake(20), weighIns([10, 5, 1]), TODAY)).toMatchObject({ kind: 'short', spanDays: 9 });
  });

  it('refuses a figure no body produces, rather than proposing it', () => {
    // A trend falling a kilogram a day is a scale or logging error.
    expect(measuredExpenditure(intake(20, 2000), weighIns([27, 14, 1], 90, 1), TODAY).kind).toBe('implausible');
  });
});

describe('describeExpenditureShortfall', () => {
  it('says what is needed and what there is so far', () => {
    expect(describeExpenditureShortfall({ kind: 'short', days: 9, weighIns: 1, spanDays: 0 }))
      .toBe('Needs 14 fully logged days and 3 weigh-ins at least two weeks apart, in the last four weeks. So far: 9 days, 1 weigh-in.');
  });
});

describe('describeLogBasis', () => {
  const kg = (n: number) => `${n.toFixed(1)} kg`;
  const day = (key: string) => key;

  it('says what was counted and where the trend went', () => {
    const result = measuredExpenditure(intake(20), weighIns([27, 20, 13, 6, 1]), TODAY);
    expect(describeLogBasis(result, kg, day)).toBe(
      `From 20 fully logged days and 5 weigh-ins, ${daysBack(20)} to ${daysBack(1)}. You ate 2,200 cal a day on average, and your weight trend went from 82.0 kg to 82.0 kg.`
    );
  });

  it('says what is missing, and what the target uses meanwhile', () => {
    expect(describeLogBasis({ kind: 'short', days: 2, weighIns: 1, spanDays: 0 }, kg, day))
      .toMatch(/So far: 2 days, 1 weigh-in\. Until then your target uses your activity level\.$/);
    expect(describeLogBasis({ kind: 'implausible' }, kg, day)).toMatch(/uses your activity level/);
    expect(describeLogBasis(null, kg, day)).toBe('');
  });
});
