import type { Effort } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';

const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const REQUEST_TIMEOUT_MS = 15_000;

interface AnthropicResponse {
  stop_reason?: string;
  content?: Array<{ type: string; input?: unknown }>;
}

/** POSTs to the Messages API with a timeout and flags a max_tokens truncation as an error. */
async function callAnthropic(body: Record<string, unknown>, apiKey: string): Promise<AnthropicResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, temperature: 0, ...body }),
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
  const apiKey = useSettingsStore.getState().anthropicApiKey;
  if (!apiKey) throw new Error('No API key');

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
  }, apiKey);

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
  const apiKey = useSettingsStore.getState().anthropicApiKey;
  if (!apiKey) throw new Error('No API key configured. Add your Anthropic API key in Settings.');

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
  }, apiKey);

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
