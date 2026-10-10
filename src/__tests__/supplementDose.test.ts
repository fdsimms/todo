import type { FoodLogEntry, MedicationLog } from '../types';
import type { SupplementPanel } from '../utils/medicationSettings';
import type { LabelReading } from '../utils/labelOcr';
import {
  applyLabelToSupplementForm,
  buildSupplementPanel,
  describeSupplementPanel,
  doseSourceId,
  emptySupplementForm,
  entryForDose,
  invalidSupplementFields,
  isSupplementEntry,
  servingFromLabelText,
  supplementDoseIdOf,
  supplementFieldCount,
  supplementFormDirty,
  supplementFormFrom,
  supplementHelping,
  supplementServings,
} from '../utils/supplementDose';

const multi: SupplementPanel = {
  servingAmount: 2,
  servingUnit: 'tablet',
  amounts: { vitaminCMg: 90, vitaminDMcg: 25, magnesiumMg: 100, zincMg: 11 },
};

function dose(overrides: Partial<MedicationLog> = {}): MedicationLog {
  return {
    id: 'd1',
    name: 'Multivitamin',
    takenAt: '2026-09-16T08:00:00.000Z',
    dayKey: '2026-09-16',
    amount: 2,
    unit: 'tablet',
    asNeeded: false,
    taskId: null,
    note: null,
    ...overrides,
  };
}

function entryOf(sourceId: string | null): FoodLogEntry {
  return {
    id: 'e1',
    dayKey: '2026-09-16',
    atISO: '2026-09-16T08:00:00.000Z',
    slot: null,
    label: 'Multivitamin',
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '2 tablets',
    grams: null,
    nutrition: {
      basis: 'perServing',
      servingGrams: null,
      servingText: '2 tablets',
      amounts: { vitaminCMg: 90 },
      source: 'manual',
      sourceId,
      portions: [],
      recordedAt: '2026-09-16T08:00:00.000Z',
    },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-09-16T08:00:00.000Z',
  };
}

describe('supplementServings', () => {
  it('counts a dose in the panel unit as that many servings of it', () => {
    expect(supplementServings(multi, { amount: 2, unit: 'tablet' })).toBe(1);
    expect(supplementServings(multi, { amount: 1, unit: 'tablet' })).toBe(0.5);
    expect(supplementServings(multi, { amount: 4, unit: 'tablet' })).toBe(2);
  });

  it('counts a dose with no amount as one serving', () => {
    expect(supplementServings(multi, { amount: null, unit: null })).toBe(1);
  });

  it('counts a dose in another unit as one serving, the supply\'s rule', () => {
    expect(supplementServings(multi, { amount: 500, unit: 'mg' })).toBe(1);
  });
});

describe('supplementHelping', () => {
  it('writes the stated figures scaled to the dose', () => {
    const h = supplementHelping(multi, dose({ amount: 1 }))!;
    expect(h.nutrition.amounts).toEqual({ vitaminCMg: 45, vitaminDMcg: 12.5, magnesiumMg: 50, zincMg: 5.5 });
    expect(h.quantity).toBe('1 tablet');
    expect(h.label).toBe('Multivitamin');
  });

  it('never states a nutrient the panel does not', () => {
    const h = supplementHelping(multi, dose())!;
    expect(Object.keys(h.nutrition.amounts).sort()).toEqual(['magnesiumMg', 'vitaminCMg', 'vitaminDMcg', 'zincMg']);
    expect(h.nutrition.amounts.calorieKcal).toBeUndefined();
    expect(h.nutrition.amounts.ironMg).toBeUndefined();
  });

  it('keeps a stated zero as zero', () => {
    const h = supplementHelping({ ...multi, amounts: { zincMg: 0, vitaminCMg: 10 } }, dose())!;
    expect(h.nutrition.amounts.zincMg).toBe(0);
  });

  it('says one dose when none was stated', () => {
    const h = supplementHelping(multi, dose({ amount: null, unit: null }))!;
    expect(h.quantity).toBe('1 dose');
    expect(h.nutrition.amounts.vitaminCMg).toBe(90);
  });

  it('links the entry to its dose and marks it typed in', () => {
    const h = supplementHelping(multi, dose({ id: 'abc' }))!;
    expect(h.nutrition.sourceId).toBe(doseSourceId('abc'));
    expect(h.nutrition.source).toBe('manual');
    expect(h.nutrition.basis).toBe('perServing');
  });

  it('rounds away float noise', () => {
    const h = supplementHelping({ servingAmount: 3, servingUnit: 'tablet', amounts: { zincMg: 10 } }, dose({ amount: 1 }))!;
    expect(h.nutrition.amounts.zincMg).toBe(3.333);
  });

  it('returns null for a panel that states nothing', () => {
    expect(supplementHelping({ ...multi, amounts: {} }, dose())).toBeNull();
  });
});

describe('the dose link', () => {
  it('reads the dose id back out of an entry it wrote', () => {
    expect(supplementDoseIdOf(entryOf(doseSourceId('d9')))).toBe('d9');
    expect(isSupplementEntry(entryOf(doseSourceId('d9')))).toBe(true);
  });

  it('is not claimed by any other entry', () => {
    expect(supplementDoseIdOf(entryOf(null))).toBeNull();
    expect(supplementDoseIdOf(entryOf('012345'))).toBeNull();
    expect(supplementDoseIdOf(entryOf('dose:'))).toBeNull();
    expect(isSupplementEntry(entryOf('fdc:1234'))).toBe(false);
  });

  it('finds the entry for a dose among a day', () => {
    const a = { ...entryOf(doseSourceId('d1')), id: 'a' };
    const b = { ...entryOf(doseSourceId('d2')), id: 'b' };
    expect(entryForDose([a, b], 'd2')?.id).toBe('b');
    expect(entryForDose([a, b], 'nope')).toBeNull();
  });
});

describe('the panel form', () => {
  it('opens blank with one tablet', () => {
    const form = emptySupplementForm();
    expect(form.servingAmount).toBe('1');
    expect(form.servingUnit).toBe('tablet');
    expect(buildSupplementPanel(form)).toBeNull();
  });

  it('round-trips a panel, leaving unstated figures blank rather than zero', () => {
    const form = supplementFormFrom(multi);
    expect(form.amounts.vitaminCMg).toBe('90');
    expect(form.amounts.ironMg).toBe('');
    expect(buildSupplementPanel(form)).toEqual(multi);
  });

  it('keeps a typed zero and drops a blank', () => {
    const form = supplementFormFrom(null);
    form.amounts.zincMg = '0';
    const panel = buildSupplementPanel(form)!;
    expect(panel.amounts).toEqual({ zincMg: 0 });
  });

  it('refuses a figure it cannot read instead of dropping it', () => {
    const form = supplementFormFrom(multi);
    form.amounts.zincMg = '11mg';
    expect(invalidSupplementFields(form)).toEqual(['zincMg']);
    expect(buildSupplementPanel(form)).toBeNull();
  });

  it('refuses a serving that is blank or zero', () => {
    const form = supplementFormFrom(multi);
    form.servingAmount = '';
    expect(invalidSupplementFields(form)).toContain('servingAmount');
    form.servingAmount = '0';
    expect(invalidSupplementFields(form)).toContain('servingAmount');
  });

  it('accepts a decimal comma', () => {
    const form = supplementFormFrom(null);
    form.servingAmount = '1,5';
    form.amounts.copperMg = '0,9';
    expect(buildSupplementPanel(form)).toEqual({ servingAmount: 1.5, servingUnit: 'tablet', amounts: { copperMg: 0.9 } });
  });

  it('notices a change for the discard guard', () => {
    const form = supplementFormFrom(multi);
    expect(supplementFormDirty(form, multi)).toBe(false);
    form.amounts.zincMg = '12';
    expect(supplementFormDirty(form, multi)).toBe(true);
    expect(supplementFormDirty(supplementFormFrom(null), null)).toBe(false);
  });
});

describe('describeSupplementPanel', () => {
  it('names the serving and counts what is stated', () => {
    const d = describeSupplementPanel(multi);
    expect(d.heading).toBe('Per 2 tablets: 4 nutrients');
    expect(d.detail).toContain('Vitamin C 90 mg');
    expect(supplementFieldCount(multi)).toBe(4);
  });

  it('lists the first few and counts the rest', () => {
    const big: SupplementPanel = {
      servingAmount: 1,
      servingUnit: 'capsule',
      amounts: { vitaminAMcg: 1, vitaminCMg: 2, vitaminDMcg: 3, vitaminEMg: 4, vitaminKMcg: 5, zincMg: 6 },
    };
    const d = describeSupplementPanel(big);
    expect(d.heading).toBe('Per 1 capsule: 6 nutrients');
    expect(d.detail.endsWith('and 2 more')).toBe(true);
  });
});

describe('servingFromLabelText', () => {
  it('maps the wordings a supplement label uses onto a panel unit', () => {
    expect(servingFromLabelText('2 tablets')).toEqual({ amount: 2, unit: 'tablet' });
    expect(servingFromLabelText('1 Softgel')).toEqual({ amount: 1, unit: 'capsule' });
    expect(servingFromLabelText('1 capsule (500 mg)')).toEqual({ amount: 1, unit: 'capsule' });
    expect(servingFromLabelText('1,5 caplets')).toEqual({ amount: 1.5, unit: 'tablet' });
    expect(servingFromLabelText('5 ml')).toEqual({ amount: 5, unit: 'ml' });
  });

  it('refuses wording it cannot map rather than guessing a unit', () => {
    expect(servingFromLabelText('1 gummy')).toBeNull();
    expect(servingFromLabelText('1 scoop (30 g)')).toBeNull();
    expect(servingFromLabelText('Tablets')).toBeNull();
    expect(servingFromLabelText(null)).toBeNull();
  });
});

describe('applyLabelToSupplementForm', () => {
  const reading = (servingText: string | null, amounts: LabelReading['columns'][number]['amounts']): LabelReading => ({
    servingText,
    servingGrams: null,
    columns: [{ basis: null, amounts }],
  });

  it('fills the stated figures and the serving, leaving the rest as they were', () => {
    const form = supplementFormFrom(null);
    form.amounts.zincMg = '5';
    const next = applyLabelToSupplementForm(form, reading('2 tablets', { vitaminCMg: 90, magnesiumMg: 100 }));
    expect(next.servingAmount).toBe('2');
    expect(next.servingUnit).toBe('tablet');
    expect(next.amounts.vitaminCMg).toBe('90');
    expect(next.amounts.magnesiumMg).toBe('100');
    expect(next.amounts.zincMg).toBe('5');
    expect(next.amounts.ironMg).toBe('');
  });

  it('keeps the serving fields when the serving wording cannot be mapped', () => {
    const form = { ...supplementFormFrom(null), servingAmount: '3', servingUnit: 'capsule' };
    const next = applyLabelToSupplementForm(form, reading('1 gummy', { zincMg: 11 }));
    expect(next.servingAmount).toBe('3');
    expect(next.servingUnit).toBe('capsule');
    expect(next.amounts.zincMg).toBe('11');
  });
});
