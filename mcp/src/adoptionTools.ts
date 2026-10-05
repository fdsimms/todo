/**
 * `unused_features`: app features this person's own data suggests they would
 * get something from, and are not using.
 *
 * `app_help` answers a question somebody asked. This answers the one they did
 * not know to ask, by comparing what the replica holds against a short list of
 * checks. Each check is a feature, a test for "the data looks like this person
 * would benefit and has not set it up", and one plain sentence on what it buys.
 *
 * Three rules keep it from becoming noise, and they are the reason it is a
 * hand-written table rather than something inferred from the settings index:
 *
 * - **Only a pattern in the data raises a check.** "You have not turned on X"
 *   is true of every feature for every person. A check fires when the data
 *   shows the need (forty open tasks and not one estimate), and says what it
 *   saw, so the agent can quote the evidence instead of a generic pitch.
 * - **A feature the person switched off is not a gap.** Simplified mode drops
 *   the `advanced` checks, since recommending a screen the app is hiding is the
 *   same lie `app_help` refuses to tell.
 * - **A "no thanks" is remembered.** An agent note that names a check's id
 *   (`remember` it when the person declines) silences that check, so a
 *   suggestion declined once is not repeated at every review.
 *
 * Suggestions, not verdicts: the result never says the person is doing it
 * wrong, and the server instructions tell the agent the same.
 */
import type { Task } from '../../src/types';
import type { Replica } from './replica';

export interface AdoptionContext {
  replica: Replica;
  /** Open top-level tasks. */
  open: Task[];
  /** Every top-level task, finished or not. */
  all: Task[];
}

export interface AdoptionCheck {
  /** Stable, so a declined suggestion can be silenced by naming it. */
  id: string;
  title: string;
  /** What it buys the person, in the app's own plain register. */
  benefit: string;
  /** A Settings search term, so the result can carry the path to tap. Omitted when the feature is not a setting. */
  settingsQuery?: string;
  /** Hidden along with the rest of the advanced half of the app in simplified mode. */
  advanced?: boolean;
  /** What the data showed, or null when the check does not apply. */
  evidence: (ctx: AdoptionContext) => string | null;
}

function share(count: number, of: number): number {
  return of === 0 ? 0 : count / of;
}

function percent(count: number, of: number): string {
  return `${Math.round(share(count, of) * 100)}%`;
}

export const ADOPTION_CHECKS: readonly AdoptionCheck[] = [
  {
    id: 'estimates',
    title: 'Time estimates',
    benefit: 'With estimates the look-ahead can tell when a day holds more than fits, and lightening an overloaded day has something to work from.',
    evidence: ({ open }) => {
      const withEstimate = open.filter(t => t.estimatedMinutes != null).length;
      return open.length >= 10 && share(withEstimate, open.length) < 0.25
        ? `${withEstimate} of ${open.length} open tasks have a time estimate.`
        : null;
    },
  },
  {
    id: 'priorities',
    title: 'Priority',
    benefit: 'A priority lets a list be sorted by what matters, and is what the app reaches for when a day needs trimming.',
    evidence: ({ open }) =>
      open.length >= 10 && open.every(t => !t.priority) ? `None of ${open.length} open tasks has a priority set.` : null,
  },
  {
    id: 'reminders',
    title: 'Reminders',
    benefit: 'A task with a date only appears on its day. A reminder notifies you at a time you choose.',
    evidence: ({ open }) => {
      const dated = open.filter(t => t.dueDate);
      return dated.length >= 10 && dated.every(t => !t.reminderTime)
        ? `${dated.length} open tasks have a date and none has a reminder.`
        : null;
    },
  },
  {
    id: 'categories',
    title: 'Categories',
    benefit: 'Categories group Today into sections and can carry their own hours, such as work tasks only showing on weekdays.',
    settingsQuery: 'categories',
    evidence: ({ open }) => {
      const without = open.filter(t => !t.category).length;
      return open.length >= 15 && share(without, open.length) >= 0.6
        ? `${without} of ${open.length} open tasks (${percent(without, open.length)}) have no category.`
        : null;
    },
  },
  {
    id: 'tags',
    title: 'Tags',
    benefit: 'Tags cut across categories (a place, a person, a kind of errand) and can be used to filter and search.',
    evidence: ({ open, replica }) =>
      open.length >= 20 && replica.tagRegistry().length === 0 ? `${open.length} open tasks and no tags exist.` : null,
  },
  {
    id: 'repeating_tasks',
    title: 'Repeating tasks',
    benefit: 'A task that comes back on its own (daily, weekly, monthly, or every few hours) saves re-adding it, and builds a streak.',
    evidence: ({ all }) =>
      all.length >= 20 && all.every(t => t.recurrenceType === 'none')
        ? `None of ${all.length} tasks repeats.`
        : null,
  },
  {
    id: 'pinning',
    title: 'Pinning',
    benefit: 'Pinning copies a task to a block at the top of Today, so the few things that must happen are not buried in a long day.',
    evidence: ({ open, replica }) => {
      const today = open.filter(t => replica.isVisible(t));
      return today.length >= 8 && open.every(t => !t.pinned)
        ? `Today holds ${today.length} tasks and nothing is pinned.`
        : null;
    },
  },
  {
    id: 'templates',
    title: 'Templates',
    benefit: 'A template builds a whole set of tasks in one go (a trip, a move, a weekly reset), with questions it asks first.',
    advanced: true,
    evidence: ({ replica }) => {
      const projects = replica.projects().filter(p => !p.archived);
      return projects.length >= 3 && replica.templates().length === 0
        ? `${projects.length} projects and no templates.`
        : null;
    },
  },
  {
    id: 'project_defaults',
    title: 'Project task defaults',
    benefit: 'A project can answer priority, difficulty and estimate once for all its tasks, so the app stops asking about each one.',
    advanced: true,
    evidence: ({ replica }) => {
      const big = replica
        .projects()
        .filter(p => !p.archived && !p.completed && !p.taskDefaults)
        .map(p => ({ title: p.title, left: (() => { const { done, total } = replica.projectProgress(p.id); return total - done; })() }))
        .filter(p => p.left >= 5)
        .sort((a, b) => b.left - a.left);
      return big.length > 0
        ? `${big.slice(0, 3).map(p => `"${p.title}" (${p.left} left)`).join(', ')} ${big.length === 1 ? 'has' : 'have'} no task defaults.`
        : null;
    },
  },
  {
    id: 'dependencies',
    title: 'Waiting on another task',
    benefit: 'A task can wait on another and stay out of Today until that one is done, so a project shows only the step that can be started.',
    advanced: true,
    evidence: ({ open, replica }) => {
      const stepped = replica.projects().filter(p => !p.archived && !p.completed && replica.projectProgress(p.id).total >= 5);
      return stepped.length > 0 && open.every(t => !t.blockedById)
        ? `${stepped.length} project${stepped.length === 1 ? ' has' : 's have'} five or more steps and no task waits on another.`
        : null;
    },
  },
  {
    id: 'automations',
    title: 'Automation rules',
    benefit: 'Rules add tasks for you when something happens: a title contains a word, the weather turns, a calendar event appears, a Health number is reached.',
    settingsQuery: 'automations',
    advanced: true,
    evidence: ({ replica }) => {
      const lists = replica.ruleLists();
      return Object.values(lists).every(rules => rules.length === 0) && replica.tasks().length >= 30
        ? 'No automation rules are set up.'
        : null;
    },
  },
  {
    id: 'retention',
    title: 'Keeping completed tasks',
    benefit: 'Every completion leaves a row behind, so repeating tasks pile up. A retention window clears old ones and keeps the app quick.',
    settingsQuery: 'completed tasks',
    evidence: ({ all, replica }) => {
      const done = all.filter(t => t.completed).length;
      return done >= 2000 && replica.settings().completedRetentionDays === null
        ? `${done} completed tasks are kept for ever.`
        : null;
    },
  },
];

export interface UnusedFeature {
  id: string;
  title: string;
  /** What the person's data showed. */
  seen: string;
  benefit: string;
  /** Where to turn it on or learn more, when it is a setting. */
  settings?: { label: string; path: string }[];
}

export interface UnusedFeaturesResult {
  suggestions: UnusedFeature[];
  /** Checks that applied but were left out because there were more than `limit`. */
  more?: number;
  /** Checks silenced by a note, so the agent can mention it if asked. */
  silencedByNotes: string[];
}

export const DEFAULT_SUGGESTION_LIMIT = 4;

export interface UnusedFeaturesInput {
  limit?: number;
}

export function unusedFeatures(
  replica: Replica,
  input: UnusedFeaturesInput = {},
  checks: readonly AdoptionCheck[] = ADOPTION_CHECKS,
): UnusedFeaturesResult {
  const limit = Math.max(1, input.limit ?? DEFAULT_SUGGESTION_LIMIT);
  const simple = replica.settings().simpleMode;
  const all = replica.tasks().filter(t => !t.parentId);
  const ctx: AdoptionContext = { replica, all, open: all.filter(t => !t.completed && !t.archived) };
  const notes = replica.agentNotes().map(n => n.text.toLowerCase());

  const silencedByNotes: string[] = [];
  const found: UnusedFeature[] = [];
  for (const check of checks) {
    if (simple && check.advanced) continue;
    const seen = check.evidence(ctx);
    if (!seen) continue;
    if (notes.some(text => text.includes(check.id))) {
      silencedByNotes.push(check.id);
      continue;
    }
    const settings = check.settingsQuery
      ? replica.searchSettings(check.settingsQuery).slice(0, 2).map(h => ({ label: h.label, path: h.path }))
      : [];
    found.push({
      id: check.id,
      title: check.title,
      seen,
      benefit: check.benefit,
      ...(settings.length > 0 ? { settings } : {}),
    });
  }

  return {
    suggestions: found.slice(0, limit),
    ...(found.length > limit ? { more: found.length - limit } : {}),
    silencedByNotes,
  };
}
