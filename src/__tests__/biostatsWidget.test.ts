import { biostatsCollapsed, shownFromStored } from '../utils/biostatsWidget';
import { goalContextRows, healthContextRows, limitContextRows } from '../utils/dayContextRows';
import type { ContextRow } from '../types';

// For what dayContextRows imports, not what it does (same pair as its own suite):
// dateUtils reaches the settings store and taskGrouping the category store, and
// both load expo-sqlite.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ use24HourTime: false, dayResetTime: '00:00' }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ categories: [], getCategoryByName: () => null }),
  },
}));

describe('shownFromStored', () => {
  it('uses the new key once it has been written', () => {
    expect(shownFromStored('true', null)).toBe(true);
    expect(shownFromStored('false', 'Biostats')).toBe(false);
  });

  it('reads the category setting it replaced until then', () => {
    expect(shownFromStored(null, 'Biostats')).toBe(true);
    expect(shownFromStored(null, 'Body')).toBe(true);
  });

  it('keeps a cleared category off', () => {
    // A cleared category was stored as '', which was how someone said "not on my list".
    expect(shownFromStored(null, '')).toBe(false);
    expect(shownFromStored(null, '', true)).toBe(false);
  });

  it('falls back to the default only when neither was ever answered', () => {
    expect(shownFromStored(null, null)).toBe(false);
    expect(shownFromStored(null, null, true)).toBe(true);
  });
});

const TODAY = '2026-11-20';
const targets = { calorieKcal: 500, proteinG: 120, sodiumMg: 2300 };

function rows(opts: { steps?: number; stepGoal?: number | null; sodium?: number; calories?: number } = {}): ContextRow[] {
  return [
    ...healthContextRows(
      { dayKey: TODAY, steps: opts.steps ?? 4229, activeEnergyKcal: 352 },
      { todayKey: TODAY, category: null, stepGoal: opts.stepGoal === undefined ? 8000 : opts.stepGoal },
    ),
    ...limitContextRows({ sodiumMg: opts.sodium ?? 1980 }, targets, ['sodiumMg'], { category: null, warnPercent: 80 }),
    ...goalContextRows({ calorieKcal: opts.calories ?? 366, proteinG: 72 }, targets, ['sodiumMg'], { category: null }),
  ];
}

describe('reading on a row', () => {
  it('splits the figure from its goal, for the tiles', () => {
    const byId = new Map(rows().map(r => [r.id, r.reading]));
    expect(byId.get('health-steps')).toEqual({ label: 'Steps', figure: '4,229', of: '8,000' });
    expect(byId.get('health-activeEnergy')).toEqual({ label: 'Active calories', figure: '352' });
    expect(byId.get('goal-proteinG')?.figure).toBe('72');
    expect(byId.get('goal-proteinG')?.of).toBe('120g');
    expect(byId.get('limit-sodiumMg')?.of).toBe('2,300mg');
  });

  it('has no goal for steps when none is set', () => {
    const steps = rows({ stepGoal: null }).find(r => r.id === 'health-steps');
    expect(steps?.reading).toEqual({ label: 'Steps', figure: '4,229' });
  });
});

describe('biostatsCollapsed', () => {
  it('leads with calories as a labeled bar, never a bare ring', () => {
    const { bars } = biostatsCollapsed(rows());
    expect(bars[0]).toMatchObject({ id: 'goal-calorieKcal', label: 'Calories', value: '73%' });
    expect(bars.filter(b => b.id === 'goal-calorieKcal')).toHaveLength(1);
  });

  it('puts a limit that is close ahead of steps, after calories', () => {
    const { bars } = biostatsCollapsed(rows());
    expect(bars.map(b => b.id)).toEqual(['goal-calorieKcal', 'limit-sodiumMg', 'health-steps']);
    expect(bars[1]).toMatchObject({ label: 'Sodium', value: '86%', tone: 'near' });
    expect(bars[2]).toMatchObject({ label: 'Steps', value: '4,229' });
  });

  it('puts steps first while every limit is comfortably within', () => {
    const { bars } = biostatsCollapsed(rows({ sodium: 500 }));
    expect(bars.map(b => b.id)).toEqual(['goal-calorieKcal', 'health-steps', 'limit-sodiumMg']);
    expect(bars[2].tone).toBeUndefined();
  });

  it('says Over rather than a percentage past a limit', () => {
    const { bars } = biostatsCollapsed(rows({ sodium: 3000 }));
    expect(bars[1]).toMatchObject({ id: 'limit-sodiumMg', value: 'Over', tone: 'over', fraction: 1 });
  });

  it('shows calories and at most two more', () => {
    const many = [
      ...rows(),
      ...limitContextRows({ satFatG: 19, sugarG: 49 }, { ...targets, satFatG: 20, sugarG: 50 }, ['satFatG', 'sugarG'], { category: null, warnPercent: 80 }),
    ];
    expect(biostatsCollapsed(many).bars).toHaveLength(3);
  });

  it('falls back to the rows’ own titles when there is nothing to draw', () => {
    const only = healthContextRows(
      { dayKey: TODAY, steps: null, activeEnergyKcal: 352 },
      { todayKey: TODAY, category: null },
    );
    const collapsed = biostatsCollapsed(only);
    expect(collapsed.bars).toEqual([]);
    expect(collapsed.text).toBe('352 active cal');
  });
});
