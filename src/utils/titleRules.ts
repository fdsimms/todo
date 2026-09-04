import type { Effort, Priority, Task, TitleRule, TitleRuleMatch } from '../types';
import { EFFORT_LABELS, PRIORITY_LABELS } from '../types';
import { generateId } from './id';

/**
 * Title rules — "anything starting with 'expense' goes to Work".
 *
 * The other quick-add parsers in `parseTaskInput.ts` read *English*: they
 * guess at what "on tuesday" or "for 15 minutes" was meant to say, and
 * because a guess can be wrong, nothing they find is applied until the user
 * taps the tooltip. This module reads a vocabulary the **user wrote down**,
 * which is a different kind of claim entirely — the same distinction
 * `ItemSubLink.standing` turns on, and the same conclusion: an authored rule
 * has the mandate to apply itself. It is still never silent (QuickAddModal
 * captions what a rule did, with a way to take it back).
 *
 * See `TitleRule` in types for the storage and scope decisions. What lives
 * here is the matching, the precedence and the wording.
 *
 * **No regex mode, ever.** It's the obvious "power user" ask and it's the
 * wrong shape for every reason the template-question grammar is one operator
 * wide: a pattern language is unreadable in a settings row, unexplainable in
 * a caption ("why did this go to Work?"), and hands a user-typed string
 * straight to the regex engine on every keystroke of every quick add. Whole
 * words plus a keyword list covers the cases people actually describe.
 *
 * Pure and store-free like `followUpTask.ts` beside it — the rules are passed
 * in, and category/project names arrive already resolved.
 */

/**
 * A rule can't fire on a word this short — a one- or two-letter marker
 * matches too much of ordinary English to be a filing decision, and the
 * whole-word test doesn't save it ("do", "a", "re"). Same call
 * `MIN_CATEGORY_PREFIX_LENGTH` makes in `parseTaskInput`.
 */
export const MIN_KEYWORD_LENGTH = 3;

/** Keeps a keyword chip readable on one line, and a rule from being a sentence. */
export const KEYWORD_MAX_LENGTH = 40;

export const TITLE_RULE_MATCHES: TitleRuleMatch[] = ['startsWith', 'contains'];

/** One rule's hit on a title, in the original string's coordinates. */
export interface TitleRuleMatchResult {
  /** The keyword as stored, not as typed — what a caption names. */
  keyword: string;
  start: number;
  end: number;
}

/**
 * What every matching rule adds up to. `null`/`0`/`[]` carry the same meaning
 * they do on a rule: no rule spoke for that field, so whatever would have
 * happened without any of this still happens.
 */
export interface TitleRuleFill {
  category: string | null;
  projectId: string | null;
  tags: string[];
  priority: Priority;
  effort: Effort;
  linkUrl: string | null;
  /** The title with any stripped keywords taken out — identical to the input when nothing strips. */
  cleanTitle: string;
  /** Every rule that fired, most specific first (see resolveTitleRules). */
  matched: { rule: TitleRule; match: TitleRuleMatchResult }[];
}

/** A rule the sheet opens on: matches nothing, says nothing, already on. */
export function emptyTitleRule(): TitleRule {
  return {
    id: generateId(),
    keywords: [],
    match: 'startsWith',
    category: null,
    projectId: null,
    tags: [],
    priority: 0,
    effort: 0,
    linkUrl: null,
    stripKeyword: false,
    enabled: true,
  };
}

/** Whether a rule names anything to file a task as. */
export function titleRuleSaysNothing(rule: TitleRule): boolean {
  return rule.category === null
    && rule.projectId === null
    && rule.tags.length === 0
    && rule.priority === 0
    && rule.effort === 0
    && rule.linkUrl === null;
}

/**
 * Whether a rule can ever do anything. Both halves are required — a rule with
 * no keyword has nothing to fire on, and one that says nothing has nothing to
 * do when it fires — which is why the editor won't save either, rather than
 * storing a row that reads as active in the list and never applies.
 */
export function titleRuleIsUseless(rule: TitleRule): boolean {
  return normalizeKeywords(rule.keywords).length === 0 || titleRuleSaysNothing(rule);
}

/**
 * Trim, lowercase and collapse inner whitespace; drop anything too short to
 * be a marker and anything repeated. Applied on save *and* on read, so a
 * keyword typed as "  Expense " can't fail to match the title it was written
 * for.
 */
export function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    if (typeof raw !== 'string') continue;
    const k = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, KEYWORD_MAX_LENGTH);
    if (k.length < MIN_KEYWORD_LENGTH) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Where `keyword` sits in `title`, or null.
 *
 * Word-bounded on both sides, so "expense" fires on "Expense: lunch" and on
 * "file the expense" but never inside "expensive" — the same whole-word rule
 * `splitAlternativeNames` uses to keep "oregano" safe from "or". Note that
 * the boundary is `\w`, so a keyword also won't fire on the plural: the
 * remedy is a second keyword on the same rule, never a stem-and-guess.
 *
 * `startsWith` anchors at the first word of the title rather than at index 0,
 * so leading whitespace or a stray bullet doesn't defeat the rule someone
 * wrote for a title they type every day.
 */
export function matchKeyword(title: string, keyword: string, mode: TitleRuleMatch): TitleRuleMatchResult | null {
  if (!title || keyword.length < MIN_KEYWORD_LENGTH) return null;
  const pattern = new RegExp(`(?<!\\w)${escapeRegExp(keyword)}(?!\\w)`, 'i');
  const m = pattern.exec(title);
  if (!m || m.index === undefined) return null;
  if (mode === 'startsWith' && title.slice(0, m.index).trim() !== '') return null;
  return { keyword, start: m.index, end: m.index + m[0].length };
}

/**
 * The rule's own hit on a title: the *longest* of its keywords that matches,
 * so a rule listing both "expense" and "expense report" reports the phrase it
 * really recognised rather than whichever happened to be typed first.
 */
export function matchTitleRule(title: string, rule: TitleRule): TitleRuleMatchResult | null {
  if (!rule.enabled) return null;
  let best: TitleRuleMatchResult | null = null;
  for (const keyword of normalizeKeywords(rule.keywords)) {
    const m = matchKeyword(title, keyword, rule.match);
    if (m && (!best || m.keyword.length > best.keyword.length)) best = m;
  }
  return best;
}

/**
 * Every enabled rule that fires on `title`, resolved into one fill.
 *
 * **The longest matched keyword wins a contested field**, ties going to list
 * order. Specificity rather than position is what settles it because the list
 * has no hand-ordering to appeal to — these are added as they're thought of,
 * not ranked — and "the more specific rule wins" is the only tiebreak that
 * can be explained in a sentence to someone wondering why their task went
 * where it did. Tags are the exception and accumulate across every match, the
 * same split `parseCategoryAndTagsInput` makes between the one category slot
 * and the tags that pile up beside it.
 *
 * Returns null when nothing fires, so a caller renders nothing rather than an
 * empty fill.
 */
export function resolveTitleRules(title: string, rules: TitleRule[]): TitleRuleFill | null {
  const matched: { rule: TitleRule; match: TitleRuleMatchResult }[] = [];
  for (const rule of rules) {
    const match = matchTitleRule(title, rule);
    if (match) matched.push({ rule, match });
  }
  if (matched.length === 0) return null;

  // Stable within equal keyword length: Array.prototype.sort is specified
  // stable, so equally-specific rules keep the order they were written in.
  const ranked = [...matched].sort((a, b) => b.match.keyword.length - a.match.keyword.length);

  const fill: TitleRuleFill = {
    category: null,
    projectId: null,
    tags: [],
    priority: 0,
    effort: 0,
    linkUrl: null,
    cleanTitle: title,
    matched: ranked,
  };
  for (const { rule } of ranked) {
    if (fill.category === null) fill.category = rule.category;
    if (fill.projectId === null) fill.projectId = rule.projectId;
    if (fill.priority === 0) fill.priority = rule.priority;
    if (fill.effort === 0) fill.effort = rule.effort;
    if (fill.linkUrl === null) fill.linkUrl = rule.linkUrl;
    for (const tag of rule.tags) if (!fill.tags.includes(tag)) fill.tags.push(tag);
  }
  fill.cleanTitle = stripMatchedKeywords(title, ranked);
  return fill;
}

/**
 * Takes every stripping rule's matched keyword back out of the title, cutting
 * from the end so the earlier spans keep their indices, and eats the
 * separator a marker word is usually followed by ("Expense: lunch" → "lunch",
 * not ": lunch").
 *
 * **A strip that would empty the title is refused wholesale**, so a bare
 * "expense" typed on its own stays a task called "expense" — the same call
 * every parser in `parseTaskInput` makes about a `cleanTitle` that came back
 * empty. It's refused for the whole title rather than per rule, because a
 * half-applied strip is a title nobody asked for either.
 */
function stripMatchedKeywords(
  title: string,
  matched: { rule: TitleRule; match: TitleRuleMatchResult }[],
): string {
  const spans = matched
    .filter(m => m.rule.stripKeyword)
    .map(m => m.match)
    .sort((a, b) => a.start - b.start);
  if (spans.length === 0) return title;

  let out = title;
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end } = spans[i];
    // Overlapping spans (two rules recognising the same words) — the later
    // cut already took these characters out.
    if (end > out.length) continue;
    const after = out.slice(end).replace(/^[\s:;,.\-–—]+/, ' ');
    out = out.slice(0, start) + after;
  }
  out = out.replace(/\s+/g, ' ').replace(/^[\s:;,.\-–—]+/, '').trim();
  return out === '' ? title : out;
}

/**
 * "Work · Expenses · High · 2 tags" — what a rule does, for its row in the
 * list and for the caption quick add shows after applying it.
 *
 * Names up to three things and then falls back to a count, the call
 * `describeFollowUpTaskDraft` makes and for the same reason: these render
 * `numberOfLines={1}` and a fourth truncates mid-word at 390pt. Category,
 * project and link arrive already resolved to display names — this module
 * holds no store, and a category's emoji (or a link's known-app name) lives
 * on the row that owns that lookup rather than on what a rule stores.
 */
export function describeTitleRuleTargets(
  target: Pick<TitleRule, 'category' | 'projectId' | 'tags' | 'priority' | 'effort' | 'linkUrl'>,
  categoryName: string | null,
  projectName: string | null,
  linkLabel: string | null,
): string {
  const parts: string[] = [];
  if (target.category && categoryName) parts.push(categoryName);
  if (target.projectId && projectName) parts.push(projectName);
  if (target.priority > 0) parts.push(PRIORITY_LABELS[target.priority]);
  if (target.effort > 0) parts.push(EFFORT_LABELS[target.effort]);
  if (target.linkUrl && linkLabel) parts.push(linkLabel);
  if (target.tags.length > 0) {
    parts.push(target.tags.length === 1 ? `#${target.tags[0]}` : `${target.tags.length} tags`);
  }
  if (parts.length === 0) return '';
  if (parts.length <= TARGET_NAME_LIMIT) return parts.join(' · ');
  return `${parts.length} details`;
}

const TARGET_NAME_LIMIT = 3;

/** "Starts with “expense”" / "Contains “invoice” or 2 more" — the rule's left-hand side. */
export function describeTitleRuleTrigger(rule: TitleRule): string {
  const keywords = normalizeKeywords(rule.keywords);
  const verb = rule.match === 'startsWith' ? 'Starts with' : 'Contains';
  if (keywords.length === 0) return `${verb} …`;
  if (keywords.length === 1) return `${verb} “${keywords[0]}”`;
  return `${verb} “${keywords[0]}” or ${keywords.length - 1} more`;
}

/**
 * Reads the stored list back, rule by rule and field by field, the way
 * `parseNewTaskDefaults` and `parseFollowUpTaskDraft` do — a rule written by an
 * older build, or left in a bad shape by a hand-edited database, comes back
 * dropped rather than taking the whole list down with it.
 *
 * A rule that can never do anything (`titleRuleIsUseless`) is dropped on read
 * too: the editor won't save one, so the only way to have one is corruption,
 * and a dead row in the list is a rule someone will spend time wondering
 * about.
 */
export function parseTitleRules(raw: string | null | undefined): TitleRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (_) { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: TitleRule[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const r = entry as Partial<TitleRule>;
    const rule: TitleRule = {
      id: typeof r.id === 'string' && r.id ? r.id : generateId(),
      keywords: normalizeKeywords(Array.isArray(r.keywords) ? r.keywords : []),
      match: TITLE_RULE_MATCHES.includes(r.match as TitleRuleMatch) ? (r.match as TitleRuleMatch) : 'startsWith',
      category: typeof r.category === 'string' ? r.category : null,
      projectId: typeof r.projectId === 'string' ? r.projectId : null,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
      priority: isPriority(r.priority) ? r.priority : 0,
      effort: isEffort(r.effort) ? r.effort : 0,
      linkUrl: typeof r.linkUrl === 'string' && r.linkUrl.trim() !== '' ? r.linkUrl : null,
      stripKeyword: r.stripKeyword === true,
      enabled: r.enabled !== false,
    };
    if (titleRuleIsUseless(rule)) continue;
    out.push(rule);
  }
  return out;
}

function isPriority(v: unknown): v is Priority {
  return v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}

function isEffort(v: unknown): v is Effort {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
}

/**
 * One existing task a newly written rule would have filed, and the fields it
 * would fill (see `titleRuleBacklog`).
 */
export interface TitleRuleBacklogEntry {
  task: Task;
  /** Only the fields the rule fills — never a whole-task replacement. */
  updates: Partial<Pick<Task, 'category' | 'projectId' | 'priority' | 'effort' | 'tags' | 'linkUrl'>>;
}

/**
 * Every live task `rule` would have filed had it existed when they were
 * written — the backlog `TitleRulesSheet` offers to catch up on right after a
 * rule is authored, which is exactly when a dozen of them are already sitting
 * uncategorized.
 *
 * **It runs the one rule, not `resolveTitleRules`.** The offer is about the
 * rule just written, so what another rule would have said about the same task
 * is not this question — and running the whole set would re-file tasks against
 * rules that had every chance to fire already.
 *
 * Four exclusions, all of them the same calls made elsewhere:
 *  - **completed and archived rows are history**, not schedule — the call
 *    `applyTaskDates` makes when it reconciles a series, and re-filing one
 *    rewrites what the Logbook and Stats already say;
 *  - a **subtask** never files itself anywhere, the same reason
 *    `applyTitleRulesToDraft` skips one;
 *  - a **disabled rule** matches nothing (`matchTitleRule` refuses it), so a
 *    rule saved switched off offers no backlog either.
 *
 * The fill is the same contract a creation gets: a field the task already
 * answered keeps its answer, tags accumulate, and a task the rule has nothing
 * left to say about is left out entirely rather than counted and no-opped.
 * `stripKeyword` is deliberately **not** applied — the rule may rewrite a
 * title as it's being typed, but rewriting the name of a task that already
 * exists is the other half of "renaming a task later doesn't refile it".
 */
export function titleRuleBacklog(tasks: Task[], rule: TitleRule): TitleRuleBacklogEntry[] {
  if (titleRuleIsUseless(rule)) return [];
  const out: TitleRuleBacklogEntry[] = [];
  for (const task of tasks) {
    if (task.parentId || task.completed || task.archived) continue;
    if (!matchTitleRule(task.title, rule)) continue;
    const updates: TitleRuleBacklogEntry['updates'] = {};
    if (rule.category !== null && task.category === null) updates.category = rule.category;
    if (rule.projectId !== null && task.projectId === null) updates.projectId = rule.projectId;
    if (rule.priority !== 0 && !task.priority) updates.priority = rule.priority;
    if (rule.effort !== 0 && !task.effort) updates.effort = rule.effort;
    if (rule.linkUrl !== null && task.linkUrl === null) updates.linkUrl = rule.linkUrl;
    const newTags = rule.tags.filter(t => !task.tags.includes(t));
    if (newTags.length > 0) updates.tags = [...task.tags, ...newTags];
    if (Object.keys(updates).length === 0) continue;
    out.push({ task, updates });
  }
  return out;
}
