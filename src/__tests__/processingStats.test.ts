import type { FoodLogEntry, NovaGroup } from '../types';
import {
  describeProcessingCoverage,
  entryNovaGroup,
  formatShare,
  processingMix,
} from '../utils/processingStats';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const WINDOW = { startKey: '2026-10-01', endKey: '2026-10-07', todayKey: '2026-10-08' };

let seq = 0;
function entry(kcal: number | undefined, nova?: NovaGroup, over: Partial<FoodLogEntry> = {}): FoodLogEntry {
  seq += 1;
  return {
    id: `e-${seq}`, dayKey: '2026-10-03', label: `Food ${seq}`, recipeId: null, itemId: null, productId: null,
    quantity: '', grams: null, slot: 'lunch',
    nutrition: {
      basis: 'perServing', servingGrams: null, servingText: null,
      amounts: kcal === undefined ? { proteinG: 3 } : { calorieKcal: kcal },
      source: 'manual', sourceId: null, portions: [], recordedAt: '2026-10-03T12:00:00.000Z',
      ...(nova ? { novaGroup: nova } : {}),
    },
    sourcePanel: null,
    ...over,
  } as unknown as FoodLogEntry;
}

describe('processingMix', () => {
  it('takes group 4 as a share of the classified calories, with the coverage beside it', () => {
    const mix = processingMix([entry(300, 4), entry(100, 1), entry(600)], WINDOW)!;
    expect(mix.ultraProcessedShare).toBeCloseTo(0.75);
    expect(mix.kcalByGroup).toEqual({ 1: 100, 2: 0, 3: 0, 4: 300 });
    expect(mix.coverage).toBeCloseTo(0.4);
    expect([mix.entries, mix.entriesClassified]).toEqual([3, 2]);
  });

  it('is null when nothing in the window carries a group, never a share of zero', () => {
    expect(processingMix([entry(300), entry(100)], WINDOW)).toBeNull();
    expect(processingMix([], WINDOW)).toBeNull();
  });

  it('leaves out entries outside the window, without calories, or that are only water', () => {
    const water = entry(undefined, undefined, {
      nutrition: { ...entry(1).nutrition, amounts: { waterMl: 250 } },
    });
    const mix = processingMix([
      entry(200, 4),
      entry(500, 4, { dayKey: '2026-09-30' }),
      entry(undefined, 4),
      water,
    ], WINDOW)!;
    expect(mix.kcalClassified).toBe(200);
    expect(mix.entries).toBe(1);
  });

  it('reads the group off the kept panel when the helping carries none', () => {
    const kept = entry(200, undefined, { sourcePanel: { ...entry(1).nutrition, novaGroup: 3 } });
    expect(entryNovaGroup(kept)).toBe(3);
    expect(entryNovaGroup(entry(200))).toBeNull();
  });
});

describe('wording', () => {
  it('formats the share as a whole percent and says what it was built on', () => {
    const mix = processingMix([entry(300, 4), entry(100, 1), entry(600)], WINDOW)!;
    expect(formatShare(mix.ultraProcessedShare)).toBe('75%');
    expect(describeProcessingCoverage(mix)).toBe('Based on 2 of 3 entries with a processing group, 40% of logged calories');
  });

  it('says entry for one', () => {
    const mix = processingMix([entry(300, 4)], WINDOW)!;
    expect(describeProcessingCoverage(mix)).toBe('Based on 1 of 1 entry with a processing group, 100% of logged calories');
  });
});
