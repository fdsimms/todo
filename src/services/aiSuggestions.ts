import type { Effort, RecipeSourceType } from '../types';
import {
  TITLE_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_PAGE_MAX_LENGTH,
  RECIPE_SECTION_MAX_LENGTH,
  RECIPE_SOURCE_MAX_LENGTH,
  RECIPE_SOURCE_TYPES,
  SHOP_NAME_MAX_LENGTH,
  PREP_MAX_LENGTH,
} from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { parsePriceInput } from '../utils/groceryPrice';
import { OTHER_AISLE } from '../utils/groceryAisles';
import {
  clampIdeaCount, dedupeMealIdeas, MAX_MEAL_IDEAS, MIN_MEAL_IDEAS,
  type MealIdea, type RawMealIdea,
} from '../utils/mealIdeas';
import {
  dedupeSuggestedSubstitutes, MAX_SUGGESTED_SUBSTITUTES,
  type RawSuggestedSubstitute, type SuggestedSubstitute,
} from '../utils/substituteSuggestions';
import { useSettingsStore } from '../store/useSettingsStore';
import type { AiFeatureId, AiModelId } from '../utils/aiFeatures';

const API_URL = 'https://api.anthropic.com/v1/messages';
const REQUEST_TIMEOUT_MS = 15_000;
/**
 * A photo has to be uploaded before the model can start, and then costs a vision
 * prefill on top of the same 2,000-token completion. 15s is comfortable for a
 * paste and routinely isn't for a photo on cellular — and a spurious "timed out"
 * on a shot the user just framed is the worst failure this feature has.
 */
const IMAGE_REQUEST_TIMEOUT_MS = 40_000;

interface AnthropicResponse {
  stop_reason?: string;
  content?: Array<{ type: string; input?: unknown }>;
}

/**
 * Reads the API key and this feature's enabled/model setting. Throws the same
 * way an absent key already did, so describeAIError has one place to map both
 * to user-facing copy.
 */
function requireFeature(id: AiFeatureId): { apiKey: string; model: AiModelId } {
  const { anthropicApiKey: apiKey, aiFeatureConfig } = useSettingsStore.getState();
  if (!apiKey) throw new Error('No API key configured. Add your Anthropic API key in Settings.');
  const { enabled, model } = aiFeatureConfig[id];
  if (!enabled) throw new Error('AI feature disabled');
  return { apiKey, model };
}

/** POSTs to the Messages API with a timeout and flags a max_tokens truncation as an error. */
async function callAnthropic(
  body: Record<string, unknown>,
  apiKey: string,
  model: AiModelId,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<AnthropicResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      // No `temperature` override — Opus 5/Sonnet 5 reject a non-default
      // value, and the tool-forced extraction below doesn't need one.
      body: JSON.stringify({ model, ...body }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`API error ${response.status}`);

  const data = await response.json() as AnthropicResponse;
  if (data.stop_reason === 'max_tokens') throw new Error('Response was truncated');
  return data;
}

/** Maps an Anthropic request failure to copy safe to show a user. */
export function describeAIError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'No API key' || message.startsWith('No API key configured')) {
    return 'Add your Anthropic API key in Settings.';
  }
  if (message === 'AI feature disabled') return 'This AI feature is turned off in Settings.';
  if (message === 'Request timed out') return 'The request timed out. Try again.';
  if (message === 'API error 401') return 'Check your API key in Settings.';
  if (message === 'API error 429') return 'Rate limited by Anthropic. Try again in a moment.';
  if (message.startsWith('API error 5')) return 'Anthropic is having issues. Try again shortly.';
  if (message.startsWith('API error')) return 'The request failed. Check your API key in Settings.';
  if (message === 'Response was truncated') return 'The response was cut off. Try again.';
  return 'Network request failed. Check your connection.';
}

export interface TemplateItemSuggestion {
  title: string;
  notes: string;
}

const MIN_TEMPLATE_SUGGESTIONS = 4;
const MAX_TEMPLATE_SUGGESTIONS = 8;

/**
 * Ask the AI to draft a checklist of tasks for a template, given its name and
 * the tasks it already contains. Returns concrete, de-duplicated task titles
 * (with an optional one-line note and effort bucket) that the user can accept
 * or reject before they're added to the template.
 */
export async function suggestTemplateItems(
  templateName: string,
  existingTitles: string[],
): Promise<TemplateItemSuggestion[]> {
  const { apiKey, model } = requireFeature('templateSuggestions');

  const existingPart = existingTitles.length > 0
    ? `The template already contains these tasks — do NOT repeat or rephrase them:\n${existingTitles.map(t => `- ${t}`).join('\n')}`
    : 'The template is currently empty.';

  const data = await callAnthropic({
    max_tokens: 800,
    tools: [{
      name: 'suggest_tasks',
      description: 'Return a list of suggested tasks for a reusable task template',
      input_schema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: `Between ${MIN_TEMPLATE_SUGGESTIONS} and ${MAX_TEMPLATE_SUGGESTIONS} suggested tasks that fit the template's purpose.`,
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: `A short, concrete, actionable task title (under ${TITLE_MAX_LENGTH} characters).`,
                },
                notes: {
                  type: 'string',
                  description: 'An optional one-line clarifying detail, or an empty string if none is needed.',
                },
              },
              required: ['title', 'notes'],
            },
          },
        },
        required: ['tasks'],
      },
    }],
    tool_choice: { type: 'tool', name: 'suggest_tasks' },
    messages: [{
      role: 'user',
      content: [
        `Suggest a checklist of tasks for a reusable task template named "${templateName}".`,
        `Each task should be a concrete, actionable step someone would genuinely want in this checklist. Keep titles short and skip vague filler. Aim for ${MIN_TEMPLATE_SUGGESTIONS}–${MAX_TEMPLATE_SUGGESTIONS} tasks.`,
        existingPart,
      ].join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { tasks?: Array<{ title?: string; notes?: string }> } | undefined;
  if (!input?.tasks) throw new Error('No suggestions returned');

  // Drop blanks and anything that collides (case-insensitively) with an existing
  // item or an earlier suggestion, so the user only sees genuinely new tasks.
  const existingLower = new Set(existingTitles.map(t => t.trim().toLowerCase()));
  const seen = new Set<string>();
  const result: TemplateItemSuggestion[] = [];
  for (const t of input.tasks) {
    const title = (t.title ?? '').trim().slice(0, TITLE_MAX_LENGTH);
    if (!title) continue;
    const key = title.toLowerCase();
    if (existingLower.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({
      title,
      notes: (t.notes ?? '').trim(),
    });
  }
  return result.slice(0, MAX_TEMPLATE_SUGGESTIONS);
}

export interface ProjectTaskSuggestion {
  title: string;
  notes: string;
}

const MIN_PROJECT_TASK_SUGGESTIONS = 4;
const MAX_PROJECT_TASK_SUGGESTIONS = 8;
/** Existing task titles sent for de-duplication context — a big project's whole history is more than the prompt needs. */
const MAX_PROJECT_EXISTING_TITLES = 30;

/**
 * Ask the AI to draft the tasks a project needs, given its title and notes
 * (the project's description) and what's already in it. Same shape as
 * suggestTemplateItems — concrete, de-duplicated task titles (with an
 * optional one-line note) that the user can accept or reject before they're
 * added to the project.
 */
export async function suggestProjectTasks(
  projectTitle: string,
  projectNotes: string,
  existingTitles: string[],
): Promise<ProjectTaskSuggestion[]> {
  const { apiKey, model } = requireFeature('projectTaskSuggestions');

  const notes = projectNotes.trim();
  const existing = existingTitles.slice(0, MAX_PROJECT_EXISTING_TITLES);
  const existingPart = existing.length > 0
    ? `The project already has these tasks — do NOT repeat or rephrase them:\n${existing.map(t => `- ${t}`).join('\n')}`
    : 'The project has no tasks yet.';

  const data = await callAnthropic({
    max_tokens: 800,
    tools: [{
      name: 'suggest_tasks',
      description: 'Return a list of suggested tasks for a project',
      input_schema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: `Between ${MIN_PROJECT_TASK_SUGGESTIONS} and ${MAX_PROJECT_TASK_SUGGESTIONS} concrete tasks that would move this project forward.`,
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: `A short, concrete, actionable task title (under ${TITLE_MAX_LENGTH} characters).`,
                },
                notes: {
                  type: 'string',
                  description: 'An optional one-line clarifying detail, or an empty string if none is needed.',
                },
              },
              required: ['title', 'notes'],
            },
          },
        },
        required: ['tasks'],
      },
    }],
    tool_choice: { type: 'tool', name: 'suggest_tasks' },
    messages: [{
      role: 'user',
      content: [
        `Suggest the concrete tasks needed to complete a project titled "${projectTitle}".`,
        notes ? `Description of the project:\n${notes}` : '',
        `Each task should be a specific, actionable step someone would genuinely do to move this project forward — not a vague phase or milestone. Keep titles short and skip filler. Aim for ${MIN_PROJECT_TASK_SUGGESTIONS}–${MAX_PROJECT_TASK_SUGGESTIONS} tasks.`,
        existingPart,
      ].filter(Boolean).join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { tasks?: Array<{ title?: string; notes?: string }> } | undefined;
  if (!input?.tasks) throw new Error('No suggestions returned');

  // Same de-duplication as suggestTemplateItems: drop blanks, and anything
  // colliding case-insensitively with an existing task or an earlier
  // suggestion.
  const existingLower = new Set(existing.map(t => t.trim().toLowerCase()));
  const seen = new Set<string>();
  const result: ProjectTaskSuggestion[] = [];
  for (const t of input.tasks) {
    const title = (t.title ?? '').trim().slice(0, TITLE_MAX_LENGTH);
    if (!title) continue;
    const key = title.toLowerCase();
    if (existingLower.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({
      title,
      notes: (t.notes ?? '').trim(),
    });
  }
  return result.slice(0, MAX_PROJECT_TASK_SUGGESTIONS);
}

export interface SubtaskSuggestion {
  title: string;
}

const MIN_SUBTASK_SUGGESTIONS = 3;
const MAX_SUBTASK_SUGGESTIONS = 6;
/** Characters of the task's own notes we'll send along for context. */
const MAX_BREAKDOWN_NOTES_CHARS = 1_000;

/**
 * Break a task that keeps getting put off into the steps it's actually made of.
 *
 * Reached from the postpone prompt (see PostponeCheckBanner), so the framing in
 * the prompt is deliberate: the user isn't planning, they're stuck, and the
 * most useful answer is a first step small enough to start right now. Hence
 * "the first step should be something you could do in a couple of minutes" —
 * a breakdown whose first item is still daunting hasn't helped.
 *
 * Returns titles only. The template equivalent asks for notes as well, but a
 * subtask row doesn't render them, so asking would spend tokens on something
 * nothing displays.
 */
export async function suggestSubtasks(
  taskTitle: string,
  taskNotes: string,
  existingTitles: string[],
): Promise<SubtaskSuggestion[]> {
  const { apiKey, model } = requireFeature('taskBreakdown');

  const notes = taskNotes.trim().slice(0, MAX_BREAKDOWN_NOTES_CHARS);
  const existingPart = existingTitles.length > 0
    ? `It already has these steps — do NOT repeat or rephrase them:\n${existingTitles.map(t => `- ${t}`).join('\n')}`
    : 'It has no steps yet.';

  const data = await callAnthropic({
    max_tokens: 600,
    tools: [{
      name: 'suggest_subtasks',
      description: 'Return the concrete steps a task breaks down into',
      input_schema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: `Between ${MIN_SUBTASK_SUGGESTIONS} and ${MAX_SUBTASK_SUGGESTIONS} steps, in the order they'd be done.`,
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: `A short, concrete step (under ${TITLE_MAX_LENGTH} characters).`,
                },
              },
              required: ['title'],
            },
          },
        },
        required: ['steps'],
      },
    }],
    tool_choice: { type: 'tool', name: 'suggest_subtasks' },
    messages: [{
      role: 'user',
      content: [
        `Break this task into the concrete steps it's actually made of: "${taskTitle}".`,
        notes ? `Notes on the task:\n${notes}` : null,
        `The person asking has put this task off several times, which usually means it's vaguer or larger than it looks. The first step should be something they could finish in a couple of minutes — a phone number to find, a single email to send, one document to open. Keep every title short and concrete, skip vague filler like "plan" or "research", and aim for ${MIN_SUBTASK_SUGGESTIONS}–${MAX_SUBTASK_SUGGESTIONS} steps.`,
        existingPart,
      ].filter(Boolean).join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { steps?: Array<{ title?: string }> } | undefined;
  if (!input?.steps) throw new Error('No suggestions returned');

  // Same de-duplication as suggestTemplateItems: drop blanks, and anything
  // colliding case-insensitively with an existing subtask or an earlier
  // suggestion.
  const existingLower = new Set(existingTitles.map(t => t.trim().toLowerCase()));
  const seen = new Set<string>();
  const result: SubtaskSuggestion[] = [];
  for (const step of input.steps) {
    const title = (step.title ?? '').trim().slice(0, TITLE_MAX_LENGTH);
    if (!title) continue;
    const key = title.toLowerCase();
    if (existingLower.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({ title });
  }
  return result.slice(0, MAX_SUBTASK_SUGGESTIONS);
}

// ─── Groceries ──────────────────────────────────────────────────────────────

/** Names per aisle-sort call. A weekly list is well under this; the cap bounds a pathological one. */
const MAX_AISLE_NAMES = 60;
/**
 * Characters of recipe text we'll send. Roughly a long recipe including method.
 * Exported because `recipePage.ts` has to trim a fetched page to fit it, and a
 * second copy of the number there is one that goes stale.
 */
export const MAX_RECIPE_CHARS = 4_000;
const MAX_RECIPE_ITEMS = 40;
/**
 * Cross-references to other recipes we'll carry back from one page. A cookbook
 * recipe points at one or two of its neighbours; a page claiming six of them is
 * a model reading the index, not the recipe.
 */
const MAX_RECIPE_REFERENCES = 4;
/** The locator, verbatim — "page 45", "p. 212", "opposite". Not a sentence. */
const RECIPE_REFERENCE_MAX_LENGTH = 40;
const MAX_RECIPE_STEPS = 30;
const MAX_RECIPE_PREP_TASKS = 8;
/** Matches PrepTaskSheet's own OFFSET_MIN — a week out is a Task with its own due date, not a recipe prep task. */
const MAX_PREP_DAYS_AHEAD = 7;

/**
 * Case-insensitively resolves a model-supplied aisle to the canonical spelling
 * the app actually renders, or null if it invented one.
 *
 * Same discipline as the category handling above: never trust a returned
 * string as an identifier. An aisle that isn't in the walk order would render
 * its items in an unordered heap at the bottom of the list.
 */
function canonicalAisle(proposed: unknown, availableAisles: string[]): string | null {
  if (typeof proposed !== 'string') return null;
  const trimmed = proposed.trim();
  if (!trimmed) return null;
  return availableAisles.find(a => a.toLowerCase() === trimmed.toLowerCase()) ?? null;
}

/**
 * Files items the offline lexicon didn't recognise into an aisle.
 *
 * Strictly a gap-filler: `aisleForName` handles the common shop with no
 * network and no API key, and everything it misses already has a home in
 * "Other". This just makes that home better. Returns a name → aisle map
 * keyed by the exact strings passed in, so the caller can match them back
 * without re-normalising.
 */
export async function suggestGroceryAisles(
  names: string[],
  availableAisles: string[],
): Promise<Record<string, string>> {
  const { apiKey, model } = requireFeature('groceryAisles');

  const wanted = names.map(n => n.trim()).filter(Boolean).slice(0, MAX_AISLE_NAMES);
  if (wanted.length === 0) return {};

  const data = await callAnthropic({
    max_tokens: 1000,
    tools: [{
      name: 'assign_aisles',
      description: 'Assign each grocery item to the supermarket section it belongs in',
      input_schema: {
        type: 'object',
        properties: {
          assignments: {
            type: 'array',
            description: 'One entry per item given, in the same order.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'The item name, copied exactly as given.' },
                aisle: {
                  type: 'string',
                  description: `The section it belongs in. Must be exactly one of: ${availableAisles.join(', ')}.`,
                },
              },
              required: ['name', 'aisle'],
            },
          },
        },
        required: ['assignments'],
      },
    }],
    tool_choice: { type: 'tool', name: 'assign_aisles' },
    messages: [{
      role: 'user',
      content: [
        'Assign each of these grocery items to the supermarket section where a shopper would find it.',
        `Sections available: ${availableAisles.join(', ')}.`,
        'Use "Other" only when an item genuinely fits none of the rest.',
        `Items:\n${wanted.map(n => `- ${n}`).join('\n')}`,
      ].join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { assignments?: Array<{ name?: unknown; aisle?: unknown }> } | undefined;
  if (!input?.assignments) throw new Error('No suggestions returned');

  // Match back against what we actually sent, so a hallucinated item can't
  // enter the result and a renamed one can't silently miss.
  const byLower = new Map(wanted.map(n => [n.toLowerCase(), n]));
  const out: Record<string, string> = {};
  for (const a of input.assignments) {
    if (typeof a?.name !== 'string') continue;
    const original = byLower.get(a.name.trim().toLowerCase());
    if (!original) continue;
    const aisle = canonicalAisle(a.aisle, availableAisles);
    if (!aisle) continue;
    out[original] = aisle;
  }
  return out;
}

export interface RecipeGroceryItem {
  name: string;
  /** Free text ("2 lb", "1 bunch"), or empty when the recipe didn't say. */
  quantity: string;
  aisle: string;
  /**
   * Which component of the recipe this belongs to ("For the cake", "For the
   * frosting"), or null when the source wasn't written in sections. Read
   * straight into RecipeIngredient.section by normalizeIngredient — same
   * field name, so nothing here has to translate it.
   */
  section: string | null;
  /**
   * What to do to it before it's used — "pressed and cubed", "steamed 10
   * min" — read straight into RecipeIngredient.prep by normalizeIngredient.
   * null when the source didn't attach one. This is where the prep clause
   * `sharedRecipeInstructions` tells the model to strip out of `name`/
   * `quantity` is supposed to land, rather than being discarded.
   */
  prep: string | null;
}

/** Same validation `suggestRecipeGroceries` always applied, now shared with extractRecipe. */
function parseExtractedItems(
  raw: unknown,
  availableAisles: string[],
): RecipeGroceryItem[] {
  const items = raw as Array<
    { name?: unknown; quantity?: unknown; aisle?: unknown; component?: unknown; prep?: unknown }
  > | undefined;
  if (!items) return [];

  const seen = new Set<string>();
  const result: RecipeGroceryItem[] = [];
  for (const item of items) {
    if (typeof item?.name !== 'string') continue;
    const name = item.name.trim().slice(0, GROCERY_NAME_MAX_LENGTH);
    if (!name) continue;
    // Dedupe on the same key the catalog uses, so two spellings of the same
    // thing don't both get offered.
    const key = groceryNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      name,
      quantity: typeof item.quantity === 'string'
        ? item.quantity.trim().slice(0, GROCERY_QUANTITY_MAX_LENGTH)
        : '',
      aisle: canonicalAisle(item.aisle, availableAisles) ?? OTHER_AISLE,
      // The model's field is named "component" (see sharedRecipeInstructions)
      // to keep it unambiguous from the grocery-aisle "section" the same
      // prompt already talks about; it lands on RecipeIngredient.section once
      // normalizeIngredient reads this object.
      section: typeof item.component === 'string' && item.component.trim()
        ? item.component.trim().slice(0, RECIPE_SECTION_MAX_LENGTH)
        : null,
      prep: typeof item.prep === 'string' && item.prep.trim()
        ? item.prep.trim().slice(0, PREP_MAX_LENGTH)
        : null,
    });
  }
  return result.slice(0, MAX_RECIPE_ITEMS);
}

/**
 * One "and there's another recipe for this bit, over there" pointer read off
 * the page — "1 cup salsa verde (page 45)", "serve with the herb oil on p. 12".
 *
 * This is what `Recipe.components` is for (see docs/arch/recipes.md): the
 * referenced dish is a recipe of its own, cooked separately, and linking the
 * two is what stops "salsa verde" being shopped for as a jar while its own
 * tomatillos are shopped for as well.
 *
 * **Deliberately not the same field as an ingredient's `component`.** That one
 * labels a part of *this* recipe's own list ("For the frosting") and lands on
 * `RecipeIngredient.section`; this one names a different recipe entirely. The
 * prompt says so in as many words, because the two words are one keystroke
 * apart in meaning and the model will happily conflate them.
 */
export interface ExtractedRecipeReference {
  /** The referenced recipe's own title, as the page prints it. Never empty. */
  name: string;
  /**
   * Where the page says to find it, in its own words — "page 45", "p. 212".
   * Never empty: see `parseExtractedReferences` for why that's a hard rule.
   */
  reference: string;
}

/**
 * **A reference with no locator is dropped, and that gate is the whole
 * false-positive story.** "Serve with rice" mentions a dish and points nowhere;
 * "serve with the salsa verde on page 45" points somewhere. Without the rule,
 * every closing line of every method becomes a recipe the app pesters you to go
 * photograph. The prompt asks for the same thing, but a prompt is a request and
 * this is the enforcement — same split `parseExtractedItems` makes between
 * asking for an aisle and canonicalising whatever comes back.
 */
function parseExtractedReferences(raw: unknown): ExtractedRecipeReference[] {
  const items = raw as Array<{ name?: unknown; reference?: unknown }> | undefined;
  if (!Array.isArray(items)) return [];

  const seen = new Set<string>();
  const result: ExtractedRecipeReference[] = [];
  for (const item of items) {
    if (typeof item?.name !== 'string' || typeof item?.reference !== 'string') continue;
    const name = item.name.trim().slice(0, RECIPE_NAME_MAX_LENGTH);
    const reference = item.reference.trim().slice(0, RECIPE_REFERENCE_MAX_LENGTH);
    if (!name || !reference) continue;
    // Same key the recipe box files names under, so "Salsa Verde" and "salsa
    // verde" can't both come back as two things to import.
    const key = groceryNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, reference });
  }
  return result.slice(0, MAX_RECIPE_REFERENCES);
}

/**
 * The shopping-item array schema `extract_recipe` uses, factored out so the
 * invented-meal draft below (#1063) asks for the same shape and reads it back
 * through the same `parseExtractedItems` validator. Two prompts, one schema,
 * one parser — the prompts are what differ, and the shape they have to
 * produce must not.
 */
function groceryItemsSchema(availableAisles: string[], description: string) {
  return {
    type: 'array',
    description,
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: `What to buy, as it would be labelled in a shop — "garlic", not "3 cloves garlic, minced". Under ${GROCERY_NAME_MAX_LENGTH} characters.`,
        },
        quantity: {
          type: 'string',
          description: 'The recipe\'s own amount, as written, with any prep instruction moved to the "prep" field instead — "4 cloves", "2 cups", "1 tbsp", "2 tsp" — not a converted purchasable size ("1 bulb" for "4 cloves" is wrong). Abbreviate tablespoon/teaspoon as "tbsp"/"tsp". Empty string if the recipe does not say.',
        },
        aisle: {
          type: 'string',
          description: `Where to find it. Must be exactly one of: ${availableAisles.join(', ')}.`,
        },
        component: {
          type: 'string',
          description: 'The recipe\'s own label for the part this ingredient belongs to, e.g. "For the cake" or "For the frosting" — only when the source actually splits its ingredients that way. Empty string otherwise.',
        },
        prep: {
          type: 'string',
          description: `What to do to it before using it, in the recipe's own words — "pressed and cubed", "steamed 10 min", "minced" — the instruction dropped out of "name" and "quantity" above. Under ${PREP_MAX_LENGTH} characters. Empty string when the recipe states no prep for this item.`,
        },
      },
      required: ['name', 'quantity', 'aisle'],
    },
  };
}

export interface ExtractedPrepTask {
  /** Under TITLE_MAX_LENGTH. */
  title: string;
  /** Days before the meal this needs to start. Always negative. */
  offsetDays: number;
}

/** Same validation the shopping list gets, extended to a step's plain text. */
function parseExtractedSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const steps: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text) continue;
    steps.push(text);
  }
  return steps.slice(0, MAX_RECIPE_STEPS);
}

function parseExtractedPrepTasks(raw: unknown): ExtractedPrepTask[] {
  const items = raw as Array<{ title?: unknown; daysAhead?: unknown }> | undefined;
  if (!items) return [];
  const result: ExtractedPrepTask[] = [];
  for (const item of items) {
    if (typeof item?.title !== 'string') continue;
    const title = item.title.trim().slice(0, TITLE_MAX_LENGTH);
    if (!title) continue;
    const daysAhead = typeof item.daysAhead === 'number' && item.daysAhead > 0
      ? Math.round(item.daysAhead)
      : 1;
    result.push({ title, offsetDays: -Math.max(1, Math.min(MAX_PREP_DAYS_AHEAD, daysAhead)) });
  }
  return result.slice(0, MAX_RECIPE_PREP_TASKS);
}

/**
 * The four the Messages API accepts. `recipePhoto.ts` always re-encodes to JPEG,
 * so in practice only the first one is ever produced — the union exists so a
 * caller that already holds a PNG doesn't have to launder it through one.
 */
export type RecipeImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface RecipeImage {
  /** Bare base64 — no `data:` prefix. */
  base64: string;
  mediaType: RecipeImageMediaType;
}

/**
 * Pasted text, or a photo of the page it's printed on. Everything past the
 * message body — the tool, the schema, the validation — is identical for both,
 * which is the whole reason this is one function taking a union rather than two
 * functions sharing a helper.
 */
export type RecipeSource = string | RecipeImage;

export interface ExtractedRecipe {
  /** Empty when the text didn't give one. */
  name: string;
  /** Clamped 1–99; null when not stated. The low end of a range, if given. */
  servings: number | null;
  /** Clamped 1–99; null when the recipe doesn't give a range. Always > servings. */
  servingsMax: number | null;
  /** Null when not stated. */
  prepMinutes: number | null;
  /**
   * What the recipe makes when a serving count doesn't fit — "2 loaves", "3
   * cups", "2 dozen cookies". Independent of servings/servingsMax; a recipe
   * can give both. Null when not stated.
   */
  recipeYield: string | null;
  ingredients: RecipeGroceryItem[];
  /**
   * Where the source says it's from — the four fields that map onto `Recipe`'s
   * `source`/`author`/`sourcePage`/`sourceType`. All null for the overwhelming
   * majority of pastes, and that's the point: this is provenance the source
   * *states*, never a guess. A cookbook page carries its title on the running
   * head and its number in the corner, which is exactly the same class of fact
   * as a link import's `siteName` and is taken on the same terms (see
   * `referencePageNumber`'s note in `recipeImportComponents.ts`).
   *
   * A link import still prefers the page's own structured metadata over these
   * — markup is a statement, a model's read of body text is an inference — so
   * the sheets fall back to them rather than leading with them.
   */
  sourceTitle: string | null;
  sourceAuthor: string | null;
  sourcePage: string | null;
  sourceType: RecipeSourceType | null;
  /**
   * Other recipes this one tells you to go and make, printed elsewhere in the
   * same book or on the same site. Empty for the overwhelming majority of
   * sources; see `ExtractedRecipeReference`.
   */
  references: ExtractedRecipeReference[];
  /** The method, in order. Empty when `includeMethod` was false or none was found. */
  steps: string[];
  /** Only genuine advance-prep — see extractRecipe's prompt. Empty likewise. */
  prepTasks: ExtractedPrepTask[];
}

/**
 * The paragraphs that don't care where the recipe came from — shop-naming,
 * quantities, which aisle. Shared verbatim by both sources so a photo and a
 * paste can't drift into reading the ingredients differently.
 */
function sharedRecipeInstructions(availableAisles: string[]): string[] {
  return [
    'Name each shopping item the way a shop would label it, not the way the recipe prepares it — "garlic" rather than "3 cloves garlic, minced". Keep the recipe\'s own quantity and unit as stated, with the prep instruction moved to the "prep" field instead of "name" or "quantity" — "4 cloves" or "3 cloves", not "1 bulb", with "minced" in "prep". Never substitute your own guess at a purchasable equivalent; the recipe\'s stated amount is what the cook actually needs, and a bulb doesn\'t reliably yield a fixed number of cloves. Ignore the method when deciding what goes on the shopping list, and skip water.',
    `Sections available: ${availableAisles.join(', ')}. Use "Other" only when nothing else fits.`,
    'If the recipe\'s own ingredient list is split into labelled components — "For the cake" / "For the frosting", "For the marinade" / "For the dish" — carry that label into each item\'s "component" field. Leave it empty when the recipe lists everything as one plain list.',
  ];
}

/**
 * The paragraph asking which other recipes this one points at. Gated the same
 * way `methodInstructions` is, and for the same reason: `suggestRecipeGroceries`
 * has nowhere to put a component link, so it shouldn't pay for the ask.
 *
 * Separate from `sharedRecipeInstructions` rather than a fourth bullet in it
 * *because* of that gate — everything in there goes out on every call.
 */
function referenceInstructions(): string[] {
  return [
    'A recipe often calls for another recipe printed elsewhere and points you to it: "1 cup salsa verde (page 45)", "serve with the herb oil on p. 12", "uses the pizza dough from page 210". List each of those in "referencedRecipes", with the dish\'s own name and the source\'s own words for where to find it. Two rules: only list one when the source actually points somewhere else for it — "serve with rice" names no recipe and belongs nowhere near this list — and never list a part of this recipe\'s own ingredient list. "For the frosting" is the "component" field above; these are separate recipes with their own pages.',
  ];
}

/**
 * The paragraph asking where the recipe is from. Shared by both sources: a
 * pasted recipe carries a byline as often as a photographed page carries a
 * running head, and neither is any more of a guess than the other.
 *
 * The whole paragraph is about *refusing* to infer. A model asked where a
 * recipe came from will happily answer from taste — it knows which cookbook a
 * dish sounds like — and a plausible book title written into an attribution
 * field is worse than a blank one, because nothing downstream can tell it from
 * a title actually read off the page. Same standard `referencePageNumber`
 * holds a locator to: the source's own words, or nothing.
 */
function sourceInstructions(): string[] {
  return [
    'Separately from the recipe itself, record where it came from — but only from what the source actually shows you. A cookbook or magazine title printed on the running head, the title page, or the masthead goes in "sourceTitle"; a byline naming whose recipe it is goes in "sourceAuthor"; a page number printed on the page goes in "sourcePage"; and "sourceKind" says which kind of thing it is. Leave a field empty rather than working it out: a dish that sounds like a famous cook\'s is not a byline, a book you recognise from its typesetting is still a guess, and the recipe\'s own title is never the book\'s title. Most sources state none of these, and empty is the right answer for every one they don\'t.',
  ];
}

/**
 * The paragraphs asking for the method and any advance-prep tasks — shared by
 * both sources, only included when the caller actually wants them
 * (`suggestRecipeGroceries` doesn't, so it skips these to keep the response
 * shorter).
 */
function methodInstructions(): string[] {
  return [
    'Also pull out the method as an ordered list of separate steps, matching however the recipe itself divides them (numbered steps, one instruction per line or paragraph). Keep the wording close to the source rather than summarizing it, and never invent a step that isn\'t actually there.',
    'Separately, list any "prep tasks": things that genuinely have to be started well ahead of cooking because they need lead time to work — soaking dried beans or lentils overnight, marinating or brining meat overnight, thawing something frozen, letting a dough rest or proof overnight, activating a starter or sourdough the day before. Do NOT list routine same-day steps just because they happen early in the method — chopping vegetables, mixing dry ingredients, bringing something to room temperature for half an hour, preheating the oven. If nothing in the recipe genuinely needs advance lead time, return an empty list. For each one, say roughly how many days ahead it needs to start: 1 for "overnight" or "the night before", more only when the recipe is explicit about needing longer.',
  ];
}

/**
 * Pulls a whole recipe — name, servings, prep time, and the shopping list —
 * out of pasted text or a photo of the page.
 *
 * The one genuinely hard thing here that a parser can't do: recipe
 * ingredients are written for cooking, not for buying ("3 cloves garlic,
 * minced" names a shop item as "garlic", keeping the stated "3 cloves" —
 * never guessing a purchasable size like "1 bulb"), and the method section
 * has to be ignored.
 * `suggestRecipeGroceries` below is a thin wrapper over this — one prompt,
 * one schema, one validator — so GroceryAISheet's "From a recipe" mode keeps
 * working exactly as it did before this existed.
 *
 * A photo changes exactly two things: the message content becomes a block
 * array with the image first (the ordering Anthropic recommends for a single
 * image), and the instructions gain a paragraph about page furniture and one
 * about refusing to guess at an illegible shot. The text path still sends a
 * bare string, so its request body is byte-for-byte what it always was.
 *
 * **`includeReferences` gates the cross-references to other recipes** on the
 * same terms as `includeMethod` below: `suggestRecipeGroceries` has nowhere to
 * put a component link, so it doesn't ask for one.
 *
 * **`includeMethod` also decides whether the method/prep-tasks paragraphs and
 * schema fields are sent at all**, not just whether the result is read — a
 * caller with no use for them (`suggestRecipeGroceries`) shouldn't pay for a
 * longer response it's about to throw away. A link import runs this same text
 * path over the fetched page (see `useRecipeImportSource`), so a page with no
 * `schema.org` instructions still gets a model-read method as a fallback —
 * the review sheets prefer the page's own verbatim steps when both exist.
 */
export async function extractRecipe(
  source: RecipeSource,
  availableAisles: string[],
  options: { includeMethod?: boolean; includeReferences?: boolean; includeSource?: boolean } = {},
): Promise<ExtractedRecipe> {
  const { includeMethod = true, includeReferences = true, includeSource = true } = options;
  const { apiKey, model } = requireFeature('recipeExtraction');

  const empty: ExtractedRecipe = {
    name: '', servings: null, servingsMax: null, prepMinutes: null, recipeYield: null, ingredients: [],
    sourceTitle: null, sourceAuthor: null, sourcePage: null, sourceType: null,
    references: [], steps: [], prepTasks: [],
  };
  const image = typeof source === 'string' ? null : source;
  const text = typeof source === 'string' ? source.trim().slice(0, MAX_RECIPE_CHARS) : '';
  // Same "nothing in, no network call" guard for both sources.
  if (image ? !image.base64 : !text) return empty;

  const foundLine = `its shopping list${includeMethod ? ', and its method' : ''}`;
  // Page furniture is junk to the recipe and provenance to the book, so which
  // of the two this asks for depends on whether anyone is collecting the
  // second. Both versions keep it out of the name, ingredients and method —
  // that half was never in question.
  const pageFurniture = includeSource
    ? 'Keep anything that is not part of this recipe out of the recipe: headnotes and stories, photo captions, and text bleeding in from a facing page. Page numbers, running heads and chapter titles are not part of the recipe either, and must never appear in its name, ingredients or method — but they are what says where it came from, so read them into the source fields described below rather than discarding them.'
    : 'Ignore anything on the page that is not part of this recipe: page numbers, running heads, chapter titles, headnotes and stories, photo captions, and text bleeding in from a facing page.';
  const prompt = image
    ? [
        `This is a photo of a recipe — a cookbook page, a recipe card, a handwritten note, or a screen. Read it and extract the recipe: its name, how many it serves (or what it makes, if that's how the source states it — "2 loaves", "3 cups", "2 dozen cookies"), its total prep/cook time, and ${foundLine}.`,
        `${pageFurniture} If the page shows more than one recipe, extract only the most prominent one — the one whose title and ingredient list are most complete — and never merge ingredients across recipes. Ingredient lists are often set in two columns; read down each column rather than across.`,
        ...sharedRecipeInstructions(availableAisles),
        ...(includeSource ? sourceInstructions() : []),
        ...(includeReferences ? referenceInstructions() : []),
        ...(includeMethod ? methodInstructions() : []),
        'If the photo is too blurry, too dark, cut off, or otherwise unreadable, return an empty name and an empty item list rather than guessing. Never invent an ingredient, step, or prep task you cannot actually read.',
      ].join('\n\n')
    : [
        `Extract this recipe: its name, how many it serves (or what it makes, if that's how the source states it — "2 loaves", "3 cups", "2 dozen cookies"), its total prep/cook time, and ${foundLine}.`,
        ...sharedRecipeInstructions(availableAisles),
        ...(includeSource ? sourceInstructions() : []),
        ...(includeReferences ? referenceInstructions() : []),
        ...(includeMethod ? methodInstructions() : []),
        `Recipe:\n${text}`,
      ].join('\n\n');

  const content = image
    ? [
        {
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
        },
        { type: 'text', text: prompt },
      ]
    : prompt;

  const data = await callAnthropic({
    // A method with a full page of steps plus any prep tasks needs more room
    // than the shopping-list-only response this used to always be.
    max_tokens: includeMethod ? 3000 : 2000,
    tools: [{
      name: 'extract_recipe',
      description: `Extract a recipe's name, servings, prep time, and shopping list${includeMethod ? ', method, and prep tasks' : ''}`,
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: `The recipe's name/title, if the text gives one. Under ${RECIPE_NAME_MAX_LENGTH} characters. Empty string if not stated.`,
          },
          servings: {
            type: 'integer',
            description: 'How many people this serves, if stated. The low end when a range is given ("serves 4-6" -> 4). 0 if not stated.',
          },
          servingsMax: {
            type: 'integer',
            description: 'The high end of a servings range, if the recipe gives one ("serves 4-6" -> 6). 0 if the recipe states a single number or nothing at all.',
          },
          prepMinutes: {
            type: 'integer',
            description: 'Total prep/cook time in minutes, if stated. 0 if not stated.',
          },
          recipeYield: {
            type: 'string',
            description: `What the recipe makes, when that isn't a plain serving count — "2 loaves", "3 cups", "2 dozen cookies". Independent of servings: give both when the recipe states both ("serves 8" and "makes 2 loaves"). Under ${RECIPE_SOURCE_MAX_LENGTH} characters. Empty string if not stated or if it's just a serving count already captured in "servings".`,
          },
          items: groceryItemsSchema(
            availableAisles,
            'The things a shopper needs to buy for this recipe.',
          ),
          ...(includeSource ? {
            sourceTitle: {
              type: 'string',
              description: `The cookbook, magazine or site this recipe is printed in, exactly as the source gives it — "Nothing Fancy", "Bon Appétit", "NYT Cooking". Under ${RECIPE_SOURCE_MAX_LENGTH} characters. This is the book's title, never the recipe's own. Empty string unless the source actually shows it.`,
            },
            sourceAuthor: {
              type: 'string',
              description: `The person credited with the recipe, as the source bylines them — "Alison Roman". Under ${RECIPE_SOURCE_MAX_LENGTH} characters. Empty string unless the source actually names someone; never infer an author from the style of the food.`,
            },
            sourcePage: {
              type: 'string',
              description: `The page number printed on the page — "142", or "112-115" when the recipe runs across a spread. Digits only, no "p." prefix. Under ${RECIPE_PAGE_MAX_LENGTH} characters. Empty string when no page number is visible, and for anything that isn't a printed page.`,
            },
            sourceKind: {
              type: 'string',
              enum: [...RECIPE_SOURCE_TYPES],
              description: 'What kind of source this is, from how it looks and reads: "cookbook" for a book page, "magazine" for a magazine or newspaper spread, "website" for a printed or screenshotted web page, "homeRecipe" for a handwritten card or note, "other" for anything else. Empty string if you genuinely cannot tell.',
            },
          } : {}),
          ...(includeReferences ? {
            referencedRecipes: {
              type: 'array',
              description: 'Other recipes this one tells you to make, printed elsewhere in the same book or site. Empty array when the source points at nothing.',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: `The referenced recipe's own title, as the source prints it — "Salsa verde", not "the salsa". Under ${RECIPE_NAME_MAX_LENGTH} characters.`,
                  },
                  reference: {
                    type: 'string',
                    description: 'Where the source says to find it, in its own words: "page 45", "p. 212", "pages 112-115". Leave the whole entry out if the source names a dish but never says where its recipe is.',
                  },
                },
                required: ['name', 'reference'],
              },
            },
          } : {}),
          ...(includeMethod ? {
            steps: {
              type: 'array',
              description: `The method, as an ordered list of steps in the recipe's own words. Under ${MAX_RECIPE_STEPS} steps. Empty array if no method is given.`,
              items: { type: 'string' },
            },
            prepTasks: {
              type: 'array',
              description: 'Only genuine advance-prep that needs to start well ahead of cooking — never routine same-day prep. Empty array when nothing needs advance lead time.',
              items: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description: `What to do, e.g. "Soak the beans overnight". Under ${TITLE_MAX_LENGTH} characters.`,
                  },
                  daysAhead: {
                    type: 'integer',
                    description: 'How many days before cooking this needs to start. 1 for "overnight" or "the night before".',
                  },
                },
                required: ['title', 'daysAhead'],
              },
            },
          } : {}),
        },
        required: ['name', 'items'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_recipe' },
    messages: [{ role: 'user', content }],
  }, apiKey, model, image ? IMAGE_REQUEST_TIMEOUT_MS : undefined);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as {
    name?: unknown; servings?: unknown; servingsMax?: unknown; prepMinutes?: unknown; recipeYield?: unknown; items?: unknown;
    sourceTitle?: unknown; sourceAuthor?: unknown; sourcePage?: unknown; sourceKind?: unknown;
    referencedRecipes?: unknown; steps?: unknown; prepTasks?: unknown;
  } | undefined;
  if (!input) throw new Error('No suggestions returned');

  const name = typeof input.name === 'string' ? input.name.trim().slice(0, RECIPE_NAME_MAX_LENGTH) : '';
  const servings = typeof input.servings === 'number' && input.servings > 0
    ? Math.max(1, Math.min(99, Math.round(input.servings)))
    : null;
  const rawMax = typeof input.servingsMax === 'number' && input.servingsMax > 0
    ? Math.max(1, Math.min(99, Math.round(input.servingsMax)))
    : null;
  // Only a real range, and only alongside a low end it actually exceeds —
  // same rule useRecipeStore.setServings enforces on manual entry.
  const servingsMax = servings !== null && rawMax !== null && rawMax > servings ? rawMax : null;
  const prepMinutes = typeof input.prepMinutes === 'number' && input.prepMinutes > 0
    ? Math.round(input.prepMinutes)
    : null;
  const recipeYield = typeof input.recipeYield === 'string' && input.recipeYield.trim()
    ? input.recipeYield.trim().slice(0, RECIPE_SOURCE_MAX_LENGTH)
    : null;

  const sourceTitle = includeSource ? parseExtractedSourceTitle(input.sourceTitle, name) : null;
  const sourceAuthor = includeSource ? sourceField(input.sourceAuthor) : null;
  const sourcePage = includeSource ? parseExtractedSourcePage(input.sourcePage) : null;
  const sourceType = includeSource && RECIPE_SOURCE_TYPES.includes(input.sourceKind as RecipeSourceType)
    ? (input.sourceKind as RecipeSourceType)
    : null;

  return {
    name, servings, servingsMax, prepMinutes, recipeYield,
    sourceTitle, sourceAuthor, sourcePage, sourceType,
    ingredients: parseExtractedItems(input.items, availableAisles),
    references: includeReferences ? parseExtractedReferences(input.referencedRecipes) : [],
    steps: includeMethod ? parseExtractedSteps(input.steps) : [],
    prepTasks: includeMethod ? parseExtractedPrepTasks(input.prepTasks) : [],
  };
}

/** An attribution string as the store would keep it, or null for "not stated". */
function sourceField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, RECIPE_SOURCE_MAX_LENGTH) || null;
}

/**
 * The book's title, refused when it's just the recipe's own title read twice.
 *
 * A page whose running head is the chapter rather than the book ("Weeknight
 * Dinners") gives the model nothing to put here, and the most available string
 * on the page is the dish's own name — so "Chocolate cake, from Chocolate
 * cake" is the shape this fails in. The prompt says not to; this makes it not
 * matter, because an attribution that merely repeats the recipe is worth
 * strictly less than a blank one the user can fill in.
 */
function parseExtractedSourceTitle(value: unknown, recipeName: string): string | null {
  const title = sourceField(value);
  if (!title || !recipeName) return title;
  return groceryNameKey(title) === groceryNameKey(recipeName) ? null : title;
}

/**
 * A printed page number. Kept only when it actually looks like one: a number,
 * a range across a spread, or the roman numerals a front-matter page carries.
 *
 * `Recipe.sourcePage` is free text because some books print "xii", so nothing
 * downstream will reject a bad value — it just renders as "p. see overleaf" in
 * the byline. Same refusal `referencePageNumber` makes for a locator that
 * names no page, applied at the other end of the same pipe.
 */
function parseExtractedSourcePage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Some models restore the "p." the schema asked them to leave off.
  const bare = value.trim().replace(/^(?:pages?|pgs?|p)\.?\s*/i, '').trim();
  if (!/^[0-9ivxlcdm]+(?:\s*[-–—]\s*[0-9ivxlcdm]+)?$/i.test(bare)) return null;
  return bare.replace(/\s*[-–—]\s*/, '-').slice(0, RECIPE_PAGE_MAX_LENGTH);
}

/**
 * Pulls just the shopping items out of a pasted or photographed recipe —
 * GroceryAISheet's "From a recipe" mode, which has no use for the
 * name/servings/prep time, or the method.
 */
export async function suggestRecipeGroceries(
  source: RecipeSource,
  availableAisles: string[],
): Promise<RecipeGroceryItem[]> {
  const extracted = await extractRecipe(source, availableAisles, {
    includeMethod: false,
    includeReferences: false,
    // Nowhere to put an attribution either — same reason the method is off.
    includeSource: false,
  });
  return extracted.ingredients;
}

// ─── Meal ideas from nothing (#1063) ────────────────────────────────────────

/** Free-text nudge ("something quick", "no pork") — a sentence, not an essay. */
const MAX_MEAL_HINT_CHARS = 200;
/** Planned/recent dinners named in the prompt. A fortnight of context, not a year of it. */
const MAX_MEAL_CONTEXT_TITLES = 20;
/** About-to-expire kitchen items offered as inspiration. A handful, not the whole pantry. */
const MAX_EXPIRING_ITEMS = 8;

/**
 * Invents meal ideas for the empty nights of a week.
 *
 * The one thing this does that nothing else in the app does: it makes up a
 * dish the user doesn't own. `suggestRecipesForEmptyNight` (offline, no key,
 * always available) ranks recipes they already have against what's in their
 * grocery catalog and invents nothing — this is the other half, and it's why
 * the two are kept apart all the way down: ideas from here may only ever be
 * shown *after* that ranking, never instead of it (`mergeMealSuggestions`).
 *
 * Bounds and the case-insensitive dedupe are `suggestTemplateItems`' — asked
 * for in the schema and enforced on the way back by `dedupeMealIdeas`, which
 * also drops anything colliding with a title the caller already knows about.
 *
 * `expiringItems` (`mealIdeas.expiringItemHints`, off `useUpEntries`) is
 * inspiration, not a constraint the model is asked to satisfy — the prompt
 * says so explicitly. Left as a hard requirement, this would do exactly what
 * the offline "Use it up" shelf refuses to (see `useUpRecipes.ts`'s own
 * comment on a wrong suggestion costing more than a missing one): a forced
 * dish is worse than no suggestion at all, so the wording only ever asks for
 * a genuinely good one that happens to use something dying, never a stretch.
 */
export async function suggestMealIdeas(
  plannedTitles: string[],
  recentTitles: string[],
  slotsToFill: number,
  hints?: string,
  expiringItems: readonly string[] = [],
): Promise<MealIdea[]> {
  const { apiKey, model } = requireFeature('mealIdeas');

  const planned = plannedTitles.map(t => t.trim()).filter(Boolean).slice(0, MAX_MEAL_CONTEXT_TITLES);
  const recent = recentTitles.map(t => t.trim()).filter(Boolean).slice(0, MAX_MEAL_CONTEXT_TITLES);
  const expiring = expiringItems.map(t => t.trim()).filter(Boolean).slice(0, MAX_EXPIRING_ITEMS);
  const nudge = (hints ?? '').trim().slice(0, MAX_MEAL_HINT_CHARS);
  const wanted = clampIdeaCount(slotsToFill);

  const plannedPart = planned.length > 0
    ? `Already planned for this week — do NOT repeat or rephrase any of these:\n${planned.map(t => `- ${t}`).join('\n')}`
    : 'Nothing is planned for this week yet.';
  const recentPart = recent.length > 0
    ? `Cooked in the last few weeks — avoid these too, but they are a fair guide to the kind of cooking that gets done here:\n${recent.map(t => `- ${t}`).join('\n')}`
    : 'There is no recent cooking history to go on, so keep the ideas broad and unfussy.';
  const expiringPart = expiring.length > 0
    ? `A few things in the kitchen are close to going bad, for inspiration:\n${expiring.map(t => `- ${t}`).join('\n')}\nIf a genuinely good dish uses one or two of these — even a creative or unexpected use — that's a welcome bonus. But never force one in where it doesn't belong just to use it up, and a dish that ignores this list entirely is completely fine.`
    : '';

  const data = await callAnthropic({
    max_tokens: 800,
    tools: [{
      name: 'suggest_meals',
      description: 'Return a list of meal ideas to fill the empty nights of a week',
      input_schema: {
        type: 'object',
        properties: {
          meals: {
            type: 'array',
            description: `Between ${MIN_MEAL_IDEAS} and ${MAX_MEAL_IDEAS} meal ideas. Aim for ${wanted}.`,
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: `The name of one dish, the way someone would say it at the table — "Lemon chicken traybake", not "Chicken" and not "Italian night". Under ${RECIPE_NAME_MAX_LENGTH} characters.`,
                },
                blurb: {
                  type: 'string',
                  description: 'One short line saying what it actually is, so someone who has never made it can tell whether they want it. No marketing language.',
                },
              },
              required: ['title', 'blurb'],
            },
          },
        },
        required: ['meals'],
      },
    }],
    tool_choice: { type: 'tool', name: 'suggest_meals' },
    messages: [{
      role: 'user',
      content: [
        `Suggest ${wanted} dinners for a home cook filling in the empty nights of their week.`,
        'Each one must be a specific, cookable dish a home cook could shop for and make on a weeknight — not a cuisine, not a category, not a theme. Favour everyday cooking over restaurant cooking, and vary the ideas across the set rather than offering the same dish three ways.',
        plannedPart,
        recentPart,
        expiringPart,
        nudge ? `What they asked for: ${nudge}` : '',
      ].filter(Boolean).join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { meals?: RawMealIdea[] } | undefined;
  if (!input?.meals) throw new Error('No suggestions returned');

  return dedupeMealIdeas(input.meals, [...planned, ...recent]);
}

export interface DraftedMealRecipe {
  ingredients: RecipeGroceryItem[];
  /** The method, in order. Empty when the name was too vague to cook at all. */
  steps: string[];
  /** Only genuine advance-prep — see the prompt below for the same rule `extractRecipe` uses. */
  prepTasks: ExtractedPrepTask[];
}

/**
 * Drafts a full recipe for a meal that has no written one — "leftovers" or a
 * just-invented idea turned into something you can actually cook, not just
 * shop for.
 *
 * Deliberately the same ingredient shape, the same aisle clamp and the same
 * `parseExtractedItems`/`parseExtractedSteps`/`parseExtractedPrepTasks`
 * validators as `extractRecipe` (see `groceryItemsSchema`): the difference
 * between reading a recipe and inventing one belongs in the prompt, not in a
 * second output format for the same kind of answer. That's what lets an
 * accepted idea go straight into `addStructuredIngredients`/`addStep`/
 * `addPrepTask` alongside an imported one, and what keeps the two prompts
 * from drifting on what counts as a "prep task" versus routine same-day prep.
 *
 * `servings`/`servingsMax` and `recipeYield` are deliberately not asked for
 * here the way `extractRecipe` asks for them: those fields report what a
 * *written* recipe states, and there's nothing to read — the prompt already
 * tells the model exactly how many to feed, so the caller writes that same
 * number rather than trusting the model to echo it back.
 *
 * No time estimate either, unlike `extractRecipe`'s `prepMinutes` — that one
 * is reading a number the source actually printed; this would be the model
 * guessing at a total for a dish it just made up, which isn't a number worth
 * shipping.
 */
export async function draftMealRecipe(
  mealName: string,
  availableAisles: string[],
  servings: number | null,
): Promise<DraftedMealRecipe> {
  const { apiKey, model } = requireFeature('mealIdeas');

  const empty: DraftedMealRecipe = { ingredients: [], steps: [], prepTasks: [] };
  const name = mealName.trim().slice(0, RECIPE_NAME_MAX_LENGTH);
  // Nothing in, no network call — same guard extractRecipe makes on an empty
  // paste.
  if (!name) return empty;
  const serves = servings && servings > 0 ? Math.min(99, Math.round(servings)) : 4;

  const data = await callAnthropic({
    // A method plus any prep tasks needs more room than the shopping-list-only
    // response this used to always be — same bump extractRecipe makes for
    // includeMethod.
    max_tokens: 2500,
    tools: [{
      name: 'draft_recipe',
      description: 'Draft a full recipe — shopping list and method — for a meal that has no written recipe',
      input_schema: {
        type: 'object',
        properties: {
          items: groceryItemsSchema(
            availableAisles,
            'The things a shopper needs to buy to cook this meal.',
          ),
          steps: {
            type: 'array',
            description: `The method, as an ordered list of separate steps a home cook could actually follow — brief and specific, the way a recipe states them. Under ${MAX_RECIPE_STEPS} steps. Empty array if the name is too vague to cook at all.`,
            items: { type: 'string' },
          },
          prepTasks: {
            type: 'array',
            description: 'Only genuine advance-prep that needs to start well ahead of cooking — never routine same-day prep. Empty array when nothing needs advance lead time.',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: `What to do, e.g. "Soak the beans overnight". Under ${TITLE_MAX_LENGTH} characters.`,
                },
                daysAhead: {
                  type: 'integer',
                  description: 'How many days before cooking this needs to start. 1 for "overnight" or "the night before".',
                },
              },
              required: ['title', 'daysAhead'],
            },
          },
        },
        required: ['items', 'steps'],
      },
    }],
    tool_choice: { type: 'tool', name: 'draft_recipe' },
    messages: [{
      role: 'user',
      content: [
        `Write a full home-cooked recipe for a meal called "${name}". There is no written recipe — draft a straightforward home version of it: what to buy and how to make it.`,
        `Quantities should feed ${serves}. Give the amount in the quantity field, and name each item the way a shop would label it, not the way the dish prepares it — "garlic" rather than "3 cloves garlic, minced". Abbreviate tablespoon/teaspoon as "tbsp"/"tsp".`,
        'Cover what the dish genuinely needs and stop there: the everyday version rather than an elaborate one, no optional garnishes, and skip water. Include salt, pepper and cooking oil only when the dish actually turns on them.',
        `Sections available: ${availableAisles.join(', ')}. Use "Other" only when nothing else fits.`,
        'Write the method as an ordered list of steps a home cook could actually follow — plain and specific, not padded with commentary.',
        'Separately, list any "prep tasks": things that genuinely have to start well ahead of cooking because they need lead time — soaking dried beans overnight, marinating or brining meat overnight, thawing something frozen, proofing a dough overnight. Do NOT list routine same-day steps just because they happen early in the method — chopping vegetables, mixing dry ingredients, preheating the oven. Return an empty list when nothing needs advance lead time.',
        'If the name is too vague to cook at all, return an empty ingredient list and an empty method rather than guessing at a dish.',
      ].join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as {
    items?: unknown; steps?: unknown; prepTasks?: unknown;
  } | undefined;
  if (!input) throw new Error('No suggestions returned');

  return {
    ingredients: parseExtractedItems(input.items, availableAisles),
    steps: parseExtractedSteps(input.steps),
    prepTasks: parseExtractedPrepTasks(input.prepTasks),
  };
}

// ─── Substitute suggestions (#1578) ─────────────────────────────────────────

/**
 * Proposes what to use instead of a grocery item — the AI half of "what can I
 * use instead?" (#1578). Additive only: `SubstituteSheet`'s offline "from your
 * items" search is a complete answer on its own, and this just puts a
 * best-guess list on top of it when a key is configured.
 *
 * `dedupeSuggestedSubstitutes` is what turns the raw response into offerable
 * rows — dropping anything naming more than one ingredient, capping the
 * count, and dropping whatever `excludedNames` already names (the item
 * itself, and whatever it's already linked to).
 */
export async function suggestSubstitutes(
  itemName: string,
  excludedNames: string[],
): Promise<SuggestedSubstitute[]> {
  const { apiKey, model } = requireFeature('substitutes');

  const name = itemName.trim().slice(0, GROCERY_NAME_MAX_LENGTH);
  if (!name) return [];
  const excluded = excludedNames.map(n => n.trim()).filter(Boolean);

  const data = await callAnthropic({
    max_tokens: 600,
    tools: [{
      name: 'suggest_substitutes',
      description: 'Suggest common grocery items that could stand in for another when it\'s unavailable',
      input_schema: {
        type: 'object',
        properties: {
          substitutes: {
            type: 'array',
            description: `Up to ${MAX_SUGGESTED_SUBSTITUTES} single-item stand-ins for "${name}", best first.`,
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'A single grocery item, e.g. "Margarine". Never two items joined by "and"/"+"/a slash — a combination is a recipe, not a substitute.',
                },
                ratio_from: {
                  type: 'string',
                  description: `Optional. An amount of "${name}" this conversion is written for, e.g. "1 clove". Omit entirely unless the two really do have a stable, statable ratio.`,
                },
                ratio_to: {
                  type: 'string',
                  description: 'Optional. The equivalent amount of the substitute, e.g. "1/4 tsp". Give both ratio fields or neither.',
                },
              },
              required: ['name'],
            },
          },
        },
        required: ['substitutes'],
      },
    }],
    tool_choice: { type: 'tool', name: 'suggest_substitutes' },
    messages: [{
      role: 'user',
      content: [
        `What could a home cook use instead of "${name}" when it's not available?`,
        'Only genuinely common substitutes an ordinary cook would recognise — not an ingredient list for making it from scratch, and not a stretch.',
        'Each suggestion must be a single grocery item on its own, never a combination of two.',
        'Return each item in lowercase, as though it were appearing in the middle of a sentence — so generic items like "vinegar" stay lowercase, but proper nouns like "Parmigiano-Reggiano" stay capitalized.',
        excluded.length > 0 ? `Already recorded — don't repeat: ${excluded.join(', ')}.` : '',
      ].filter(Boolean).join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { substitutes?: RawSuggestedSubstitute[] } | undefined;
  if (!input?.substitutes) throw new Error('No suggestions returned');

  return dedupeSuggestedSubstitutes(input.substitutes, [name, ...excluded]);
}

/**
 * How many lines of one receipt are worth reading. A big weekly shop is around
 * sixty; the cap exists so a photo of a CVS receipt can't spend the whole
 * completion budget on loyalty copy.
 */
const MAX_RECEIPT_LINES = 100;

export interface ReceiptLine {
  /**
   * The line exactly as printed, abbreviations and all ("GV MLK 2% GAL").
   *
   * Kept verbatim and always shown, because the whole review step turns on it:
   * `name` below is the model's reading of this, and the only way anyone can
   * check that reading is against the words on the paper in their hand.
   */
  label: string;
  /**
   * The same line as a shopper would say it — "milk". This is what gets matched
   * against the list, and asking for it here rather than expanding the
   * abbreviations ourselves is deliberate: a receipt's shorthand is
   * store-specific, unbounded and drifts, so an offline lexicon of it would be
   * a guess-machine we'd be maintaining for ever. A vision model is already
   * reading the page and is good at exactly this.
   */
  name: string;
  /** As printed on the line ("1.32 lb", "2"); empty when the line doesn't say. */
  quantity: string;
  /**
   * Minor units, or null when the line's price couldn't be read as one. Parsed
   * with `parsePriceInput` — the same reader a hand-typed price goes through —
   * so a discount line's negative and a garbled "3.4B" are refusals here for
   * exactly the reasons they're refusals there, rather than a second opinion
   * about what a price is.
   */
  priceMinor: number | null;
}

export interface ExtractedReceipt {
  /** The store as printed on the header, empty when it doesn't name one. */
  storeName: string;
  /** Every line the receipt charged for, in printed order. */
  lines: ReceiptLine[];
  /**
   * The printed total in minor units, null when unread.
   *
   * Nothing reconciles against this and nothing should — a receipt's total
   * includes tax, deposits and discounts that never become list rows, so a sum
   * that doesn't match is the normal case rather than a sign the read went
   * wrong. It's here to be *shown*, so someone can tell at a glance whether the
   * photo that was read is the receipt they meant.
   */
  totalMinor: number | null;
  /**
   * The date printed on the receipt, `YYYY-MM-DD`, or null when it wasn't
   * readable. This is when the shop actually happened — most receipts print
   * one, usually in the header or footer — and it's what a scanned trip
   * should be dated with instead of the moment someone got round to scanning
   * it. Read but never trusted outright: `ReceiptImportSheet` is where it's
   * shown and, when it looks implausible, corrected — see
   * `isPlausibleReceiptDate`.
   */
  date: string | null;
}

/**
 * Reads a photo of a store receipt into the store's name and the lines it
 * charged for.
 *
 * This is the "what did I actually buy, and what did it cost" half of a trip,
 * which the app could otherwise only learn by someone typing a price per row
 * into the finish sheet. The receipt already has all of it.
 *
 * **It extracts; it never decides.** Nothing here matches a line to a list row,
 * ticks anything off or names a store id — that's `receiptMatch.ts`, offline
 * and tested, and the user confirms its answers before a single row is
 * written. The split is the same one `extractRecipe` makes, and it matters more
 * here because the thing on the other side of the confirm (`finishShopping`)
 * takes a whole list off in one go.
 *
 * The prompt spends most of its length on what *isn't* an item, because a
 * receipt is mostly not items: totals, tax, tender, change, loyalty numbers,
 * store addresses and a paragraph about a survey. Every one of those read as a
 * line would arrive as an unmatched row for the user to dismiss by hand.
 */
export async function extractReceipt(image: RecipeImage): Promise<ExtractedReceipt> {
  const { apiKey, model } = requireFeature('receiptImport');

  const empty: ExtractedReceipt = { storeName: '', lines: [], totalMinor: null, date: null };
  // Same "nothing in, no network call" guard the recipe path uses.
  if (!image.base64) return empty;

  const prompt = [
    'This is a photo of a store receipt. Read it and extract the store\'s name, the date it was printed, and every line it charged for.',
    'The date is when the purchase actually happened, not today\'s date — receipts print it in the header or footer, often next to a time or a transaction number. Give it as YYYY-MM-DD. Leave it empty if the receipt does not print one or it is not legible.',
    'Include only lines that are a thing that was bought. Skip subtotals, totals, tax, tender and change, card and authorization details, loyalty and membership numbers, store address and phone, cashier and register numbers, survey invitations, coupons and discount lines, bag fees, and bottle deposits.',
    'For each item give three things: the line exactly as printed including its abbreviations ("GV MLK 2% GAL"); what it plainly is, named the way a shopper would say it and would write it on a shopping list ("milk"); and the amount the line names if it gives one ("1.32 lb", "2").',
    'The price is the amount that line was charged, which on a weighed line is the total for the weight rather than the price per pound. Give it exactly as printed, with a decimal point and no currency symbol ("3.48").',
    'Receipts abbreviate hard and inconsistently. Read the abbreviation as the product it stands for when you can ("BNLS SKNLS CHKN BRST" is "chicken breast", "SHRP CHDR" is "sharp cheddar"). When a line is genuinely unreadable or you cannot tell what it stands for, copy the printed text into both fields rather than inventing a product.',
    'If the photo is too blurry, too dark, cut off, or is not a receipt at all, return an empty store name and an empty line list rather than guessing.',
  ].join('\n\n');

  const data = await callAnthropic({
    max_tokens: 4000,
    tools: [{
      name: 'extract_receipt',
      description: 'Extract a store receipt\'s store name, purchased lines, and total',
      input_schema: {
        type: 'object',
        properties: {
          storeName: {
            type: 'string',
            description: 'The store\'s name as printed on the receipt, without a branch number or address ("Trader Joe\'s", not "TRADER JOE\'S #453"). Empty string if the receipt does not name one.',
          },
          total: {
            type: 'string',
            description: 'The receipt\'s printed grand total, exactly as printed, with a decimal point and no currency symbol. Empty string if not printed or not readable.',
          },
          date: {
            type: 'string',
            description: 'The date the receipt was printed, as YYYY-MM-DD — when the purchase happened, not today. Empty string if the receipt does not print one or it is not legible.',
          },
          lines: {
            type: 'array',
            description: 'Every line the receipt charged for, in printed order.',
            items: {
              type: 'object',
              properties: {
                label: {
                  type: 'string',
                  description: `The line exactly as printed, abbreviations included. Under ${GROCERY_NAME_MAX_LENGTH} characters.`,
                },
                name: {
                  type: 'string',
                  description: `What the line plainly is, as a shopper would write it on a list — "milk", "chicken breast", "bananas". No brand, no size, no packaging. Under ${GROCERY_NAME_MAX_LENGTH} characters.`,
                },
                quantity: {
                  type: 'string',
                  description: 'The amount the line names, as printed — "1.32 lb", "2", "12 oz". Empty string when the line does not give one.',
                },
                price: {
                  type: 'string',
                  description: 'What this line was charged, exactly as printed, with a decimal point and no currency symbol ("3.48"). Empty string if unreadable.',
                },
              },
              required: ['label', 'name', 'price'],
            },
          },
        },
        required: ['storeName', 'lines'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_receipt' },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
        },
        { type: 'text', text: prompt },
      ],
    }],
  }, apiKey, model, IMAGE_REQUEST_TIMEOUT_MS);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as {
    storeName?: unknown; total?: unknown; date?: unknown; lines?: unknown;
  } | undefined;
  if (!input) throw new Error('No suggestions returned');

  return {
    storeName: typeof input.storeName === 'string'
      ? input.storeName.trim().slice(0, SHOP_NAME_MAX_LENGTH)
      : '',
    totalMinor: typeof input.total === 'string' ? parsePriceInput(input.total) : null,
    date: typeof input.date === 'string' ? parseReceiptDate(input.date) : null,
    lines: parseReceiptLines(input.lines),
  };
}

/**
 * Validates the model's date string into a real `YYYY-MM-DD`, or null.
 *
 * A model can return well-formed-looking nonsense ("2026-13-40"), so the
 * shape check alone isn't enough — this also confirms the string round-trips
 * through a real calendar date before anything downstream trusts it as one.
 */
function parseReceiptDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

/**
 * Validates the model's line array into `ReceiptLine`s.
 *
 * Deliberately *not* deduped, unlike `parseExtractedItems` — a receipt listing
 * milk twice is someone who bought two, each with its own price, and collapsing
 * them would silently drop one of the two numbers this feature exists to
 * capture. Matching is where the second one is dealt with, in front of the user.
 */
function parseReceiptLines(raw: unknown): ReceiptLine[] {
  if (!Array.isArray(raw)) return [];
  const result: ReceiptLine[] = [];
  for (const line of raw) {
    if (typeof line?.label !== 'string' && typeof line?.name !== 'string') continue;
    const label = typeof line.label === 'string'
      ? line.label.trim().slice(0, GROCERY_NAME_MAX_LENGTH)
      : '';
    const name = typeof line.name === 'string'
      ? line.name.trim().slice(0, GROCERY_NAME_MAX_LENGTH)
      : '';
    // A line with neither is nothing to show and nothing to match; a line with
    // only one of the two falls back to the other, since both are readable
    // English to a person holding the receipt.
    if (!label && !name) continue;
    result.push({
      label: label || name,
      name: name || label,
      quantity: typeof line.quantity === 'string'
        ? line.quantity.trim().slice(0, GROCERY_QUANTITY_MAX_LENGTH)
        : '',
      priceMinor: typeof line.price === 'string' ? parsePriceInput(line.price) : null,
    });
  }
  return result.slice(0, MAX_RECEIPT_LINES);
}

const MAX_CALENDAR_EVENTS = 20;
// Mirrors MAX_RECIPE_CHARS — a confirmation page is rarely longer than a
// recipe, and a runaway paste shouldn't balloon the request.
const MAX_CALENDAR_TEXT_CHARS = 6_000;

export interface ExtractedCalendarEvent {
  title: string;
  /** YYYY-MM-DD, or null when no date was legible. */
  date: string | null;
  /** 24-hour HH:MM, or null for an all-day event or one with no time given. */
  time: string | null;
  /** A physical address or venue name. Empty string when there is none. */
  location: string;
  /** A phone number, confirmation number, or prep note. Empty string when there's nothing to add. */
  notes: string;
}

/**
 * Reads a title, date, time, location and any other worthwhile detail out of
 * pasted confirmation text or a photo of one — a doctor's appointment page,
 * a restaurant reservation, a leg of a travel itinerary.
 *
 * Same split as extractRecipe/extractReceipt: text or a photo resolve to the
 * same prompt shape and the same tool schema, so a paste and a screenshot of
 * the same page read identically. Returns an array, unlike either of those
 * two, because a single page often confirms more than one event — a flight
 * followed by the hotel booked alongside it — and asking again per leg would
 * cost a second screenshot of the same page.
 */
export async function extractCalendarEvents(source: string | RecipeImage): Promise<ExtractedCalendarEvent[]> {
  const { apiKey, model } = requireFeature('calendarImport');

  const image = typeof source === 'string' ? null : source;
  const text = typeof source === 'string' ? source.trim().slice(0, MAX_CALENDAR_TEXT_CHARS) : '';
  // Same "nothing in, no network call" guard extractRecipe/extractReceipt use.
  if (image ? !image.base64 : !text) return [];

  const eventFields = [
    'For each event give: its title, in a few words a person would recognize on their own calendar ("Dentist appointment", "Flight to Chicago", "Dinner at Marea") — not the page\'s own heading verbatim when that heading is generic ("Appointment Details", "Booking Confirmed").',
    'Its date, as YYYY-MM-DD, and its time as 24-hour HH:MM — only when a specific time is actually stated. Leave the time empty for an all-day event or a date given with no time.',
    'Its location: a physical address or venue name, exactly as given. Empty string when the event has no physical location (a phone call, a virtual meeting) or none is stated.',
    'Anything else worth keeping, in one short line: a phone number, a confirmation or reservation number, what to bring or do to prepare. Empty string if there is nothing beyond what the other fields already capture.',
  ];
  const prompt = image
    ? [
        'This is a photo of an appointment confirmation, a booking, a ticket, or a travel itinerary. Read it and extract every distinct event it confirms — a single appointment is one event; an itinerary naming a flight and a hotel is two.',
        ...eventFields,
        'If the photo is too blurry, too dark, cut off, or isn\'t a confirmation of anything, return an empty list rather than guessing.',
      ].join('\n\n')
    : [
        'Read this pasted text and extract every distinct event it confirms — a single appointment is one event; an itinerary naming a flight and a hotel is two.',
        ...eventFields,
        'If nothing here confirms an event, return an empty list rather than guessing.',
        `Text:\n${text}`,
      ].join('\n\n');

  const content = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
        { type: 'text', text: prompt },
      ]
    : prompt;

  const data = await callAnthropic({
    max_tokens: 2000,
    tools: [{
      name: 'extract_calendar_events',
      description: 'Extract every event confirmed by this appointment, booking, or itinerary',
      input_schema: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            description: 'Every distinct event found, in the order they appear.',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: `A short recognizable title for the event. Under ${TITLE_MAX_LENGTH} characters.`,
                },
                date: {
                  type: 'string',
                  description: 'The event\'s date, as YYYY-MM-DD. Empty string if no date is legible.',
                },
                time: {
                  type: 'string',
                  description: 'The event\'s time, as 24-hour HH:MM. Empty string for an all-day event or when no specific time is given.',
                },
                location: {
                  type: 'string',
                  description: 'A physical address or venue name, exactly as given. Empty string if there is none.',
                },
                notes: {
                  type: 'string',
                  description: 'A phone number, confirmation number, or prep instructions, in one short line. Empty string if there is nothing beyond the other fields.',
                },
              },
              required: ['title', 'date', 'time', 'location', 'notes'],
            },
          },
        },
        required: ['events'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_calendar_events' },
    messages: [{ role: 'user', content }],
  }, apiKey, model, image ? IMAGE_REQUEST_TIMEOUT_MS : undefined);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { events?: unknown } | undefined;
  if (!input) throw new Error('No suggestions returned');

  return parseExtractedCalendarEvents(input.events);
}

/**
 * Validates the model's date string into a real `YYYY-MM-DD`, or null — same
 * check parseReceiptDate makes above, and for the same reason: a model can
 * return well-formed-looking nonsense ("2026-13-40").
 */
function parseExtractedEventDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

/** Validates the model's time string into a real 24-hour `HH:MM`, or null. */
function parseExtractedEventTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${match[2]}`;
}

/**
 * Validates the model's event array into `ExtractedCalendarEvent`s.
 *
 * A title is the one thing every kept event must have — a row with a date
 * and a location but nothing a person recognizes as "what is this" isn't
 * worth showing. Date, time, location and notes are all independently
 * optional; a page that gives a place but never states a time is common
 * (many all-day or "sometime that day" bookings) and shouldn't be dropped
 * for it.
 */
function parseExtractedCalendarEvents(raw: unknown): ExtractedCalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  const result: ExtractedCalendarEvent[] = [];
  for (const event of raw) {
    const title = typeof event?.title === 'string' ? event.title.trim().slice(0, TITLE_MAX_LENGTH) : '';
    if (!title) continue;
    result.push({
      title,
      date: parseExtractedEventDate(event.date),
      time: parseExtractedEventTime(event.time),
      location: typeof event.location === 'string' ? event.location.trim() : '',
      notes: typeof event.notes === 'string' ? event.notes.trim() : '',
    });
  }
  return result.slice(0, MAX_CALENDAR_EVENTS);
}
