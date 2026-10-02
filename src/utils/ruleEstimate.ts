import type { Effort, GeneratedKind, RuleTaskEstimate } from '../types';

/**
 * The estimate a generator hands the task it writes, kept on the generator.
 *
 * Every generated task (and every follow-up) is a fresh one-off row, so an
 * estimate set or timed on one used to be lost with it. Editing the row's
 * estimate now writes it back onto whatever wrote the row
 * (`writeEstimateToSource` in `useTaskStore`), and the next row reads it from
 * there. The title plays no part, so a title carrying a date or a forecast
 * changes nothing.
 *
 * Three homes, by what the generator is:
 *
 * - **A rule somebody wrote** (weather, Screen Time, Health, calendar events):
 *   on the rule, since each rule is its own generator.
 * - **A follow-up rule**: in its `followUpTaskDraft`, which already had the
 *   two fields.
 * - **Every other generator**: one entry per kind in the `generatorEstimates`
 *   setting. "Use up milk" and "Use up rice" share it, because it's the same
 *   job.
 *
 * There is no control for any of these on a settings screen: the task is where
 * somebody finds out how long it takes, so the task is where it is set.
 */

/** What every home stores: the task-level pair, verbatim. */
export interface GeneratorEstimate {
  estimatedMinutes: number | null;
  effort: Effort;
}

/** One estimate per generator kind that has no rule of its own to hold one. */
export type GeneratorEstimates = Partial<Record<GeneratedKind, GeneratorEstimate>>;

/**
 * Kinds that keep no generator-level estimate. The four rule kinds hold theirs
 * on each rule. A meal task already arrives estimated from its recipe and the
 * per-step `mealSlotStepEstimates`, and one figure across every meal of the
 * week would be wrong for all but one recipe.
 */
const NO_KIND_ESTIMATE: ReadonlySet<GeneratedKind> = new Set<GeneratedKind>([
  'weather', 'screenTime', 'health', 'eventTask', 'mealSlot', 'mealCook',
]);

export function holdsKindEstimate(kind: GeneratedKind): boolean {
  return !NO_KIND_ESTIMATE.has(kind);
}

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
  estimate: GeneratorEstimate,
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

/**
 * `generatorEstimates` off its setting, tolerantly: unreadable reads as empty,
 * and an entry that says nothing is dropped.
 */
export function parseGeneratorEstimates(raw: string | null | undefined): GeneratorEstimates {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: GeneratorEstimates = {};
  for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const estimate = parseRuleEstimate(value as Partial<RuleTaskEstimate>);
    if (estimate.estimatedMinutes === undefined) continue;
    out[kind as GeneratedKind] = { estimatedMinutes: estimate.estimatedMinutes, effort: estimate.effort ?? 0 };
  }
  return out;
}

/**
 * The map with one kind's estimate replaced (or removed, when cleared), or
 * null when nothing would change.
 */
export function withGeneratorEstimate(
  estimates: GeneratorEstimates,
  kind: GeneratedKind,
  estimate: GeneratorEstimate,
): GeneratorEstimates | null {
  const stored = estimates[kind];
  const next = parseRuleEstimate(estimate);
  if (next.estimatedMinutes === undefined) {
    if (!stored) return null;
    const { [kind]: _gone, ...rest } = estimates;
    return rest;
  }
  if (stored && stored.estimatedMinutes === next.estimatedMinutes && stored.effort === next.effort) return null;
  return { ...estimates, [kind]: { estimatedMinutes: next.estimatedMinutes, effort: next.effort ?? 0 } };
}
