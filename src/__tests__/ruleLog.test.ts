import type { HealthRule, Task } from '../types';
import {
  describeRuleLog,
  parseRuleLog,
  renamedRuleLogs,
  ruleLogDraft,
  ruleLogOfTask,
  taskLogChanged,
  withRuleLog,
} from '../utils/ruleLog';
import { parseHealthRules, serializeHealthRules } from '../utils/healthRules';
import { parseWeatherRules } from '../utils/weatherTasks';
import { parseScreenTimeRules } from '../utils/screenTimeRules';
import { parseEventRules } from '../utils/eventTasks';

function rule(over: Partial<HealthRule> = {}): HealthRule {
  return {
    id: 'r1', metric: 'sodiumMg', threshold: 6000, title: 'Take sodium chloride',
    enabled: true, lastFiredDayKey: null, ...over,
  };
}

const taskWith = (over: Partial<Task>): Task => over as Task;

describe('parseRuleLog', () => {
  it('is empty for a rule that logs nothing', () => {
    expect(parseRuleLog({})).toEqual({});
    expect(parseRuleLog({ medicationName: null, logMealSlot: null })).toEqual({});
    expect(parseRuleLog({ medicationName: '   ' })).toEqual({});
  });

  it('keeps a dose with its amount and unit', () => {
    expect(parseRuleLog({ medicationName: ' Sertraline ', medicationAmount: 25, medicationUnit: 'mg' }))
      .toEqual({ medicationName: 'Sertraline', medicationAmount: 25, medicationUnit: 'mg' });
  });

  it('drops an amount with no unit, and the reverse, so the usual amount applies', () => {
    expect(parseRuleLog({ medicationName: 'X', medicationAmount: 25, medicationUnit: null })).toEqual({ medicationName: 'X' });
    expect(parseRuleLog({ medicationName: 'X', medicationAmount: null, medicationUnit: 'mg' })).toEqual({ medicationName: 'X' });
    expect(parseRuleLog({ medicationName: 'X', medicationAmount: 0, medicationUnit: 'mg' })).toEqual({ medicationName: 'X' });
  });

  it('never keeps an amount for a medication it does not name', () => {
    expect(parseRuleLog({ medicationAmount: 25, medicationUnit: 'mg' })).toEqual({});
  });

  it('keeps a saved meal and the by-time switch only with a meal slot', () => {
    expect(parseRuleLog({ logMealSlot: 'lunch', logSavedMealId: 'm1', logMealSlotByTime: true }))
      .toEqual({ logMealSlot: 'lunch', logSavedMealId: 'm1', logMealSlotByTime: true });
    expect(parseRuleLog({ logSavedMealId: 'm1', logMealSlotByTime: true })).toEqual({});
  });

  it('ignores an unknown meal slot', () => {
    expect(parseRuleLog({ logMealSlot: 'brunch' as never })).toEqual({});
    expect(parseRuleLog({ logMealSlot: 'other' })).toEqual({ logMealSlot: 'other' });
  });

  it('keeps a dose and a food entry together, as a task can', () => {
    expect(parseRuleLog({ medicationName: 'X', logMealSlot: 'snack' })).toEqual({ medicationName: 'X', logMealSlot: 'snack' });
  });
});

describe('ruleLogDraft', () => {
  it('is empty for a rule that logs nothing', () => {
    expect(ruleLogDraft(rule())).toEqual({});
  });

  it('states a null amount outright for a dose with no amount of its own', () => {
    expect(ruleLogDraft(rule({ medicationName: 'Vitamin D' })))
      .toEqual({ medicationName: 'Vitamin D', medicationAmount: null, medicationUnit: null });
  });

  it('carries a saved meal under its slot', () => {
    expect(ruleLogDraft(rule({ logMealSlot: 'snack', logSavedMealId: 'm1' })))
      .toEqual({ logMealSlot: 'snack', logSavedMealId: 'm1' });
  });
});

describe('writing back from a task', () => {
  it('reads the rule fields off a task', () => {
    expect(ruleLogOfTask(taskWith({
      medicationName: 'Sertraline', medicationAmount: 25, medicationUnit: 'mg',
      logMealSlot: null, logSavedMealId: null, logMealSlotByTime: false,
    }))).toEqual({ medicationName: 'Sertraline', medicationAmount: 25, medicationUnit: 'mg' });
  });

  it('sees a change in what a task logs and ignores one that is not', () => {
    const before = taskWith({ medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null });
    expect(taskLogChanged(before, { ...before, medicationName: 'X' } as Task)).toBe(true);
    expect(taskLogChanged(before, { ...before, medicationName: '' } as Task)).toBe(false);
    expect(taskLogChanged(before, { ...before, medicationAmount: 5 } as Task)).toBe(false);
  });

  it('replaces a rule\'s log and leaves the others alone', () => {
    const rules = [rule({ id: 'a', medicationName: 'Old', medicationAmount: 5, medicationUnit: 'mg' }), rule({ id: 'b' })];
    const next = withRuleLog(rules, 'a', { logMealSlot: 'dinner', logSavedMealId: 'm1' })!;
    expect(next[0]).not.toHaveProperty('medicationName');
    expect(next[0]).not.toHaveProperty('medicationAmount');
    expect(next[0]).toMatchObject({ logMealSlot: 'dinner', logSavedMealId: 'm1', title: 'Take sodium chloride' });
    expect(next[1]).toBe(rules[1]);
  });

  it('clears a rule\'s log when the task logs nothing', () => {
    const next = withRuleLog([rule({ medicationName: 'X' })], 'r1', {})!;
    expect(next[0]).not.toHaveProperty('medicationName');
  });

  it('returns null when nothing would change, so no settings write happens', () => {
    expect(withRuleLog([rule({ medicationName: 'X' })], 'r1', { medicationName: 'X' })).toBeNull();
    expect(withRuleLog([rule()], 'r1', {})).toBeNull();
    expect(withRuleLog([rule()], 'gone', { medicationName: 'X' })).toBeNull();
  });
});

describe('a stored rule', () => {
  it('reads back through every rule kind\'s parser', () => {
    const log = { medicationName: 'Metamucil', logMealSlot: 'breakfast', logSavedMealId: 'm1' };
    const health = parseHealthRules(serializeHealthRules([rule(log as Partial<HealthRule>)]));
    expect(health[0]).toMatchObject(log);

    const weather = parseWeatherRules(JSON.stringify([{ id: 'w', condition: 'sunny', title: 'Sunscreen', enabled: true, ...log }]));
    expect(weather[0]).toMatchObject(log);
    const screen = parseScreenTimeRules(JSON.stringify([{ id: 's', thresholdMinutes: 30, title: 'Walk', enabled: true, ...log }]));
    expect(screen[0]).toMatchObject(log);
    const event = parseEventRules(JSON.stringify([{ id: 'e', matches: ['flight'], title: 'Pack', enabled: true, leadDays: 1, ...log }]));
    expect(event[0]).toMatchObject(log);
  });

  it('reads a rule saved before this existed unchanged', () => {
    const parsed = parseHealthRules(serializeHealthRules([rule()]));
    expect(parsed[0]).not.toHaveProperty('medicationName');
    expect(parsed[0]).not.toHaveProperty('logMealSlot');
  });
});

describe('renamedRuleLogs', () => {
  it('follows a renamed medication, matching on its key', () => {
    const rules = [rule({ id: 'a', medicationName: 'Ibuprofen 200' }), rule({ id: 'b', medicationName: 'Other' })];
    const next = renamedRuleLogs(rules, 'ibuprofen 200', 'Ibuprofen');
    expect(next[0].medicationName).toBe('Ibuprofen');
    expect(next[1]).toBe(rules[1]);
  });

  it('returns the same array when no rule names it, so no write happens', () => {
    const rules = [rule()];
    expect(renamedRuleLogs(rules, 'ibuprofen', 'x')).toBe(rules);
  });
});

describe('describeRuleLog', () => {
  const none = () => null;
  it('says nothing for a rule that logs nothing', () => {
    expect(describeRuleLog(rule(), none)).toBe('');
  });
  it('names a dose with and without an amount', () => {
    expect(describeRuleLog(rule({ medicationName: 'Sertraline', medicationAmount: 25, medicationUnit: 'mg' }), none))
      .toBe('Logs 25 mg Sertraline');
    expect(describeRuleLog(rule({ medicationName: 'Vitamin D' }), none)).toBe('Logs a dose of Vitamin D');
  });
  it('names a saved meal, or says it asks which', () => {
    expect(describeRuleLog(rule({ logMealSlot: 'snack', logSavedMealId: 'm1' }), () => 'Metamucil')).toBe('Logs Metamucil');
    expect(describeRuleLog(rule({ logMealSlot: 'snack' }), none)).toBe('Logs food (asks which)');
  });
});
