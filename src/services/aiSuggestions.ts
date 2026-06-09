import type { Effort } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';

export interface AISuggestions {
  tags: string[];
  effort: Effort;
  category: string | null;
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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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
              description: '0=unknown, 1=XS ~15min, 2=S ~30min, 3=M ~1-2hr, 4=L ~4hr, 5=XL day+',
              minimum: 0,
              maximum: 5,
            },
            category: {
              type: 'string',
              description: 'The single most relevant category from the available list. Empty string if none fit.',
            },
          },
          required: ['tags', 'effort', 'category'],
        },
      }],
      tool_choice: { type: 'tool', name: 'suggest' },
      messages: [{
        role: 'user',
        content: `Task: "${title}"${notes ? `\nNotes: ${notes}` : ''}\n${tagPart}\n${categoryPart}`,
      }],
    }),
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; input?: { tags: string[]; effort: number; category: string } }>;
  };
  const toolUse = data.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input) throw new Error('No suggestion returned');

  const { tags: rawTags, effort: rawEffort, category: rawCategory } = toolUse.input;
  const suggestedCategory = rawCategory && availableCategories.includes(rawCategory) ? rawCategory : null;
  return {
    tags: (rawTags ?? []).filter(t => availableTags.includes(t)),
    effort: Math.max(0, Math.min(5, rawEffort ?? 0)) as Effort,
    category: suggestedCategory,
  };
}
