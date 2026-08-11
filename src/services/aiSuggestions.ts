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

/** Maps a suggestTaskAttributes/suggestTemplateItems failure to copy safe to show a user. */
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

export interface AISuggestions {
  tags: string[];
  effort: Effort;
  category: string | null;
  /** A brand-new category to propose when none of the existing ones fit; null otherwise. */
  newCategory: string | null;
}

export async function suggestTaskAttributes(
  title: string,
  notes: string,
  availableTags: string[],
  availableCategories: string[],
): Promise<AISuggestions> {
  const { apiKey, model } = requireFeature('taskSuggestions');

  const tagPart = availableTags.length > 0
    ? `Available tags (only suggest from this list): ${availableTags.join(', ')}`
    : 'No existing tags.';

  const categoryPart = availableCategories.length > 0
    ? `Available categories (pick one or leave blank): ${availableCategories.join(', ')}`
    : 'No existing categories.';

  const data = await callAnthropic({
    max_tokens: 200,
    tools: [{
      name: 'suggest',
      description: 'Return tag, effort, and category suggestions for a task',
      input_schema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Relevant tags from the available list only. Empty array if none fit.',
          },
          effort: {
            type: 'integer',
            description: '0=unknown, 1=XXS ~1min, 2=XS ~15min, 3=S ~30min, 4=M ~1-2hr, 5=L ~4hr, 6=XL day+',
            minimum: 0,
            maximum: 6,
          },
          category: {
            type: 'string',
            description: 'The single most relevant category from the available list. Empty string if none fit — in that case consider proposing newCategory instead.',
          },
          newCategory: {
            type: 'string',
            description: 'A short (1-2 word) brand-new category to propose ONLY when no available category fits. Must NOT duplicate any available category. Empty string otherwise.',
          },
        },
        required: ['tags', 'effort', 'category', 'newCategory'],
      },
    }],
    tool_choice: { type: 'tool', name: 'suggest' },
    messages: [{
      role: 'user',
      content: `Task: "${title}"${notes ? `\nNotes: ${notes}` : ''}\n${tagPart}\n${categoryPart}\nStrongly prefer an existing category. Only if none of the existing categories reasonably fit, propose one short new category (1-2 words) matching the user's existing naming style; otherwise leave newCategory blank. Never invent a new category when an existing one fits.`,
    }],
  }, apiKey, model);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input) throw new Error('No suggestion returned');

  const { tags: rawTags, effort: rawEffort, category: rawCategory, newCategory: rawNewCategory } = toolUse.input as {
    tags: string[]; effort: number; category: string; newCategory?: string;
  };
  const suggestedCategory = rawCategory && availableCategories.includes(rawCategory) ? rawCategory : null;

  // A proposed new category only survives when it's genuinely new: trimmed,
  // non-empty, and no existing category was already chosen. If it collides
  // (case-insensitively) with an existing category, promote it to that existing
  // category rather than dropping a real match to a casing mismatch.
  const trimmedNew = (rawNewCategory ?? '').trim();
  const existingMatch = trimmedNew
    ? availableCategories.find(c => c.toLowerCase() === trimmedNew.toLowerCase()) ?? null
    : null;
  const category = suggestedCategory ?? existingMatch;
  const newCategory =
    category === null && trimmedNew.length > 0 && existingMatch === null
      ? trimmedNew
      : null;

  return {
    tags: (rawTags ?? []).filter(t => availableTags.includes(t)),
    effort: Math.max(0, Math.min(6, rawEffort ?? 0)) as Effort,
    category,
    newCategory,
  };
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
  /** Clamped 1–99; null when not stated. */
  servings: number | null;
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
    'Name each shopping item the way a shop would label it, not the way the recipe prepares it — "garlic" rather than "3 cloves garlic, minced". Give quantities in what you would buy. Ignore the method for the shopping list, and skip water.',
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
 * minced" is one bulb of garlic), and the method section has to be ignored.
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

  const empty: ExtractedRecipe = { name: '', servings: null, prepMinutes: null, ingredients: [] };
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
            description: 'How many people this serves, if stated. 0 if not stated.',
          },
          prepMinutes: {
            type: 'integer',
            description: 'Total prep/cook time in minutes, if stated. 0 if not stated.',
          },
          items: {
            type: 'array',
            description: 'The things a shopper needs to buy for this recipe.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: `What to buy, as it would be labelled in a shop — "garlic", not "3 cloves garlic, minced". Under ${GROCERY_NAME_MAX_LENGTH} characters.`,
                },
                quantity: {
                  type: 'string',
                  description: 'How much to buy, in shop terms ("2 lb", "1 bunch", "1 tbsp", "2 tsp"). Abbreviate tablespoon/teaspoon as "tbsp"/"tsp". Empty string if the recipe does not say.',
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
          },
        },
        required: ['name', 'items'],
      },
    }],
    tool_choice: { type: 'tool', name: 'extract_recipe' },
    messages: [{ role: 'user', content }],
  }, apiKey, model, image ? IMAGE_REQUEST_TIMEOUT_MS : undefined);

  const toolUse = data.content?.find(c => c.type === 'tool_use');
  const input = toolUse?.input as {
    name?: unknown; servings?: unknown; prepMinutes?: unknown; items?: unknown;
  } | undefined;
  if (!input) throw new Error('No suggestions returned');

  const name = typeof input.name === 'string' ? input.name.trim().slice(0, RECIPE_NAME_MAX_LENGTH) : '';
  const servings = typeof input.servings === 'number' && input.servings > 0
    ? Math.max(1, Math.min(99, Math.round(input.servings)))
    : null;
  const prepMinutes = typeof input.prepMinutes === 'number' && input.prepMinutes > 0
    ? Math.round(input.prepMinutes)
    : null;

  return { name, servings, prepMinutes, ingredients: parseExtractedItems(input.items, availableAisles) };
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
