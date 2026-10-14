import { nutrientTaskBar, nutrientTaskLine, nutrientsCoveredByTasks } from '../utils/nutrientTaskBar';

const targets = { satFatG: 16, proteinG: 150 };
const limit = { generatedKind: 'limitWarning' as const, generatedSourceId: 'satFatG' };
const goal = { generatedKind: 'goalTarget' as const, generatedSourceId: 'proteinG|2026-10-13' };

describe('nutrientTaskBar', () => {
  it('fills a limit by the share used, and tones it near then over', () => {
    expect(nutrientTaskBar(limit, { satFatG: 8 }, targets, 75)).toEqual({ fraction: 0.5, tone: null });
    expect(nutrientTaskBar(limit, { satFatG: 13 }, targets, 75)).toMatchObject({ tone: 'near' });
    expect(nutrientTaskBar(limit, { satFatG: 20 }, targets, 75)).toEqual({ fraction: 1, tone: 'over' });
  });

  it('fills a goal with no tone, even past it', () => {
    expect(nutrientTaskBar(goal, { proteinG: 75 }, targets, 75)).toEqual({ fraction: 0.5, tone: null });
    expect(nutrientTaskBar(goal, { proteinG: 300 }, targets, 75)).toEqual({ fraction: 1, tone: null });
  });

  it('draws nothing for another task or a nutrient with no target', () => {
    expect(nutrientTaskBar({ generatedKind: 'snackNudge', generatedSourceId: 'x' }, {}, targets, 75)).toBeNull();
    expect(nutrientTaskBar({ generatedKind: 'limitWarning', generatedSourceId: 'sugarG' }, {}, targets, 75)).toBeNull();
  });
});

describe('nutrientTaskLine', () => {
  it('names the nutrient and puts the total against the target', () => {
    expect(nutrientTaskLine(limit, { satFatG: 24.94 }, targets)).toEqual({ name: 'Sat fat', figure: '24.9 / 16g' });
    expect(nutrientTaskLine(goal, {}, targets)).toEqual({ name: 'Protein', figure: '0 / 150g' });
  });

  it('is null for another task or a nutrient with no target', () => {
    expect(nutrientTaskLine({ generatedKind: 'snackNudge', generatedSourceId: 'x' }, {}, targets)).toBeNull();
    expect(nutrientTaskLine({ generatedKind: 'limitWarning', generatedSourceId: 'sugarG' }, {}, targets)).toBeNull();
  });
});

describe('nutrientsCoveredByTasks', () => {
  const row = (t: object, archived = false) => ({ generatedKind: null, generatedSourceId: null, archived, ...t });

  it('covers a limit, and a goal for today only', () => {
    const tasks = [
      row(limit),
      row(goal),
      row({ generatedKind: 'goalTarget', generatedSourceId: 'fiberG|2026-10-12' }),
    ];
    expect(nutrientsCoveredByTasks(tasks, '2026-10-13').sort()).toEqual(['proteinG', 'satFatG']);
  });

  it('ignores an archived task, so the row comes back', () => {
    expect(nutrientsCoveredByTasks([row(limit, true)], '2026-10-13')).toEqual([]);
  });
});
