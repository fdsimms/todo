import type { Task } from '../types';
import { useSettingsStore } from './useSettingsStore';
import { getGeneratedCategory, setGeneratedCategory } from './useCategoryStore';
import { GENERATED_KIND_SPECS, type GeneratedKind } from '../utils/generatedTasks';
import { ruleCategoryFor, withRuleCategory } from '../utils/ruleCategory';
import { weatherRuleIdOf } from '../utils/weatherTasks';
import { screenTimeRuleIdOf } from '../utils/screenTimeRules';
import { healthRuleIdOf } from '../utils/healthRules';
import { eventTaskRuleIdOf } from '../utils/eventTasks';

/**
 * Moving an app-written task to another category (a drag on Today) is an answer
 * about where that generator's tasks belong, so the person is offered to apply
 * it to the ones written later. Where the answer lives is the same split
 * `writeEstimateToSource` draws: on the rule for the four rule kinds (a rule's
 * own category wins over the kind's setting), and on the kind's "File them
 * under" setting for every other generator.
 *
 * The write only changes where *future* tasks are filed; a task already written
 * stays wherever it is, the rule "Task settings" already gives.
 */

export interface GeneratedCategoryOffer {
  /** One per generator, or per rule for the rule kinds, so a drag that moved
   *  several of one source asks once. */
  key: string;
  task: Task;
  kind: GeneratedKind;
  /** The generator's name, as Settings shows it. */
  label: string;
  /** Whether the answer is stored on one rule rather than on the whole kind. */
  rule: boolean;
  category: string;
}

type RuleHome = { ruleId: string; apply: (category: string) => boolean };

/** The rule that wrote a rule-kind task, with a write that files it, or null. */
function ruleHomeOf(task: Task): RuleHome | null {
  const settings = useSettingsStore.getState();
  const fallback = task.generatedKind ? getGeneratedCategory(task.generatedKind) : null;
  switch (task.generatedKind) {
    case 'weather': {
      const ruleId = weatherRuleIdOf(task);
      if (!ruleId) return null;
      return {
        ruleId,
        apply: category => {
          const next = withRuleCategory(settings.weatherRules, ruleId, category, fallback);
          if (next) settings.setWeatherRules(next);
          return !!next;
        },
      };
    }
    case 'screenTime': {
      const ruleId = screenTimeRuleIdOf(task);
      if (!ruleId) return null;
      return {
        ruleId,
        apply: category => {
          const next = withRuleCategory(settings.screenTimeRules, ruleId, category, fallback);
          if (next) settings.setScreenTimeRules(next);
          return !!next;
        },
      };
    }
    case 'health': {
      const ruleId = healthRuleIdOf(task);
      if (!ruleId) return null;
      return {
        ruleId,
        apply: category => {
          const next = withRuleCategory(settings.healthRules, ruleId, category, fallback);
          if (next) settings.setHealthRules(next);
          return !!next;
        },
      };
    }
    case 'eventTask': {
      const ruleId = eventTaskRuleIdOf(task);
      if (!ruleId) return null;
      return {
        ruleId,
        apply: category => {
          const next = withRuleCategory(settings.eventRules, ruleId, category, fallback);
          if (next) settings.setEventRules(next);
          return !!next;
        },
      };
    }
    default:
      return null;
  }
}

/** The rule's current category, by name, for the rule kinds. */
function currentRuleCategory(task: Task, ruleId: string): string | null {
  const settings = useSettingsStore.getState();
  const rules =
    task.generatedKind === 'weather' ? settings.weatherRules
      : task.generatedKind === 'screenTime' ? settings.screenTimeRules
        : task.generatedKind === 'health' ? settings.healthRules
          : settings.eventRules;
  const rule = (rules as { id: string; category?: string }[]).find(r => r.id === ruleId);
  if (!rule) return null;
  return ruleCategoryFor(rule, task.generatedKind ? getGeneratedCategory(task.generatedKind) : null);
}

const RULE_KINDS: ReadonlySet<GeneratedKind> = new Set<GeneratedKind>(['weather', 'screenTime', 'health', 'eventTask']);

/**
 * What to offer for a generated task that was just filed under `category`, or
 * null when there is nothing to ask: the task isn't generated, the generator
 * already files there, or the destination is no category at all (a drop into
 * the loose block at the top of Today is not a place to send every future task).
 */
export function generatedCategoryOffer(task: Task, category: string | null): GeneratedCategoryOffer | null {
  const kind = task.generatedKind;
  if (!kind || !category) return null;
  const spec = GENERATED_KIND_SPECS[kind];
  if (!spec?.categorized) return null;
  if (RULE_KINDS.has(kind)) {
    const home = ruleHomeOf(task);
    if (!home || currentRuleCategory(task, home.ruleId) === category) return null;
    return { key: `${kind}#${home.ruleId}`, task, kind, label: spec.label, rule: true, category };
  }
  if (getGeneratedCategory(kind) === category) return null;
  return { key: kind, task, kind, label: spec.label, rule: false, category };
}

/** Make the generator that wrote `task` file its next tasks under `category`. */
export function writeCategoryToSource(task: Task, category: string): void {
  const kind = task.generatedKind;
  if (!kind) return;
  if (RULE_KINDS.has(kind)) {
    ruleHomeOf(task)?.apply(category);
    return;
  }
  setGeneratedCategory(kind, category);
}
