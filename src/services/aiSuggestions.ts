import type { Effort, Task } from '../types';
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

export async function suggestFocusTasks(
  tasks: Task[],
  alreadyFocusedCount: number,
  completedTasks: Task[] = [],
): Promise<string[]> {
  const apiKey = useSettingsStore.getState().anthropicApiKey;
  if (!apiKey) throw new Error('No API key configured. Add your Anthropic API key in Settings.');

  const needed = 3 - alreadyFocusedCount;
  if (needed <= 0) return [];

  const candidates = tasks.filter(t => !t.focused);
  if (candidates.length === 0) return [];
  if (candidates.length <= needed) return candidates.map(t => t.id);

  const EFFORT_HINTS = ['', 'XS ~15min', 'S ~30min', 'M ~1-2hr', 'L ~4hr', 'XL day+'];
  const PRIORITY_NAMES = ['', 'low', 'medium', 'high', 'urgent'];
  const today = new Date().toISOString().split('T')[0];

  const taskList = candidates.map(t => {
    const parts: string[] = [`"${t.title}"`];
    if (t.priority > 0) parts.push(`priority=${PRIORITY_NAMES[t.priority]}`);
    if (t.effort > 0) parts.push(`effort=${EFFORT_HINTS[t.effort]}`);
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
        name: 'focus',
        description: 'Return task IDs to focus on',
        input_schema: {
          type: 'object',
          properties: {
            task_ids: {
              type: 'array',
              items: { type: 'string' },
              description: `Exactly ${needed} task ID${needed > 1 ? 's' : ''} to focus on`,
            },
          },
          required: ['task_ids'],
        },
      }],
      tool_choice: { type: 'tool', name: 'focus' },
      messages: (() => {
        const coHints = buildCoCompletionHints(completedTasks, candidates);
        const content = [
          `Pick exactly ${needed} task${needed > 1 ? 's' : ''} to focus on right now.`,
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
