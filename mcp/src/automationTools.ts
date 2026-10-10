/**
 * Automations by conversation: the generators' on/off switches and the rules
 * the person writes for them ("when it's sunny, add Put on sunscreen"), plus
 * title rules ("anything starting with 'pay' goes under Bills").
 *
 * Every one of these is a synced setting (see `SYNCED_SETTING_KEYS`, and
 * `generatedSync.test.ts` holding it there), so a change here reaches the phone
 * on its next sync and the phone's own generators act on it. The server never
 * runs a generator: it has no forecast, calendar, Health or Screen Time to read.
 *
 * **Normalized by the app's own parsers, then checked for what they dropped.**
 * Each list's parser is tolerant on purpose, because its real job is reading a
 * stored blob written by an older build: an unreadable rule is dropped, a
 * keyword too short to match on is removed, a threshold out of range is
 * clamped. That is right for a stored value and wrong for an authored one, so
 * a save runs the parser and then compares: a rule that did not survive is
 * refused with the reason, and one that survived changed comes back as stored,
 * so the agent can say what the app actually kept.
 *
 * **An edit that changes what a rule asks clears its day mark**
 * (`clearWeatherMarksOnEdit`, `clearMarksOnRuleEdit`), the rule the rule sheets
 * already follow: a rule tuned at 10pm would otherwise stay spent until
 * tomorrow with nothing to say why.
 */
import type { DeliverableKind, Difficulty, Effort, GeneratedKind, GeneratedTaskExtras, Priority, TaskFieldDefaults, TimeOfDay } from '../../src/types';
import type { Replica, RuleListType, RuleLists } from './replica';

export const RULE_TYPES: readonly RuleListType[] = ['title', 'weather', 'event', 'health', 'screenTime'];

/** Which generator runs a rule list; title rules apply to every new task rather than generating any. */
const RULE_GENERATOR: Record<Exclude<RuleListType, 'title'>, GeneratedKind> = {
  weather: 'weather',
  event: 'eventTask',
  health: 'health',
  screenTime: 'screenTime',
};

/** What a generator needs on the phone before it can do anything, for the ones that read the device. */
const NEEDS_ON_PHONE: Partial<Record<GeneratedKind, string>> = {
  weather: 'location access, so the phone can read the forecast',
  eventTask: 'calendar access',
  travel: 'calendar access, and a travel time on each event',
  calendarReview: 'calendar access',
  health: 'Apple Health access',
  weighIn: 'Apple Health access',
  screenTime: 'Screen Time access, and the apps to watch chosen on the phone',
};

/** Device bookkeeping the person never sees, left out of what a read returns. */
const MARK_FIELDS = ['lastFiredDayKey', 'lastAheadDayKey'];

function withoutMarks<T extends object>(rule: T): Partial<T> {
  return Object.fromEntries(Object.entries(rule).filter(([k]) => !MARK_FIELDS.includes(k))) as Partial<T>;
}

export interface AutomationSummary {
  kind: string;
  label: string;
  on: boolean;
  /** What it does when on, in the app's own words. */
  does: string;
  /** The category its tasks file under, or null when it files under none (the "File them under" setting). */
  category: string | null;
  /** What else each new task of this kind starts with (its "Task settings"); left out when nothing is set. */
  taskSettings?: TaskSettingsView;
  /** The fields the app writes on each task of this kind, which taskSettings cannot change. Only for kinds with a Task settings page. */
  setByApp?: string[];
  /** The rule list it runs, and how many rules are in it. */
  rules?: { type: RuleListType; count: number };
  needsOnPhone?: string;
  /** Hidden in the app while the groceries, recipes and meal plan area is switched off. */
  hiddenWithKitchenOff?: true;
}

/** A kind's task settings as an agent reads and writes them. */
export interface TaskSettingsView {
  priority?: Priority;
  effort?: Effort;
  difficulty?: Difficulty;
  skipInSuggestions?: boolean;
  tags?: string[];
  timeOfDay?: TimeOfDay;
  askOnCompletion?: { kind: DeliverableKind; options?: string[] };
}

/** The patch set_automation takes: a field set to null clears it, a field left out stays. */
export type TaskSettingsPatch = { [K in keyof TaskSettingsView]?: TaskSettingsView[K] | null };

function taskSettingsView(defaults: TaskFieldDefaults | null, extras: GeneratedTaskExtras | null): TaskSettingsView | undefined {
  const view: TaskSettingsView = {};
  if (defaults?.priority != null) view.priority = defaults.priority;
  if (defaults?.effort != null) view.effort = defaults.effort;
  if (defaults?.difficulty != null) view.difficulty = defaults.difficulty;
  if (defaults?.excludeFromSuggestions != null) view.skipInSuggestions = defaults.excludeFromSuggestions;
  if (extras?.tags.length) view.tags = extras.tags;
  if (extras?.timeSegments.length) view.timeOfDay = extras.timeSegments[0];
  if (extras?.deliverableKind) {
    view.askOnCompletion = extras.deliverableKind === 'choice'
      ? { kind: 'choice', options: extras.deliverableOptions }
      : { kind: extras.deliverableKind };
  }
  return Object.keys(view).length > 0 ? view : undefined;
}

const SEGMENTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
const ASK_KINDS: readonly DeliverableKind[] = ['text', 'date', 'number', 'yesno', 'choice'];

/** Check a patch and fold it over what is stored, refusing a value the Settings sheet couldn't set. */
function applyTaskSettingsPatch(
  replica: Replica,
  kind: GeneratedKind,
  defaults: TaskFieldDefaults | null,
  extras: GeneratedTaskExtras | null,
  patch: TaskSettingsPatch,
): { defaults: TaskFieldDefaults | null; extras: GeneratedTaskExtras | null } {
  const lib = replica.lib();
  // The rows the Settings sheet locks for this kind: the automation writes
  // that field itself, or it can't mean anything on these tasks.
  const locks = lib.generatedTaskSettings.TASK_SETTINGS_SPECS[kind]?.locks ?? [];
  if (locks.includes('time') && patch.timeOfDay) throw new Error('This automation sets its tasks\' time of day itself, so timeOfDay can\'t be set.');
  if (locks.includes('ask') && patch.askOnCompletion) throw new Error('This automation\'s tasks can\'t take a question on completion (setByApp says why).');
  const d: TaskFieldDefaults = { ...lib.taskFieldDefaults.NO_TASK_FIELD_DEFAULTS, ...(defaults ?? {}) };
  const e: GeneratedTaskExtras = { ...lib.generatedTaskSettings.NO_GENERATED_TASK_EXTRAS, ...(extras ?? {}) };
  const whole = (name: string, v: unknown, lo: number, hi: number) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`taskSettings.${name} is a whole number from ${lo} to ${hi}, or null.`);
    return v;
  };
  if (patch.priority !== undefined) d.priority = patch.priority === null ? null : (whole('priority', patch.priority, 0, 4) as Priority);
  if (patch.effort !== undefined) d.effort = patch.effort === null ? null : (whole('effort', patch.effort, 0, 6) as Effort);
  if (patch.difficulty !== undefined) {
    if (patch.difficulty !== null && !['easy', 'normal', 'hard'].includes(patch.difficulty)) throw new Error('taskSettings.difficulty is easy, normal or hard, or null.');
    d.difficulty = patch.difficulty;
  }
  if (patch.skipInSuggestions !== undefined) {
    if (patch.skipInSuggestions !== null && typeof patch.skipInSuggestions !== 'boolean') throw new Error('taskSettings.skipInSuggestions is true, false or null.');
    d.excludeFromSuggestions = patch.skipInSuggestions;
  }
  if (patch.tags !== undefined) {
    if (patch.tags !== null && (!Array.isArray(patch.tags) || patch.tags.some(t => typeof t !== 'string'))) throw new Error('taskSettings.tags is a list of tag names, or null.');
    e.tags = [...new Set((patch.tags ?? []).map(t => t.trim()).filter(Boolean))];
  }
  if (patch.timeOfDay !== undefined) {
    if (patch.timeOfDay !== null && !SEGMENTS.includes(patch.timeOfDay)) throw new Error(`taskSettings.timeOfDay is one of ${SEGMENTS.join(', ')}, or null.`);
    e.timeSegments = patch.timeOfDay ? [patch.timeOfDay] : [];
  }
  if (patch.askOnCompletion !== undefined) {
    const ask = patch.askOnCompletion;
    if (ask !== null && (!ask || !ASK_KINDS.includes(ask.kind))) throw new Error(`taskSettings.askOnCompletion is { kind: ${ASK_KINDS.join(', ')} } (choice also takes options), or null.`);
    const options = ask?.kind === 'choice' ? lib.deliverables.cleanDeliverableOptions(ask.options ?? []) : [];
    if (ask?.kind === 'choice' && options.length < 2) throw new Error('A choice question needs at least two options.');
    e.deliverableKind = ask?.kind ?? null;
    e.deliverableOptions = options;
  }
  return {
    defaults: lib.taskFieldDefaults.hasTaskFieldDefaults(d) ? d : null,
    extras: lib.generatedTaskSettings.hasGeneratedTaskExtras(e) ? e : null,
  };
}

export function listAutomations(replica: Replica): {
  automations: AutomationSummary[];
  rules: { [K in RuleListType]: Partial<RuleLists[K][number]>[] };
  note: string;
} {
  const lib = replica.lib();
  const lists = replica.ruleLists();
  const kitchen = replica.settings().kitchenEnabled;
  const ruleTypeOf = new Map(Object.entries(RULE_GENERATOR).map(([type, kind]) => [kind, type as RuleListType]));

  const automations = lib.generatedTasks.GENERATED_KIND_LIST.map(spec => {
    const type = ruleTypeOf.get(spec.kind);
    return {
      kind: spec.kind,
      label: spec.label,
      on: replica.generatorEnabled(spec.enabledKey),
      does: spec.onHint,
      category: replica.generatorCategory(spec.kind),
      ...taskSettingsFields(replica, spec.kind),
      ...(type ? { rules: { type, count: lists[type].length } } : {}),
      ...(NEEDS_ON_PHONE[spec.kind] ? { needsOnPhone: NEEDS_ON_PHONE[spec.kind] } : {}),
      ...(spec.kitchen && !kitchen ? { hiddenWithKitchenOff: true as const } : {}),
    };
  });

  return {
    automations,
    rules: {
      title: lists.title.map(withoutMarks),
      weather: lists.weather.map(withoutMarks),
      event: lists.event.map(withoutMarks),
      health: lists.health.map(withoutMarks),
      screenTime: lists.screenTime.map(withoutMarks),
    },
    note: 'Automations run on the phone, which reads the forecast, calendar, Health and Screen Time; changes reach it on its next sync. They are in the app under Menu › Automations.',
  };
}

function taskSettingsFields(replica: Replica, kind: GeneratedKind): Pick<AutomationSummary, 'taskSettings' | 'setByApp'> {
  const { defaults, extras } = replica.generatorTaskSettings(kind);
  const view = taskSettingsView(defaults, extras);
  const spec = replica.lib().generatedTaskSettings.TASK_SETTINGS_SPECS[kind];
  return {
    ...(view ? { taskSettings: view } : {}),
    ...(spec ? { setByApp: spec.owned(replica.taskSettingsContext()).map(f => `${f.label}: ${f.summary}`) } : {}),
  };
}

/**
 * Turn an automation on or off, and/or choose the category it files its tasks
 * under. `category: null` files them under none, which is a deliberate answer
 * the app keeps rather than refills: an uncategorized task renders in the
 * loose block above every section of Today, so the result says so.
 */
export function setAutomation(
  replica: Replica,
  kind: string,
  change: { on?: boolean; category?: string | null; taskSettings?: TaskSettingsPatch },
): AutomationSummary & { note?: string } {
  const spec = replica.lib().generatedTasks.GENERATED_KIND_LIST.find(s => s.kind === kind);
  if (!spec) throw new Error(`No automation called "${kind}". list_automations names them.`);
  if (change.on === undefined && change.category === undefined && change.taskSettings === undefined) {
    throw new Error('Say what to change: on, category, taskSettings, or any of them.');
  }
  // Checked before anything is written, so a bad field changes nothing.
  const taskSettings = change.taskSettings !== undefined
    ? applyTaskSettingsPatch(replica, spec.kind, replica.generatorTaskSettings(spec.kind).defaults, replica.generatorTaskSettings(spec.kind).extras, change.taskSettings)
    : undefined;

  let note: string | undefined;
  if (change.category !== undefined) {
    let target: string | null = null;
    if (change.category !== null) {
      const wanted = change.category.trim().toLowerCase();
      const match = replica.categories().find(c => c.name.toLowerCase() === wanted);
      if (!match) {
        const names = replica.categories().map(c => c.name).join(', ') || 'none yet';
        throw new Error(`"${change.category}" isn't one of your categories (${names}). list_categories lists them.`);
      }
      target = match.name;
    } else {
      note = 'Its tasks will file under no category, which puts them in the loose block at the top of Today, above every section.';
    }
    replica.setGeneratorCategory(spec.kind, target);
  }
  if (change.on !== undefined) replica.setGeneratorEnabled(spec.enabledKey, change.on);
  if (taskSettings) replica.setGeneratorTaskSettings(spec.kind, taskSettings);
  const summary = listAutomations(replica).automations.find(a => a.kind === kind)!;
  return note ? { ...summary, note } : summary;
}

/** One list through its own parser, the way the store reads it back at launch. */
function normalize<T extends RuleListType>(replica: Replica, type: T, rules: unknown[]): RuleLists[T] {
  const lib = replica.lib();
  const raw = JSON.stringify(rules);
  switch (type) {
    case 'title': return lib.titleRules.parseTitleRules(raw) as RuleLists[T];
    case 'weather': return lib.weatherTasks.parseWeatherRules(raw) as RuleLists[T];
    case 'event': return lib.eventTasks.parseEventRules(raw) as RuleLists[T];
    case 'health': return lib.healthRules.parseHealthRules(raw) as RuleLists[T];
    case 'screenTime': return lib.screenTimeRules.parseScreenTimeRules(raw) as RuleLists[T];
    default: throw new Error(`Unknown rule type ${String(type)}.`);
  }
}

const DROPPED: Record<RuleListType, string> = {
  title: `A title rule needs at least one keyword of 3 or more letters and something to do (a category, project, tags, priority, effort or link).`,
  weather: 'A weather rule needs a condition and a task title.',
  event: 'An event rule needs at least one word to look for and a task title.',
  health: 'A health rule needs a metric, a numeric threshold and a task title.',
  screenTime: 'A Screen Time rule needs a threshold in minutes and a task title.',
};

/** The defaults a new rule starts from, before the caller's fields go over it. */
function fresh(replica: Replica, type: RuleListType): Record<string, unknown> {
  if (type === 'title') return { ...replica.lib().titleRules.emptyTitleRule() };
  return { enabled: true, lastFiredDayKey: null, ...(type === 'weather' ? { lastAheadDayKey: null } : {}) };
}

export function saveRule(
  replica: Replica,
  type: RuleListType,
  rule: Record<string, unknown> & { id?: string },
): { saved: Record<string, unknown>; created: boolean; adjusted?: string[] } {
  const lib = replica.lib();
  const current = replica.ruleLists()[type] as unknown as Record<string, unknown>[];
  const existing = rule.id ? current.find(r => r.id === rule.id) : undefined;
  if (rule.id && !existing) throw new Error(`No ${type} rule with id ${rule.id}. list_automations lists them.`);

  const given = Object.fromEntries(Object.entries(rule).filter(([, v]) => v !== undefined));
  const id = existing ? (existing.id as string) : (lib.titleRules.emptyTitleRule().id);
  const merged = { ...(existing ?? fresh(replica, type)), ...given, id };
  const next = existing ? current.map(r => (r.id === id ? merged : r)) : [...current, merged];

  let normalized = normalize(replica, type, next) as unknown as Record<string, unknown>[];
  const stored = normalized.find(r => r.id === id);
  if (!stored) throw new Error(DROPPED[type]);

  if (type === 'weather') {
    normalized = lib.weatherTasks.clearWeatherMarksOnEdit(current as never, normalized as never) as unknown as Record<string, unknown>[];
  } else if (type === 'health') {
    normalized = lib.healthRules.clearMarksOnRuleEdit(current as never, normalized as never) as unknown as Record<string, unknown>[];
  }
  replica.setRuleList(type, normalized as never);

  // What the parser changed on the way in, so a rule is never reported as
  // saved the way it was asked for when the app kept something else.
  const adjusted = Object.keys(given)
    .filter(k => k !== 'id' && JSON.stringify(given[k]) !== JSON.stringify(stored[k]))
    .map(k => `${k} was stored as ${JSON.stringify(stored[k] ?? null)}`);
  return {
    saved: withoutMarks(normalized.find(r => r.id === id)!),
    created: !existing,
    ...(adjusted.length > 0 ? { adjusted } : {}),
  };
}

export function deleteRule(replica: Replica, type: RuleListType, id: string): { removed: Record<string, unknown>; remaining: number } {
  const current = replica.ruleLists()[type] as unknown as Record<string, unknown>[];
  const removed = current.find(r => r.id === id);
  if (!removed) throw new Error(`No ${type} rule with id ${id}.`);
  const next = current.filter(r => r.id !== id);
  replica.setRuleList(type, next as never);
  return { removed: withoutMarks(removed), remaining: next.length };
}
