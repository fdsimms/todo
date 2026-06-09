import type { Effort, Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { addDays, startOfDay, format } from 'date-fns';

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

export interface DateSuggestion {
  date: string; // ISO yyyy-MM-dd, one of the next 7 days
  reason: string;
}

const SUGGEST_HORIZON_DAYS = 7;

/**
 * Ask the AI to pick a good due date within the next 7 days, balancing the
 * task's size against how loaded each upcoming day already is.
 */
export async function suggestTaskDate(
  title: string,
  notes: string,
  effort: Effort,
  tasks: Task[],
): Promise<DateSuggestion> {
  const apiKey = useSettingsStore.getState().anthropicApiKey;
  if (!apiKey) throw new Error('No API key configured. Add your Anthropic API key in Settings.');

  const EFFORT_HINTS = ['unknown', 'XS ~15min', 'S ~30min', 'M ~1-2hr', 'L ~4hr', 'XL day+'];

  const today = startOfDay(new Date());
  const candidates = Array.from({ length: SUGGEST_HORIZON_DAYS }, (_, i) => {
    const date = addDays(today, i + 1); // tomorrow .. +7 days
    return { date, iso: format(date, 'yyyy-MM-dd') };
  });
  const candidateIsos = new Set(candidates.map(c => c.iso));

  // Bucket open tasks by their due day so we can describe each day's load.
  const dueByDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.completed || !t.dueDate) continue;
    const key = format(startOfDay(new Date(t.dueDate)), 'yyyy-MM-dd');
    if (!candidateIsos.has(key)) continue;
    const bucket = dueByDay.get(key);
    if (bucket) bucket.push(t);
    else dueByDay.set(key, [t]);
  }

  const dayLoad = (iso: string) => {
    const dayTasks = dueByDay.get(iso) ?? [];
    return dayTasks.reduce((sum, t) => sum + (t.effort || 1), 0);
  };

  const scheduleLines = candidates.map(c => {
    const dayTasks = dueByDay.get(c.iso) ?? [];
    const totalEffort = dayLoad(c.iso);
    const titles = dayTasks.slice(0, 4).map(t => `"${t.title}"`).join(', ');
    return `${c.iso} (${format(c.date, 'EEE')}): ${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'}, load ${totalEffort}${titles ? ` — ${titles}` : ' — open'}`;
  });

  const effortPart = effort > 0 ? ` (size: ${EFFORT_HINTS[effort]})` : '';
  const content = [
    `Pick the best day in the next ${SUGGEST_HORIZON_DAYS} days to schedule this task.`,
    `Task: "${title || 'Untitled task'}"${effortPart}${notes ? `\nNotes: ${notes.slice(0, 200)}` : ''}`,
    '',
    `Prefer lighter days so the workload stays balanced; give a big task its own breathing room and avoid piling it onto an already-loaded day. "load" is the combined effort of tasks already due that day (higher = busier).`,
    '',
    'Upcoming days:',
    ...scheduleLines,
  ].join('\n');

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
        name: 'schedule',
        description: 'Return the best day to schedule the task',
        input_schema: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: `The chosen day as YYYY-MM-DD. Must be one of the listed upcoming days.`,
            },
            reason: {
              type: 'string',
              description: 'A short (one sentence, <90 chars) explanation of why this day fits.',
            },
          },
          required: ['date', 'reason'],
        },
      }],
      tool_choice: { type: 'tool', name: 'schedule' },
      messages: [{ role: 'user', content }],
    }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);

  const data = await response.json() as {
    content?: Array<{ type: string; input?: { date: string; reason: string } }>;
  };
  const toolUse = data.content?.find(c => c.type === 'tool_use');
  if (!toolUse?.input) throw new Error('No suggestion returned');

  // Fall back to the lightest upcoming day if the model returns something off-list.
  const lightest = [...candidates].sort((a, b) => dayLoad(a.iso) - dayLoad(b.iso))[0];
  const date = candidateIsos.has(toolUse.input.date) ? toolUse.input.date : lightest.iso;
  return { date, reason: toolUse.input.reason?.trim() || 'Balances your upcoming workload.' };
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
