import {
  PROTEIN_PER_WEIGHT_RANGE,
  parseProteinPerWeight,
  proteinTargetFromWeight,
  serializeProteinPerWeight,
  switchProteinUnit,
} from '../utils/proteinPerWeight';

describe('proteinTargetFromWeight', () => {
  it('multiplies a per-kilogram ratio by the weight', () => {
    expect(proteinTargetFromWeight(80, { unit: 'kg', gramsPerUnit: 1.8 })).toBe(144);
  });

  it('converts the weight into pounds for a per-pound ratio', () => {
    // 80 kg is about 176.37 lb.
    expect(proteinTargetFromWeight(80, { unit: 'lb', gramsPerUnit: 0.8 })).toBe(141);
  });

  it('answers null with no ratio', () => {
    expect(proteinTargetFromWeight(80, null)).toBeNull();
  });

  it('answers null for a weight it cannot trust, rather than zero', () => {
    const setting = { unit: 'kg' as const, gramsPerUnit: 2 };
    expect(proteinTargetFromWeight(null, setting)).toBeNull();
    expect(proteinTargetFromWeight(0, setting)).toBeNull();
    expect(proteinTargetFromWeight(-5, setting)).toBeNull();
    expect(proteinTargetFromWeight(Number.NaN, setting)).toBeNull();
    expect(proteinTargetFromWeight(5000, setting)).toBeNull();
  });

  it('holds the result inside the protein target range', () => {
    expect(proteinTargetFromWeight(300, { unit: 'kg', gramsPerUnit: 4 })).toBe(400);
  });
});

describe('parseProteinPerWeight', () => {
  it('round-trips a stored ratio', () => {
    const setting = { unit: 'lb' as const, gramsPerUnit: 0.85 };
    expect(parseProteinPerWeight(serializeProteinPerWeight(setting))).toEqual(setting);
  });

  it('reads nothing from empty, malformed or wrongly shaped values', () => {
    expect(parseProteinPerWeight(null)).toBeNull();
    expect(parseProteinPerWeight('')).toBeNull();
    expect(parseProteinPerWeight('not json')).toBeNull();
    expect(parseProteinPerWeight('[]')).toBeNull();
    expect(parseProteinPerWeight('{"unit":"stone","gramsPerUnit":1}')).toBeNull();
    expect(parseProteinPerWeight('{"unit":"kg","gramsPerUnit":"2"}')).toBeNull();
  });

  it('clamps a stored ratio into its unit range', () => {
    expect(parseProteinPerWeight('{"unit":"lb","gramsPerUnit":50}')?.gramsPerUnit)
      .toBe(PROTEIN_PER_WEIGHT_RANGE.lb.max);
    expect(parseProteinPerWeight('{"unit":"kg","gramsPerUnit":0}')?.gramsPerUnit)
      .toBe(PROTEIN_PER_WEIGHT_RANGE.kg.min);
  });
});

describe('switchProteinUnit', () => {
  it('keeps the unit and value when nothing changes', () => {
    const setting = { unit: 'kg' as const, gramsPerUnit: 1.6 };
    expect(switchProteinUnit(setting, 'kg')).toBe(setting);
  });

  it('converts a per-pound ratio to the nearest per-kilogram step', () => {
    // 0.8 g/lb is about 1.76 g/kg.
    expect(switchProteinUnit({ unit: 'lb', gramsPerUnit: 0.8 }, 'kg'))
      .toEqual({ unit: 'kg', gramsPerUnit: 1.8 });
  });

  it('converts a per-kilogram ratio to the nearest per-pound step', () => {
    // 2 g/kg is about 0.91 g/lb.
    expect(switchProteinUnit({ unit: 'kg', gramsPerUnit: 2 }, 'lb'))
      .toEqual({ unit: 'lb', gramsPerUnit: 0.9 });
  });
});
