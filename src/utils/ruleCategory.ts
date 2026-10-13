import type { RuleTaskCategory } from '../types';

/**
 * The category a rule files its task under, kept on the rule.
 *
 * Each rule kind (weather, Screen Time, Health, calendar events) has one
 * "File them under" setting, which is what every rule of that kind used to
 * share. A rule can now name its own, so "flight" can file under Travel while
 * "dentist" files under Health. A rule that names none keeps using the
 * setting, which is why a rule saved before this existed reads back unchanged.
 */

/** The field off a stored rule, for its parser to spread in. Empty when unset. */
export function parseRuleCategory(raw: { category?: unknown }): RuleTaskCategory {
  if (typeof raw.category !== 'string') return {};
  const category = raw.category.trim();
  return category ? { category } : {};
}

/**
 * Where a rule's task goes: its own category, else the kind's setting. Null
 * when neither says, which every caller treats as "write nothing", the same
 * thing the kind-level setting being empty has always meant.
 */
export function ruleCategoryFor(rule: RuleTaskCategory, fallback: string | null): string | null {
  return rule.category || fallback || null;
}

/**
 * The rules with a renamed category followed, or the same array by identity
 * when none names it, so the caller can skip the settings write.
 */
export function renameInRuleCategories<R extends RuleTaskCategory>(rules: R[], from: string, to: string): R[] {
  if (!rules.some(r => r.category === from)) return rules;
  return rules.map(r => (r.category === from ? { ...r, category: to } : r));
}

/**
 * The rule list with one rule filed under `category`, or null when nothing
 * would change (no such rule, or it already resolves there), so a caller can
 * skip the settings write. `fallback` is the kind's setting: a rule naming no
 * category of its own already files there, so it is left alone rather than
 * given a redundant copy of the setting.
 */
export function withRuleCategory<R extends RuleTaskCategory & { id: string }>(
  rules: readonly R[],
  ruleId: string,
  category: string,
  fallback: string | null,
): R[] | null {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule || ruleCategoryFor(rule, fallback) === category) return null;
  return rules.map(r => (r.id === ruleId ? { ...r, category } : r));
}
