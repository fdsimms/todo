import type { Effort } from '../types';
import {
  TITLE_MAX_LENGTH,
  GROCERY_NAME_MAX_LENGTH,
  GROCERY_QUANTITY_MAX_LENGTH,
  RECIPE_NAME_MAX_LENGTH,
  RECIPE_SECTION_MAX_LENGTH,
} from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import {
  clampIdeaCount, dedupeMealIdeas, MAX_MEAL_IDEAS, MIN_MEAL_IDEAS,
  type MealIdea, type RawMealIdea,
} from '../utils/mealIdeas';
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
/** Characters of recipe text we'll send. Roughly a long recipe including method. */
const MAX_RECIPE_CHARS = 4_000;
const MAX_RECIPE_ITEMS = 40;

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
}

/** Same validation `suggestRecipeGroceries` always applied, now shared with extractRecipe. */
function parseExtractedItems(
  raw: unknown,
  availableAisles: string[],
): RecipeGroceryItem[] {
  const items = raw as Array<
    { name?: unknown; quantity?: unknown; aisle?: unknown; component?: unknown }
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
    });
  }
  return result.slice(0, MAX_RECIPE_ITEMS);
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
          description: 'The recipe\'s own amount, as written, with the prep dropped — "4 cloves", "2 cups", "1 tbsp", "2 tsp" — not a converted purchasable size ("1 bulb" for "4 cloves" is wrong). Abbreviate tablespoon/teaspoon as "tbsp"/"tsp". Empty string if the recipe does not say.',
        },
        aisle: {
          type: 'string',
          description: `Where to find it. Must be exactly one of: ${availableAisles.join(', ')}.`,
        },
        component: {
          type: 'string',
          description: 'The recipe\'s own label for the part this ingredient belongs to, e.g. "For the cake" or "For the frosting" — only when the source actually splits its ingredients that way. Empty string otherwise.',
        },
      },
      required: ['name', 'quantity', 'aisle'],
    },
  };
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
  ingredients: RecipeGroceryItem[];
}

/**
 * The paragraphs that don't care where the recipe came from — shop-naming,
 * quantities, which aisle. Shared verbatim by both sources so a photo and a
 * paste can't drift into reading the ingredients differently.
 */
function sharedRecipeInstructions(availableAisles: string[]): string[] {
  return [
    'Name each shopping item the way a shop would label it, not the way the recipe prepares it — "garlic" rather than "3 cloves garlic, minced". Keep the recipe\'s own quantity and unit as stated, just with the prep instruction dropped — "4 cloves" or "3 cloves", not "1 bulb". Never substitute your own guess at a purchasable equivalent; the recipe\'s stated amount is what the cook actually needs, and a bulb doesn\'t reliably yield a fixed number of cloves. Ignore the method for the shopping list, and skip water.',
    `Sections available: ${availableAisles.join(', ')}. Use "Other" only when nothing else fits.`,
    'If the recipe\'s own ingredient list is split into labelled components — "For the cake" / "For the frosting", "For the marinade" / "For the dish" — carry that label into each item\'s "component" field. Leave it empty when the recipe lists everything as one plain list.',
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
 */
export async function extractRecipe(
  source: RecipeSource,
  availableAisles: string[],
): Promise<ExtractedRecipe> {
  const { apiKey, model } = requireFeature('recipeExtraction');

  const empty: ExtractedRecipe = {
    name: '', servings: null, servingsMax: null, prepMinutes: null, ingredients: [],
  };
  const image = typeof source === 'string' ? null : source;
  const text = typeof source === 'string' ? source.trim().slice(0, MAX_RECIPE_CHARS) : '';
  // Same "nothing in, no network call" guard for both sources.
  if (image ? !image.base64 : !text) return empty;

  const prompt = image
    ? [
        'This is a photo of a recipe — a cookbook page, a recipe card, a handwritten note, or a screen. Read it and extract the recipe: its name, how many it serves, its total prep/cook time, and its shopping list.',
        'Ignore anything on the page that is not part of this recipe: page numbers, running heads, chapter titles, headnotes and stories, photo captions, and text bleeding in from a facing page. If the page shows more than one recipe, extract only the most prominent one — the one whose title and ingredient list are most complete — and never merge ingredients across recipes. Ingredient lists are often set in two columns; read down each column rather than across.',
        ...sharedRecipeInstructions(availableAisles),
        'If the photo is too blurry, too dark, cut off, or otherwise unreadable, return an empty name and an empty item list rather than guessing. Never invent an ingredient you cannot actually read.',
      ].join('\n\n')
    : [
        'Extract this recipe: its name, how many it serves, its total prep/cook time, and its shopping list.',
        ...sharedRecipeInstructions(availableAisles),
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
    max_tokens: 2000,
    tools: [{
      name: 'extract_recipe',
      description: 'Extract a recipe\'s name, servings, prep time, and shopping list',
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
          items: groceryItemsSchema(
            availableAisles,
            'The things a shopper needs to buy for this recipe.',
          ),
        },
        required: ['name', 'items'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_recipe' },
    messages: [{ role: 'user', content }],
  }, apiKey, model, image ? IMAGE_REQUEST_TIMEOUT_MS : undefined);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as {
    name?: unknown; servings?: unknown; servingsMax?: unknown; prepMinutes?: unknown; items?: unknown;
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

  return {
    name, servings, servingsMax, prepMinutes,
    ingredients: parseExtractedItems(input.items, availableAisles),
  };
}

/**
 * Pulls just the shopping items out of a pasted or photographed recipe —
 * GroceryAISheet's "From a recipe" mode, which has no use for the
 * name/servings/prep time.
 */
export async function suggestRecipeGroceries(
  source: RecipeSource,
  availableAisles: string[],
): Promise<RecipeGroceryItem[]> {
  const extracted = await extractRecipe(source, availableAisles);
  return extracted.ingredients;
}

// ─── Meal ideas from nothing (#1063) ────────────────────────────────────────

/** Free-text nudge ("something quick", "no pork") — a sentence, not an essay. */
const MAX_MEAL_HINT_CHARS = 200;
/** Planned/recent dinners named in the prompt. A fortnight of context, not a year of it. */
const MAX_MEAL_CONTEXT_TITLES = 20;

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
 */
export async function suggestMealIdeas(
  plannedTitles: string[],
  recentTitles: string[],
  slotsToFill: number,
  hints?: string,
): Promise<MealIdea[]> {
  const { apiKey, model } = requireFeature('mealIdeas');

  const planned = plannedTitles.map(t => t.trim()).filter(Boolean).slice(0, MAX_MEAL_CONTEXT_TITLES);
  const recent = recentTitles.map(t => t.trim()).filter(Boolean).slice(0, MAX_MEAL_CONTEXT_TITLES);
  const nudge = (hints ?? '').trim().slice(0, MAX_MEAL_HINT_CHARS);
  const wanted = clampIdeaCount(slotsToFill);

  const plannedPart = planned.length > 0
    ? `Already planned for this week — do NOT repeat or rephrase any of these:\n${planned.map(t => `- ${t}`).join('\n')}`
    : 'Nothing is planned for this week yet.';
  const recentPart = recent.length > 0
    ? `Cooked in the last few weeks — avoid these too, but they are a fair guide to the kind of cooking that gets done here:\n${recent.map(t => `- ${t}`).join('\n')}`
    : 'There is no recent cooking history to go on, so keep the ideas broad and unfussy.';

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
        nudge ? `What they asked for: ${nudge}` : '',
      ].filter(Boolean).join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { meals?: RawMealIdea[] } | undefined;
  if (!input?.meals) throw new Error('No suggestions returned');

  return dedupeMealIdeas(input.meals, [...planned, ...recent]);
}

/**
 * Drafts the shopping list for a meal that has no recipe — "leftovers" or a
 * just-invented idea turned into something you can actually buy for.
 *
 * Deliberately the same tool shape, the same aisle clamp and the same
 * `parseExtractedItems` validator as `extractRecipe` (see
 * `groceryItemsSchema`): the difference between reading a recipe and
 * inventing one belongs in the prompt, not in a second output format for the
 * same kind of answer. That's what lets an accepted idea go straight into
 * `addStructuredIngredients` alongside an imported one.
 */
export async function suggestMealIngredients(
  mealName: string,
  availableAisles: string[],
  servings: number | null,
): Promise<RecipeGroceryItem[]> {
  const { apiKey, model } = requireFeature('mealIdeas');

  const name = mealName.trim().slice(0, RECIPE_NAME_MAX_LENGTH);
  // Nothing in, no network call — same guard extractRecipe makes on an empty
  // paste.
  if (!name) return [];
  const serves = servings && servings > 0 ? Math.min(99, Math.round(servings)) : 4;

  const data = await callAnthropic({
    max_tokens: 1500,
    tools: [{
      name: 'draft_ingredients',
      description: 'Draft the shopping list for a meal that has no written recipe',
      input_schema: {
        type: 'object',
        properties: {
          items: groceryItemsSchema(
            availableAisles,
            'The things a shopper needs to buy to cook this meal.',
          ),
        },
        required: ['items'],
      },
    }],
    tool_choice: { type: 'tool', name: 'draft_ingredients' },
    messages: [{
      role: 'user',
      content: [
        `Write the shopping list for a home-cooked meal called "${name}". There is no written recipe — draft what a cook would need to buy to make a straightforward home version of it.`,
        `Quantities should feed ${serves}. Give the amount in the quantity field, and name each item the way a shop would label it, not the way the dish prepares it — "garlic" rather than "3 cloves garlic, minced". Abbreviate tablespoon/teaspoon as "tbsp"/"tsp".`,
        'Cover what the dish genuinely needs and stop there: the everyday version rather than an elaborate one, no optional garnishes, and skip water. Include salt, pepper and cooking oil only when the dish actually turns on them.',
        `Sections available: ${availableAisles.join(', ')}. Use "Other" only when nothing else fits.`,
        'If the name is too vague to shop for at all, return an empty list rather than guessing at a dish.',
      ].join('\n\n'),
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as { items?: unknown } | undefined;
  if (!input) throw new Error('No suggestions returned');

  return parseExtractedItems(input.items, availableAisles);
}
