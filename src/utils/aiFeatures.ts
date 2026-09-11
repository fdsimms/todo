// The AI features this app can call out to Anthropic for, and which model
// each one uses. Each is independently toggleable and independently
// model-selectable — someone happy to spend more on task suggestions but not
// on grocery-aisle sorting shouldn't have to choose one setting for both.

export type AiFeatureId =
  | 'taskBreakdown' | 'templateSuggestions' | 'projectTaskSuggestions' | 'groceryAisles'
  | 'recipeExtraction' | 'mealIdeas' | 'substitutes' | 'receiptImport' | 'calendarImport'
  | 'cookHelp' | 'nutritionEstimate' | 'nutritionLabelPhoto' | 'backfillSuggestions';

export const AI_FEATURE_IDS: AiFeatureId[] = [
  'taskBreakdown', 'templateSuggestions', 'projectTaskSuggestions', 'groceryAisles',
  'recipeExtraction', 'mealIdeas', 'substitutes', 'receiptImport', 'calendarImport',
  'cookHelp', 'nutritionEstimate', 'nutritionLabelPhoto', 'backfillSuggestions',
];

export type AiModelId = 'claude-haiku-4-5-20251001' | 'claude-sonnet-5' | 'claude-opus-5';

export const DEFAULT_AI_MODEL: AiModelId = 'claude-haiku-4-5-20251001';

export const AI_MODEL_OPTIONS: { value: AiModelId; label: string }[] = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku' },
  { value: 'claude-sonnet-5', label: 'Sonnet' },
  { value: 'claude-opus-5', label: 'Opus' },
];

export function isAiModelId(value: unknown): value is AiModelId {
  return AI_MODEL_OPTIONS.some(o => o.value === value);
}

export interface AiFeatureMeta {
  id: AiFeatureId;
  label: string;
  hint: string;
  /** Only reachable inside the groceries/recipes/meal plan area. */
  kitchen?: boolean;
  /**
   * Powers something simplified mode takes away, so its row goes with it —
   * see `src/utils/simpleMode.ts`. The surface that calls it is already gone,
   * so a switch left behind would configure nothing.
   */
  simple?: boolean;
}

export const AI_FEATURES: AiFeatureMeta[] = [
  {
    id: 'taskBreakdown',
    label: 'Task breakdown',
    // Reached from the postpone prompt, by someone who has pushed the same
    // thing five times and is past wanting to think about it.
    hint: 'Drafts the steps for a task that keeps getting put off',
  },
  {
    id: 'templateSuggestions',
    label: 'Template drafting',
    hint: 'Suggests checklist items when building a template',
  },
  {
    id: 'projectTaskSuggestions',
    label: 'Project drafting',
    hint: 'Suggests tasks for a project from its title and notes',
  },
  {
    id: 'backfillSuggestions',
    // Only the two Backfill fields a title can actually answer, and both pick
    // from a closed set — see `backfillSuggest.ts` for why the other five task
    // fields and the whole People pool are deliberately not offered here.
    label: 'Backfill suggestions',
    hint: 'Proposes a category and a time estimate for the tasks the Backfill screen is asking about',
  },
  {
    id: 'groceryAisles',
    label: 'Grocery aisle sorting',
    hint: 'Files grocery items the offline list didn\'t recognize into an aisle',
    kitchen: true,
  },
  {
    id: 'recipeExtraction',
    label: 'Recipe import',
    hint: 'Pulls a name, servings, and shopping list out of pasted recipe text or a photo',
    kitchen: true,
  },
  {
    id: 'mealIdeas',
    label: 'Meal ideas',
    // Both halves of #1063 sit under one switch on purpose: inventing the meal
    // and drafting its shopping list are one action from where the user
    // stands, and a key that can do the first but not the second would offer
    // an idea it can't then save as a recipe.
    hint: 'Invents new meals for empty nights, and drafts a shopping list for one you accept',
    kitchen: true,
  },
  {
    id: 'substitutes',
    label: 'Substitute suggestions',
    hint: 'Proposes what to use instead of a grocery item when you ask',
    kitchen: true,
    simple: true,
  },
  {
    id: 'receiptImport',
    label: 'Receipt scanning',
    hint: 'Reads a photo of a store receipt to check items off your list and record what they cost',
    kitchen: true,
    simple: true,
  },
  {
    id: 'cookHelp',
    label: 'Cook mode help',
    hint: 'Answers a question about the recipe step you\'re on while cooking',
    kitchen: true,
    // Cook mode is itself one of the things simplified mode takes away
    // (`cookMode` in simpleMode.ts), so the surface this configures is already
    // gone and a row left behind would configure nothing.
    simple: true,
  },
  {
    id: 'nutritionEstimate',
    label: 'Estimate what a meal contained',
    hint: 'Reads a description of a restaurant meal into nutrition figures for you to confirm',
    kitchen: true,
    // The food log is itself one of the things simplified mode takes away
    // (`foodLogScreen` in simpleMode.ts), so the only surface this configures
    // is already gone and a row left behind would configure nothing. Same
    // reasoning cookHelp gives.
    simple: true,
  },
  {
    id: 'calendarImport',
    label: 'Import event from photo or text',
    hint: 'Reads a title, date, time, and location out of a pasted confirmation or a photo of one',
    simple: true,
  },
  {
    id: 'nutritionLabelPhoto',
    label: 'Read a nutrition label from a photo',
    // Reached from `NutritionPanelSheet`'s own "Read from a photo" button, only
    // once the on-device Vision read of the same photo has already come back
    // with nothing — a curved tub, a steep angle, glare on the wrap.
    hint: 'Falls back to Claude to read a nutrition panel photo the on-device reading could not',
  },
];

/**
 * The features worth showing a switch for, given whether the
 * groceries/recipes/meal plan area is on and whether simplified mode is.
 *
 * Only the *rows* go — `aiFeatureConfig` is left untouched, so the model and
 * on/off state someone chose for recipe import survive the area being put away
 * and come back with it. Nothing needs to gate the calls themselves: all of
 * these are reached from inside a screen or sheet that has already gone.
 */
export function aiFeaturesFor(kitchenEnabled: boolean, simpleMode = false): AiFeatureMeta[] {
  return AI_FEATURES.filter(f =>
    (kitchenEnabled || !f.kitchen) && (!simpleMode || !f.simple));
}

export interface AiFeatureConfig {
  enabled: boolean;
  model: AiModelId;
  /**
   * The user's own opt-in past `aiRouting.ts`'s "a key means Claude" default —
   * see `routeForFeature`'s rule 2. Undefined/false everywhere by default;
   * only a feature that also supports on-device (`supportsOnDevice`) has
   * anywhere to expose a switch for it. Grocery aisle sorting is the first.
   */
  preferOnDevice?: boolean;
}

export type AiFeatureConfigMap = Record<AiFeatureId, AiFeatureConfig>;

export function defaultAiFeatureConfig(): AiFeatureConfigMap {
  return {
    taskBreakdown: { enabled: true, model: DEFAULT_AI_MODEL },
    templateSuggestions: { enabled: true, model: DEFAULT_AI_MODEL },
    projectTaskSuggestions: { enabled: true, model: DEFAULT_AI_MODEL },
    // The default model, for the reason groceryAisles keeps it: both fields
    // this answers are a pick from a closed set rather than open generation,
    // the prompt carries the user's own already-answered tasks as the examples
    // to match, and every value is confirmed by a tap before it is written. A
    // mediocre answer costs a glance, which is the bar that picked Haiku there.
    backfillSuggestions: { enabled: true, model: DEFAULT_AI_MODEL },
    groceryAisles: { enabled: true, model: DEFAULT_AI_MODEL },
    recipeExtraction: { enabled: true, model: DEFAULT_AI_MODEL },
    mealIdeas: { enabled: true, model: DEFAULT_AI_MODEL },
    substitutes: { enabled: true, model: DEFAULT_AI_MODEL },
    // The one feature that doesn't take the default model, because it's the
    // hardest read in the app: a recipe is clean high-contrast type, and a
    // receipt is faded thermal print in store-specific shorthand that has to be
    // understood ("BNLS SKNLS CHKN BRST") rather than merely transcribed. A
    // misread here is also the most expensive one — it checks the wrong row off
    // a list and files a price against it — while the difference in what a scan
    // costs is a couple of cents a trip. Still per-feature switchable, so
    // anyone who disagrees can turn it down without touching the rest.
    receiptImport: { enabled: true, model: 'claude-sonnet-5' },
    // Off by default, unlike every other feature here: this is the one AI
    // feature that can send a photo of something that isn't the user's own
    // task data by nature — a doctor's appointment confirmation, someone
    // else's travel itinerary — so turning it on is an opt-in rather than an
    // opt-out, the same call productLookupEnabled makes for the one other
    // feature in the app that reaches a third party on data the user didn't
    // type themselves. Sonnet for the same reason receiptImport picked it
    // over the default: a misread date or address is expensive to have
    // wrong, and the cost difference per import is negligible.
    calendarImport: { enabled: false, model: 'claude-sonnet-5' },
    // Sonnet for the reason receiptImport and calendarImport both picked it over
    // the default: the cost difference per question is a fraction of a cent, and
    // the expensive failure here is a confident wrong answer about whether
    // something is cooked through. Free text typed by the user goes out with
    // this one — the first feature here for which that's true — which is the
    // other reason to spend on the better read of it.
    cookHelp: { enabled: true, model: 'claude-sonnet-5' },
    // Sonnet, for a reason the other three overrides only half share. This one
    // wants real world knowledge about menus and portion sizes, which is
    // exactly where a smaller model confabulates most confidently — and a
    // confabulated figure here is bound for a food log and eventually a health
    // record, where `docs/arch/health-data.md` says a wrong write costs more
    // than a wrong read. Still per-feature switchable, so the picker can
    // overrule this.
    nutritionEstimate: { enabled: true, model: 'claude-sonnet-5' },
    // Sonnet because every photo that reaches this one already failed the
    // on-device read — the easy panels never get here, so what's left is
    // disproportionately curved tubs, steep angles and glare, the same reasons
    // receiptImport picked a stronger model than its default. Enabled by
    // default rather than opt-in like calendarImport: a nutrition label is the
    // user's own food packaging, not a third party's data, the same
    // distinction that keeps receiptImport on by default too.
    nutritionLabelPhoto: { enabled: true, model: 'claude-sonnet-5' },
  };
}
