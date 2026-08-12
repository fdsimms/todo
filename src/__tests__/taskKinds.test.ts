import {
  bakedFields,
  blockedReason,
  canSaveType,
  isChipVisible,
  taskKindOf,
  typeSummary,
  TASK_KIND_META,
  QUICK_ADD_CHIP_LABELS,
  QUICK_ADD_CHIP_LIMIT,
  type QuickAddChip,
  type TaskKind,
  type TypeValues,
} from '../utils/taskKinds';
import { resolvePillOverflow } from '../utils/pillOverflow';
import type { ChainItem } from '../types';

const step = (title: string): ChainItem => ({ id: title, title, estimatedMinutes: null });

const values = (over: Partial<TypeValues> = {}): TypeValues => ({
  timedMinutes: null,
  targetCount: null,
  targetUnit: null,
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

  it('keeps a normalized unit on a quota', () => {
    const f = bakedFields('target', values({ targetCount: 8, targetUnit: '  8oz  glasses ' }));
    expect(f.targetUnit).toBe('8oz glasses');
  });

  it('never carries a unit into a task that switched away from Target', () => {
    const carried = values({ targetCount: 8, targetUnit: 'glasses' });
    expect(bakedFields('task', carried).targetUnit).toBeNull();
    expect(bakedFields('timed', carried).targetUnit).toBeNull();
    expect(bakedFields('chain', carried).targetUnit).toBeNull();
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
    (['task', 'timed', 'target'] as TaskKind[]).forEach(t => {
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

  it('names the unit in place of the × once one is typed', () => {
    const s = typeSummary('target', values({ targetCount: 8, targetUnit: 'glasses' }))!;
    expect(s).toContain('8 glasses a day');
    expect(s).not.toContain('8×');
  });

  it('counts the steps, singular and plural', () => {
    expect(typeSummary('chain', values({ chainItems: [step('a')] }))).toContain('1 step,');
    expect(typeSummary('chain', values({ chainItems: [step('a'), step('b')] }))).toContain('2 steps,');
  });

  it('still explains a mode that has no value yet', () => {
    (['timed', 'target', 'chain'] as TaskKind[]).forEach(t => {
      expect(typeSummary(t, values())).toBeTruthy();
    });
  });
});

describe('QUICK_ADD_CHIP_LABELS', () => {
  const ALL_CHIPS: QuickAddChip[] = [
    'date', 'repeat', 'segment', 'priority', 'effort', 'tags', 'category', 'link', 'phone', 'email',
  ];

  // The bug this table exists to prevent: a chip that reads as a bare glyph
  // until it has a value, i.e. names itself only once you no longer need it to.
  it('names every chip', () => {
    ALL_CHIPS.forEach(c => expect(QUICK_ADD_CHIP_LABELS[c]).toBeTruthy());
    expect(Object.keys(QUICK_ADD_CHIP_LABELS).sort()).toEqual([...ALL_CHIPS].sort());
  });

  it('folds the toolbar down to the limit', () => {
    const pills = ALL_CHIPS.map(key => ({ key, label: QUICK_ADD_CHIP_LABELS[key] }));
    const { visible, hiddenCount } = resolvePillOverflow(pills, { limit: QUICK_ADD_CHIP_LIMIT });
    expect(visible).toHaveLength(QUICK_ADD_CHIP_LIMIT);
    expect(hiddenCount).toBe(ALL_CHIPS.length - QUICK_ADD_CHIP_LIMIT);
    expect(visible.map(p => p.key)).toContain('date');
  });

  // A title like "pay rent tmrw #home" fills chips in as you type; the one it
  // just answered must not be the one folded away.
  it('never hides a chip that already has a value', () => {
    const pills = ALL_CHIPS.map(key => ({
      key, label: QUICK_ADD_CHIP_LABELS[key], selected: key === 'email',
    }));
    const { visible } = resolvePillOverflow(pills, { limit: QUICK_ADD_CHIP_LIMIT });
    expect(visible.map(p => p.key)).toContain('email');
  });

  it('shows everything once the user asks for it', () => {
    const pills = ALL_CHIPS.map(key => ({ key, label: QUICK_ADD_CHIP_LABELS[key] }));
    const { visible, hiddenCount } = resolvePillOverflow(pills, { limit: QUICK_ADD_CHIP_LIMIT, showAll: true });
    expect(visible).toHaveLength(ALL_CHIPS.length);
    expect(hiddenCount).toBe(0);
  });
});

describe('taskKindOf', () => {
  const shape = (over: Partial<Parameters<typeof taskKindOf>[0]> = {}) => ({
    chainEnabled: false, targetCount: null, timedMinutes: null, ...over,
  });

  it('reads a plain task as standard', () => {
    expect(taskKindOf(shape())).toBe('task');
  });

  it('reads each shape off its own field', () => {
    expect(taskKindOf(shape({ timedMinutes: 15 }))).toBe('timed');
    expect(taskKindOf(shape({ targetCount: 3 }))).toBe('target');
    expect(taskKindOf(shape({ chainEnabled: true }))).toBe('chain');
  });

  // The >= 2 rule lives at save time, not here: a chain being built up to its
  // second step must not stop reading as a chain mid-edit.
  it('stays a chain while it is still one step long', () => {
    expect(taskKindOf(shape({ chainEnabled: true }))).toBe('chain');
  });

  // The editor used to let both be set; those rows are out there.
  it('picks one kind for a task that was saved as two', () => {
    expect(taskKindOf(shape({ chainEnabled: true, targetCount: 3, timedMinutes: 15 }))).toBe('chain');
    expect(taskKindOf(shape({ targetCount: 3, timedMinutes: 15 }))).toBe('target');
  });

  it('round-trips with bakedFields for every kind', () => {
    TASK_KIND_META.forEach(({ key }) => {
      const baked = bakedFields(key, values({
        timedMinutes: 15, targetCount: 3, chainItems: [step('a'), step('b')],
      }));
      expect(taskKindOf(baked)).toBe(key);
    });
  });

  it('names every kind', () => {
    expect(TASK_KIND_META.map(m => m.key)).toEqual(['task', 'timed', 'target', 'chain']);
    TASK_KIND_META.forEach(m => {
      expect(m.label).toBeTruthy();
      expect(m.hint).toBeTruthy();
    });
  });
});
