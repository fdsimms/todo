// The AI features this app can call out to Anthropic for, and which model
// each one uses. Each is independently toggleable and independently
// model-selectable — someone happy to spend more on task suggestions but not
// on grocery-aisle sorting shouldn't have to choose one setting for both.

export type AiFeatureId = 'taskSuggestions' | 'templateSuggestions' | 'groceryAisles' | 'recipeExtraction';

export const AI_FEATURE_IDS: AiFeatureId[] = [
  'taskSuggestions', 'templateSuggestions', 'groceryAisles', 'recipeExtraction',
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
}

export const AI_FEATURES: AiFeatureMeta[] = [
  {
    id: 'taskSuggestions',
    label: 'Task suggestions',
    hint: 'Auto-tag, effort, and category suggestions in the task editor',
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
  },
  {
    id: 'recipeExtraction',
    label: 'Recipe import',
    hint: 'Pulls a name, servings, and shopping list out of pasted recipe text',
  },
];

export interface AiFeatureConfig {
  enabled: boolean;
  model: AiModelId;
}

export type AiFeatureConfigMap = Record<AiFeatureId, AiFeatureConfig>;

export function defaultAiFeatureConfig(): AiFeatureConfigMap {
  return {
    taskSuggestions: { enabled: true, model: DEFAULT_AI_MODEL },
    templateSuggestions: { enabled: true, model: DEFAULT_AI_MODEL },
    groceryAisles: { enabled: true, model: DEFAULT_AI_MODEL },
    recipeExtraction: { enabled: true, model: DEFAULT_AI_MODEL },
  };
}
