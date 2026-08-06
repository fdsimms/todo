import {
  bakedFields,
  blockedReason,
  canSaveType,
  isChipVisible,
  typeSummary,
  type QuickAddType,
  type TypeValues,
} from '../utils/quickAddTypes';
import type { ChainItem } from '../types';

const step = (title: string): ChainItem => ({ id: title, title, notes: '' });

const values = (over: Partial<TypeValues> = {}): TypeValues => ({
  timedMinutes: null,
  targetCount: null,
  chainItems: [],
  recurrenceType: 'none',
  effort: 0,
  estimatedMinutes: null,
  ...over,
});

describe('isChipVisible', () => {
  it('hides nothing for a plain task', () => {
    const chips = ['date', 'repeat', 'segment', 'priority', 'effort', 'tags', 'category', 'link'] as const;
    chips.forEach(c => expect(isChipVisible('task', c)).toBe(true));
  });

  it('hides effort on a timed task — the countdown is the estimate', () => {
    expect(isChipVisible('timed', 'effort')).toBe(false);
    expect(isChipVisible('timed', 'date')).toBe(true);
    expect(isChipVisible('timed', 'repeat')).toBe(true);
  });

  it('hides repeat on a daily target — the quota bakes one in', () => {
    expect(isChipVisible('target', 'repeat')).toBe(false);
    expect(isChipVisible('target', 'date')).toBe(true);
    expect(isChipVisible('target', 'effort')).toBe(true);
  });

  it('keeps repeat on a chain, where it means "start the list over"', () => {
    expect(isChipVisible('chain', 'repeat')).toBe(true);
  });
});

describe('bakedFields', () => {
  it('leaves a plain task carrying none of the type-specific fields', () => {
    const f = bakedFields('task', values({ timedMinutes: 15, targetCount: 3, chainItems: [step('a')] }));
    expect(f.timedMinutes).toBeNull();
    expect(f.targetCount).toBeNull();
    expect(f.chainEnabled).toBe(false);
    expect(f.chainItems).toEqual([]);
  });

  it('derives effort from the countdown on a timed task', () => {
    const f = bakedFields('timed', values({ timedMinutes: 30 }));
    expect(f.timedMinutes).toBe(30);
    expect(f.estimatedMinutes).toBe(30);
    expect(f.effort).toBeGreaterThan(0);
  });

  it('keeps the collected effort when a timed task has no duration yet', () => {
    const f = bakedFields('timed', values({ timedMinutes: null, effort: 4, estimatedMinutes: 90 }));
    expect(f.effort).toBe(4);
    expect(f.estimatedMinutes).toBe(90);
  });

  it('makes a quota repeat daily when nothing else set a repeat', () => {
    const f = bakedFields('target', values({ targetCount: 8 }));
    expect(f.targetCount).toBe(8);
    expect(f.recurrenceType).toBe('daily');
  });

  it('leaves a repeat the user chose deliberately alone', () => {
    const f = bakedFields('target', values({ targetCount: 8, recurrenceType: 'weekly' }));
    expect(f.recurrenceType).toBe('weekly');
  });

  it('turns the chain on and starts it at the first step', () => {
    const items = [step('a'), step('b')];
    const f = bakedFields('chain', values({ chainItems: items }));
    expect(f.chainEnabled).toBe(true);
    expect(f.chainItems).toEqual(items);
    expect(f.chainIndex).toBe(0);
  });

  it('never carries a duration into a task that switched away from Timed', () => {
    const carried = values({ timedMinutes: 25 });
    expect(bakedFields('target', carried).timedMinutes).toBeNull();
    expect(bakedFields('chain', carried).timedMinutes).toBeNull();
    expect(bakedFields('task', carried).timedMinutes).toBeNull();
  });
});

describe('canSaveType', () => {
  it('needs a step before a chain can be created', () => {
    expect(canSaveType('chain', values())).toBe(false);
    expect(canSaveType('chain', values({ chainItems: [step('a')] }))).toBe(true);
    expect(blockedReason('chain', values())).toBe('Add at least one step.');
    expect(blockedReason('chain', values({ chainItems: [step('a')] }))).toBeNull();
  });

  it('lets every other type save on a title alone', () => {
    (['task', 'timed', 'target'] as QuickAddType[]).forEach(t => {
      expect(canSaveType(t, values())).toBe(true);
      expect(blockedReason(t, values())).toBeNull();
    });
  });
});

describe('typeSummary', () => {
  it('says nothing for a plain task', () => {
    expect(typeSummary('task', values())).toBeNull();
  });

  it('names the countdown once one is set', () => {
    expect(typeSummary('timed', values({ timedMinutes: 15 }))).toContain('15m');
  });

  it('explains that a quota hides while you are on pace', () => {
    const s = typeSummary('target', values({ targetCount: 8 }))!;
    expect(s).toContain('8×');
    expect(s).toContain('fall behind');
  });

  it('counts the steps, singular and plural', () => {
    expect(typeSummary('chain', values({ chainItems: [step('a')] }))).toContain('1 step,');
    expect(typeSummary('chain', values({ chainItems: [step('a'), step('b')] }))).toContain('2 steps,');
  });

  it('still explains a mode that has no value yet', () => {
    (['timed', 'target', 'chain'] as QuickAddType[]).forEach(t => {
      expect(typeSummary(t, values())).toBeTruthy();
    });
  });
});
