import type { Effort, Task } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { effortToMinutes, formatDuration } from '../utils/effort';

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
    }),
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; input?: { tags: string[]; effort: number; category: string; newCategory?: string } }>;
  };
  const toolUse = data.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input) throw new Error('No suggestion returned');

  const { tags: rawTags, effort: rawEffort, category: rawCategory, newCategory: rawNewCategory } = toolUse.input;
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

const CO_COMPLETION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_COMPLETED_HISTORY = 300;

function buildCoCompletionHints(completedTasks: Task[], candidates: Task[]): string {
  const recent = [...completedTasks]
    .filter(t => t.completedAt)
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())
    .slice(0, MAX_COMPLETED_HISTORY)
    .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());

  const freq = new Map<string, number>();
  for (let i = 0; i < recent.length; i++) {
    const ti = new Date(recent[i].completedAt!).getTime();
    for (let j = i + 1; j < recent.length; j++) {
      const tj = new Date(recent[j].completedAt!).getTime();
      if (tj - ti > CO_COMPLETION_WINDOW_MS) break;
      const pair = [recent[i].title.toLowerCase(), recent[j].title.toLowerCase()].sort().join(' ↔ ');
      freq.set(pair, (freq.get(pair) ?? 0) + 1);
    }
  }

  const candidateTitles = new Set(candidates.map(t => t.title.toLowerCase()));
  const relevant = [...freq.entries()]
    .filter(([pair, count]) => count > 1 && pair.split(' ↔ ').some(p => candidateTitles.has(p)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (relevant.length === 0) return '';
  return 'Tasks historically completed together (within 2hrs of each other): ' +
    relevant.map(([pair, count]) => `${pair} (${count}x)`).join(', ');
}

export async function suggestPinTasks(
  tasks: Task[],
  alreadyPinnedCount: number,
  completedTasks: Task[] = [],
): Promise<string[]> {
  const apiKey = useSettingsStore.getState().anthropicApiKey;
  if (!apiKey) throw new Error('No API key configured. Add your Anthropic API key in Settings.');

  const needed = 5 - alreadyPinnedCount;
  if (needed <= 0) return [];

  const candidates = tasks.filter(t => !t.pinned);
  if (candidates.length === 0) return [];
  if (candidates.length <= needed) return candidates.map(t => t.id);

  const PRIORITY_NAMES = ['', 'low', 'medium', 'high', 'urgent'];
  const today = new Date().toISOString().split('T')[0];

  const taskList = candidates.map(t => {
    const parts: string[] = [`"${t.title}"`];
    if (t.priority > 0) parts.push(`priority=${PRIORITY_NAMES[t.priority]}`);
    const mins = t.estimatedMinutes ?? effortToMinutes(t.effort);
    if (mins != null) parts.push(`time=${formatDuration(mins)}`);
    if (t.dueDate) parts.push(`due=${t.dueDate.split('T')[0]}`);
    if (t.category) parts.push(`category=${t.category}`);
    if (t.tags.length > 0) parts.push(`tags=${t.tags.join(',')}`);
    if (t.notes) parts.push(`notes="${t.notes.slice(0, 80)}"`);
    return `id:${t.id} ${parts.join(' ')}`;
  }).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      tools: [{
        name: 'pin',
        description: 'Return task IDs to pin',
        input_schema: {
          type: 'object',
          properties: {
            task_ids: {
              type: 'array',
              items: { type: 'string' },
              description: `Exactly ${needed} task ID${needed > 1 ? 's' : ''} to pin`,
            },
          },
          required: ['task_ids'],
        },
      }],
      tool_choice: { type: 'tool', name: 'pin' },
      messages: (() => {
        const coHints = buildCoCompletionHints(completedTasks, candidates);
        const content = [
          `Pick exactly ${needed} task${needed > 1 ? 's' : ''} to pin right now.`,
          `Prefer: high priority or overdue tasks; tasks that work well together (spatially or thematically — e.g. errands, computer tasks, cleaning); reasonable combined effort; tasks the user has historically done in the same session.`,
          `Today: ${today}.`,
          '',
          taskList,
          ...(coHints ? ['', coHints] : []),
        ].join('\n');
        return [{ role: 'user' as const, content }];
      })(),
    }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);

  const data = await response.json() as {
    content?: Array<{ type: string; input?: { task_ids: string[] } }>;
  };
  const toolUse = data.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input?.task_ids) throw new Error('No suggestion returned');

  const validIds = new Set(candidates.map(t => t.id));
  return toolUse.input.task_ids.filter(id => validIds.has(id)).slice(0, needed);
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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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
    }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);

  const data = await response.json() as {
    content?: Array<{ type: string; input?: { tasks?: Array<{ title?: string; notes?: string }> } }>;
  };
  const toolUse = data.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input?.tasks) throw new Error('No suggestions returned');

  // Drop blanks and anything that collides (case-insensitively) with an existing
  // item or an earlier suggestion, so the user only sees genuinely new tasks.
  const existingLower = new Set(existingTitles.map(t => t.trim().toLowerCase()));
  const seen = new Set<string>();
  const result: TemplateItemSuggestion[] = [];
  for (const t of toolUse.input.tasks) {
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
