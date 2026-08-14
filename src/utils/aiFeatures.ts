// The AI features this app can call out to Anthropic for, and which model
// each one uses. Each is independently toggleable and independently
// model-selectable — someone happy to spend more on task suggestions but not
// on grocery-aisle sorting shouldn't have to choose one setting for both.

export type AiFeatureId =
  | 'taskBreakdown' | 'templateSuggestions' | 'groceryAisles' | 'recipeExtraction' | 'mealIdeas'
  | 'substitutes';

export const AI_FEATURE_IDS: AiFeatureId[] = [
  'taskBreakdown', 'templateSuggestions', 'groceryAisles', 'recipeExtraction', 'mealIdeas',
  'substitutes',
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
  },
];

/**
 * The features worth showing a switch for, given whether the
 * groceries/recipes/meal plan area is on.
 *
 * Only the *rows* go — `aiFeatureConfig` is left untouched, so the model and
 * on/off state someone chose for recipe import survive the area being put away
 * and come back with it. Nothing needs to gate the calls themselves: all three
 * of these are reached from inside the three screens.
 */
export function aiFeaturesFor(kitchenEnabled: boolean): AiFeatureMeta[] {
  return kitchenEnabled ? AI_FEATURES : AI_FEATURES.filter(f => !f.kitchen);
}

export interface AiFeatureConfig {
  enabled: boolean;
  model: AiModelId;
}

export type AiFeatureConfigMap = Record<AiFeatureId, AiFeatureConfig>;

export function defaultAiFeatureConfig(): AiFeatureConfigMap {
  return {
    taskBreakdown: { enabled: true, model: DEFAULT_AI_MODEL },
    templateSuggestions: { enabled: true, model: DEFAULT_AI_MODEL },
    groceryAisles: { enabled: true, model: DEFAULT_AI_MODEL },
    recipeExtraction: { enabled: true, model: DEFAULT_AI_MODEL },
    mealIdeas: { enabled: true, model: DEFAULT_AI_MODEL },
    substitutes: { enabled: true, model: DEFAULT_AI_MODEL },
  };
}
