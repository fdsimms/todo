/**
 * The whole template library, checked at once: what `template_library_check`
 * returns.
 *
 * `templateWarnings` looks at one template as it is written. This looks across
 * all of them, for the two things no single template can show: pointers into
 * other templates or other parts that have gone dangling, and the same run of
 * items copied into several templates, which is what a nested template is for.
 * Reading every template side by side is exactly the job nobody does by hand,
 * and it is cheap here.
 *
 * **It suggests; it never edits.** Every finding names what an
 * `update_template` would change, and the person approves that edit through its
 * preview like any other. Pure, so it runs in the repo's jest with no database.
 */
import type { TaskTemplate, TemplateItem } from '../../src/types';
import { itemPlaceholders, placeholderKey } from '../../src/utils/templateUtils';
import { templateWarnings } from './templatePlan';

/** Items repeated across templates below this size are coincidence ("Pack bag"), not a block worth nesting. */
export const MIN_SHARED_ITEMS = 3;
/** How alike two templates' item lists have to be before one is called a near-copy of the other. */
export const NEAR_DUPLICATE_OVERLAP = 0.7;

export interface TemplateFindings {
  id: string;
  name: string;
  /** Things that are broken now: a run skips or mishandles them. */
  problems: string[];
  /** Legal but probably unintended (templateWarnings), plus questions nothing uses. */
  warnings: string[];
}

export interface SharedItems {
  /** The items, as titled in the first template that has them. */
  items: string[];
  /** Every template that holds all of them. */
  templates: { id: string; name: string }[];
  suggestion: string;
}

export interface NearDuplicate {
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** Shared items over the items either has (Jaccard), 0 to 1. */
  overlap: number;
  onlyInA: string[];
  onlyInB: string[];
  suggestion: string;
}

export interface LibraryCheck {
  templates: TemplateFindings[];
  shared: SharedItems[];
  nearDuplicates: NearDuplicate[];
}

/**
 * An item's title reduced to what makes two copies the same item: blanks
 * removed (`Pack {nights} shirts` in one template is `Pack 7 shirts` in a run
 * of another), case and spacing ignored.
 */
export function itemKey(title: string): string {
  return title.replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The task items a template holds itself, by key. A nested template's items are its own template's. */
function ownItems(template: TaskTemplate): Map<string, TemplateItem> {
  const out = new Map<string, TemplateItem>();
  for (const item of template.items) {
    if (item.refTemplateId !== null) continue;
    const key = itemKey(item.title);
    if (key && !out.has(key)) out.set(key, item);
  }
  return out;
}

function findingsFor(template: TaskTemplate, byId: Map<string, TaskTemplate>, categories: readonly string[]): TemplateFindings {
  const problems: string[] = [];
  const itemIds = new Set(template.items.map(i => i.id));
  const questionIds = new Set(template.questions.map(q => q.id));
  const label = (item: TemplateItem) => `item "${item.title || item.refTemplateName || item.id}"`;

  if (template.items.length === 0) problems.push('It has no items, so a run creates nothing.');
  for (const item of template.items) {
    if (item.refTemplateId !== null && !byId.has(item.refTemplateId)) {
      problems.push(`${label(item)} nests "${item.refTemplateName || 'a template'}", which no longer exists, so a run gets nothing from it. Remove the item or nest another template.`);
    }
    for (const condition of item.conditions) {
      if (!questionIds.has(condition.questionId)) {
        problems.push(`${label(item)} has a condition on a question that was deleted. It is ignored, so the item is ticked by its optional flag alone.`);
      }
    }
    if (item.answerGate && !itemIds.has(item.answerGate.itemId)) {
      problems.push(`${label(item)} waits for an answer from an item that is gone, so the wait is dropped.`);
    }
    if ((item.blockedByItemIds ?? []).some(id => !itemIds.has(id))) {
      problems.push(`${label(item)} waits on an item that is gone, so that wait is dropped.`);
    }
    if (item.groupId && !template.itemGroups.some(g => g.id === item.groupId)) {
      problems.push(`${label(item)} is filed in a group that is gone, so it runs ungrouped.`);
    }
  }

  const warnings = templateWarnings(template, categories);
  // A question no title fills and no condition reads is asked on every run for
  // nothing. A people question is exempt: its answer is who the run is for.
  const blanksUsed = new Set(template.items.flatMap(i => itemPlaceholders(i)));
  const conditioned = new Set(template.items.flatMap(i => i.conditions.map(c => c.questionId)));
  for (const question of template.questions) {
    if (question.kind === 'people') continue;
    const fills = question.name && blanksUsed.has(placeholderKey(question.name));
    if (!fills && !conditioned.has(question.id)) {
      warnings.push(`The question "${question.prompt || question.name}" is asked on every run, but no item's text uses {${question.name || '…'}} and no item is conditioned on it. Use it or remove it.`);
    }
  }
  return { id: template.id, name: template.name, problems, warnings };
}

/**
 * Runs of items two or more templates hold in common, largest first. A set
 * held by more templates is reported once with all of them, and a set that is
 * already a nested template everywhere it appears is not reported (that is the
 * fix, already made).
 */
function sharedItems(templates: readonly TaskTemplate[]): SharedItems[] {
  const keyed = templates.map(t => ({ template: t, items: ownItems(t) }));
  const found = new Map<string, SharedItems>();
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      const common = [...keyed[i].items.keys()].filter(k => keyed[j].items.has(k)).sort();
      if (common.length < MIN_SHARED_ITEMS) continue;
      const signature = common.join('\u0000');
      if (found.has(signature)) continue;
      const holders = keyed.filter(k => common.every(c => k.items.has(c))).map(k => k.template);
      const titles = common.map(c => keyed[i].items.get(c)!.title);
      found.set(signature, {
        items: titles,
        templates: holders.map(t => ({ id: t.id, name: t.name })),
        suggestion: `These ${titles.length} items are copied into ${holders.map(t => `"${t.name}"`).join(', ')}. Move them into one template and nest it in each (refTemplate), so a change is made once.`,
      });
    }
  }
  // A smaller set wholly inside a larger one held by the same templates adds
  // nothing: the larger one is the block to extract.
  const all = [...found.values()].sort((a, b) => b.items.length - a.items.length);
  return all.filter((set, index) => !all.slice(0, index).some(bigger =>
    set.items.every(t => bigger.items.some(b => itemKey(b) === itemKey(t)))
    && set.templates.every(t => bigger.templates.some(b => b.id === t.id))));
}

function nearDuplicates(templates: readonly TaskTemplate[]): NearDuplicate[] {
  const keyed = templates.map(t => ({ template: t, items: ownItems(t) }));
  const out: NearDuplicate[] = [];
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      const a = keyed[i];
      const b = keyed[j];
      if (a.items.size === 0 || b.items.size === 0) continue;
      const shared = [...a.items.keys()].filter(k => b.items.has(k));
      const union = new Set([...a.items.keys(), ...b.items.keys()]).size;
      const overlap = shared.length / union;
      if (overlap < NEAR_DUPLICATE_OVERLAP) continue;
      const onlyInA = [...a.items.entries()].filter(([k]) => !b.items.has(k)).map(([, v]) => v.title);
      const onlyInB = [...b.items.entries()].filter(([k]) => !a.items.has(k)).map(([, v]) => v.title);
      out.push({
        a: { id: a.template.id, name: a.template.name },
        b: { id: b.template.id, name: b.template.name },
        overlap: Math.round(overlap * 100) / 100,
        onlyInA,
        onlyInB,
        suggestion: onlyInA.length + onlyInB.length === 0
          ? `"${a.template.name}" and "${b.template.name}" hold the same items. One of them may be enough.`
          : `"${a.template.name}" and "${b.template.name}" differ by ${onlyInA.length + onlyInB.length} items. They could be one template with a choice question, conditioning the items that differ on its answer.`,
      });
    }
  }
  return out.sort((x, y) => y.overlap - x.overlap);
}

/**
 * Every template's problems and warnings, plus the cross-template findings.
 * Templates with nothing to report are left out of `templates`, so a clean
 * library reads as an empty list rather than a page of empty entries.
 */
export function checkTemplateLibrary(templates: readonly TaskTemplate[], categories: readonly string[]): LibraryCheck {
  const byId = new Map(templates.map(t => [t.id, t]));
  return {
    templates: templates
      .map(t => findingsFor(t, byId, categories))
      .filter(f => f.problems.length > 0 || f.warnings.length > 0),
    shared: sharedItems(templates),
    nearDuplicates: nearDuplicates(templates),
  };
}
