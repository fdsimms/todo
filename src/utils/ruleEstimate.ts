import type { Effort, RuleTaskEstimate } from '../types';

/**
 * The estimate a "when X, add this task" rule hands the task it writes.
 *
 * Weather, Screen Time, Health and calendar-event rules each write a fresh
 * one-off row every time they fire, so an estimate set or timed on that row
 * used to be lost with it. Editing the row's estimate writes it back onto the
 * rule (see `updateTask`), and the rule's draft carries it into every task it
 * writes after that. There is no control for it on the rule sheets: the task
 * is where somebody notices how long it took, so the task is where it is set.
 *
 * `rememberedEstimate` (`effort.ts`) covers the same ground by title for every
 * generator, and this exists beside it because a weather task's title carries
 * the day's forecast ("Put on sunscreen (sunny, 24°)") and so never matches
 * itself, and because a rule keeps its estimate across a rename.
 */

function isEffort(v: unknown): v is Effort {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
}

/**
 * The two fields off a stored rule, for its parser to spread in. Empty when
 * the rule carries neither, so a rule saved before this existed reads back
 * exactly the shape it had.
 */
export function parseRuleEstimate(raw: Partial<RuleTaskEstimate>): RuleTaskEstimate {
  const minutes = typeof raw.estimatedMinutes === 'number' && Number.isFinite(raw.estimatedMinutes)
    && raw.estimatedMinutes > 0
    ? Math.round(raw.estimatedMinutes)
    : null;
  const effort = isEffort(raw.effort) ? raw.effort : 0;
  if (minutes === null && effort === 0) return {};
  return { estimatedMinutes: minutes, effort };
}

/** What a rule's task draft spreads in: the rule's estimate, or nothing. */
export function ruleEstimateDraft(rule: RuleTaskEstimate): { estimatedMinutes?: number | null; effort?: Effort } {
  if (rule.estimatedMinutes == null && !rule.effort) return {};
  return { estimatedMinutes: rule.estimatedMinutes ?? null, effort: rule.effort ?? 0 };
}

/**
 * The rule list with one rule's estimate replaced, or null when nothing would
 * change (no such rule, or it already says this), so a caller can skip the
 * settings write.
 */
export function withRuleEstimate<R extends RuleTaskEstimate & { id: string }>(
  rules: readonly R[],
  ruleId: string,
  estimate: { estimatedMinutes: number | null; effort: Effort },
): R[] | null {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return null;
  if ((rule.estimatedMinutes ?? null) === estimate.estimatedMinutes && (rule.effort ?? 0) === estimate.effort) {
    return null;
  }
  const next = parseRuleEstimate(estimate);
  return rules.map(r => {
    if (r.id !== ruleId) return r;
    const { estimatedMinutes: _m, effort: _e, ...rest } = r;
    return { ...rest, ...next } as R;
  });
}
