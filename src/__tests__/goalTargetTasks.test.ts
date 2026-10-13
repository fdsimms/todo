import {
  goalReadings,
  goalTargetDayOf,
  goalTargetKeyOf,
  goalTargetNotes,
  goalTargetSourceId,
  goalTargetTitle,
} from '../utils/goalTargetTasks';

const targets = { proteinG: 120, fiberG: 30, satFatG: 16, sodiumMg: 0, waterMl: 2500 };

describe('goalReadings', () => {
  it('reads each goal in label order, leaving out limits, water and zero targets', () => {
    expect(goalReadings({ proteinG: 80, fiberG: 31 }, targets, ['satFatG']).map(r => r.key)).toEqual(['fiberG', 'proteinG']);
  });

  it('reads a goal nothing logged states as zero, not reached', () => {
    expect(goalReadings({}, { proteinG: 120 }, [])).toEqual([
      { key: 'proteinG', total: 0, target: 120, reached: false },
    ]);
  });

  it('counts the met band and anything above as reached, and says nothing about going past', () => {
    const reached = (total: number) => goalReadings({ proteinG: total }, { proteinG: 100 }, [])[0].reached;
    expect(reached(89)).toBe(false);
    expect(reached(90)).toBe(true);
    expect(reached(140)).toBe(true);
  });
});

describe('source ids', () => {
  it('round-trips the nutrient and the day, and refuses anything else', () => {
    const id = goalTargetSourceId('proteinG', '2026-10-13');
    expect(goalTargetKeyOf(id)).toBe('proteinG');
    expect(goalTargetDayOf(id)).toBe('2026-10-13');
    expect(goalTargetKeyOf('proteinG')).toBeNull();
    expect(goalTargetKeyOf('nope|2026-10-13')).toBeNull();
    expect(goalTargetKeyOf(null)).toBeNull();
  });
});

describe('title and notes', () => {
  it('names the goal, adding the total once something states it', () => {
    expect(goalTargetTitle({ key: 'proteinG', total: 0, target: 120, reached: false })).toBe('Aim for 120g protein');
    expect(goalTargetTitle({ key: 'proteinG', total: 80, target: 120, reached: false })).toBe('Aim for 120g protein · 80g so far');
  });

  it('says how far to go, then that it was reached', () => {
    expect(goalTargetNotes({ key: 'proteinG', total: 80, target: 120, reached: false })).toMatch(/^Today: 80 of 120g, 40g to go\./);
    expect(goalTargetNotes({ key: 'proteinG', total: 130, target: 120, reached: true })).toMatch(/^Today: 130 of 120g, reached\./);
  });
});
