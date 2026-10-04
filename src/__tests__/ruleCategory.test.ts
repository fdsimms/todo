import { parseRuleCategory, renameInRuleCategories, ruleCategoryFor } from '../utils/ruleCategory';
import { parseEventRules } from '../utils/eventTasks';
import { parseWeatherRules } from '../utils/weatherTasks';

describe('parseRuleCategory', () => {
  it('reads nothing for a rule saved before categories existed', () => {
    expect(parseRuleCategory({})).toEqual({});
    expect(parseRuleCategory({ category: 7 })).toEqual({});
    expect(parseRuleCategory({ category: '   ' })).toEqual({});
  });
  it('keeps a trimmed name', () => {
    expect(parseRuleCategory({ category: ' Travel ' })).toEqual({ category: 'Travel' });
  });
});

describe('ruleCategoryFor', () => {
  it('prefers the rule, then the kind setting, then null', () => {
    expect(ruleCategoryFor({ category: 'Travel' }, 'Calendar Events')).toBe('Travel');
    expect(ruleCategoryFor({}, 'Calendar Events')).toBe('Calendar Events');
    expect(ruleCategoryFor({}, null)).toBeNull();
  });
});

describe('renameInRuleCategories', () => {
  it('follows a rename and keeps identity when nothing names it', () => {
    const rules = [{ id: 'a', category: 'Travel' }, { id: 'b' }];
    expect(renameInRuleCategories(rules, 'Travel', 'Trips')).toEqual([{ id: 'a', category: 'Trips' }, { id: 'b' }]);
    expect(renameInRuleCategories(rules, 'Work', 'Job')).toBe(rules);
  });
});

describe('rule parsers keep the category', () => {
  it('event rules', () => {
    const raw = JSON.stringify([{ id: 'r', matches: ['flight'], title: 'Pack', leadDays: 1, enabled: true, category: 'Travel' }]);
    expect(parseEventRules(raw)[0].category).toBe('Travel');
  });
  it('weather rules', () => {
    const raw = JSON.stringify([{ id: 'r', condition: 'sunny', title: 'Sunscreen', enabled: true, category: 'Outdoors' }]);
    expect(parseWeatherRules(raw)[0].category).toBe('Outdoors');
  });
});
