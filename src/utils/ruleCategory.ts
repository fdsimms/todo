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
