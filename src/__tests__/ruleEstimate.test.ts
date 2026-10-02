import {
  parseRuleEstimate, ruleEstimateDraft, withRuleEstimate, parseGeneratorEstimates, withGeneratorEstimate,
  holdsKindEstimate,
} from '../utils/ruleEstimate';
import { parseWeatherRules } from '../utils/weatherTasks';

describe('parseRuleEstimate', () => {
  it('reads nothing back off a rule saved before estimates existed', () => {
    expect(parseRuleEstimate({})).toEqual({});
  });

  it('keeps a valid pair and drops junk', () => {
    expect(parseRuleEstimate({ estimatedMinutes: 2, effort: 1 })).toEqual({ estimatedMinutes: 2, effort: 1 });
    expect(parseRuleEstimate({ estimatedMinutes: -3, effort: 9 as never })).toEqual({});
    expect(parseRuleEstimate({ estimatedMinutes: null, effort: 2 })).toEqual({ estimatedMinutes: null, effort: 2 });
  });

  it('survives a stored rule round trip', () => {
    const [rule] = parseWeatherRules(JSON.stringify([
      { id: 'r', condition: 'rainy', title: 'Umbrella', estimatedMinutes: 1, effort: 1 },
    ]));
    expect(rule.estimatedMinutes).toBe(1);
    expect(rule.effort).toBe(1);
  });
});

describe('ruleEstimateDraft', () => {
  it('adds nothing for a rule with no estimate, so the new-task defaults still apply', () => {
    expect(ruleEstimateDraft({})).toEqual({});
    expect(ruleEstimateDraft({ estimatedMinutes: 1, effort: 1 })).toEqual({ estimatedMinutes: 1, effort: 1 });
  });
});

describe('withRuleEstimate', () => {
  const rules = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', estimatedMinutes: 5, effort: 1 as const }];

  it('replaces the named rule only', () => {
    expect(withRuleEstimate(rules, 'a', { estimatedMinutes: 1, effort: 1 }))
      .toEqual([{ id: 'a', title: 'A', estimatedMinutes: 1, effort: 1 }, rules[1]]);
  });

  it('clears the fields when the estimate is cleared', () => {
    expect(withRuleEstimate(rules, 'b', { estimatedMinutes: null, effort: 0 }))
      .toEqual([rules[0], { id: 'b', title: 'B' }]);
  });

  it('is null when nothing would change or the rule is gone', () => {
    expect(withRuleEstimate(rules, 'b', { estimatedMinutes: 5, effort: 1 })).toBeNull();
    expect(withRuleEstimate(rules, 'gone', { estimatedMinutes: 1, effort: 1 })).toBeNull();
  });
});

describe('parseGeneratorEstimates', () => {
  it('reads a stored map and drops what says nothing or is not one', () => {
    expect(parseGeneratorEstimates(null)).toEqual({});
    expect(parseGeneratorEstimates('not json')).toEqual({});
    expect(parseGeneratorEstimates('[1]')).toEqual({});
    expect(parseGeneratorEstimates(JSON.stringify({
      groceryUseUp: { estimatedMinutes: 2, effort: 1 },
      projectReview: { estimatedMinutes: null, effort: 0 },
      pantryCheck: 'junk',
    }))).toEqual({ groceryUseUp: { estimatedMinutes: 2, effort: 1 } });
  });
});

describe('withGeneratorEstimate', () => {
  it('sets, replaces and clears one kind', () => {
    const one = withGeneratorEstimate({}, 'groceryUseUp', { estimatedMinutes: 2, effort: 1 })!;
    expect(one).toEqual({ groceryUseUp: { estimatedMinutes: 2, effort: 1 } });
    expect(withGeneratorEstimate(one, 'groceryUseUp', { estimatedMinutes: 5, effort: 1 }))
      .toEqual({ groceryUseUp: { estimatedMinutes: 5, effort: 1 } });
    expect(withGeneratorEstimate(one, 'groceryUseUp', { estimatedMinutes: null, effort: 0 })).toEqual({});
  });

  it('is null when nothing would change', () => {
    const one = { groceryUseUp: { estimatedMinutes: 2, effort: 1 as const } };
    expect(withGeneratorEstimate(one, 'groceryUseUp', { estimatedMinutes: 2, effort: 1 })).toBeNull();
    expect(withGeneratorEstimate({}, 'groceryUseUp', { estimatedMinutes: null, effort: 0 })).toBeNull();
  });
});

describe('holdsKindEstimate', () => {
  it('is false for the rule kinds and meal tasks, true for the rest', () => {
    expect(holdsKindEstimate('weather')).toBe(false);
    expect(holdsKindEstimate('mealSlot')).toBe(false);
    expect(holdsKindEstimate('groceryUseUp')).toBe(true);
  });
});
