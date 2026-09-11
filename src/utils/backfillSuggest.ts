import type { Task, Effort } from '../types';
import { EFFORT_MINUTES } from './effort';
import { ESTIMATE_EFFORTS, type BackfillFieldId } from './fieldBackfill';

/**
 * The part of "suggest a value for the field the Backfill screen is asking
 * about" that isn't a network call: which fields may be suggested at all, what
 * gets sent, and — the half that matters — refusing whatever the model says
 * unless it lands back on a task actually sent and a value the card was
 * already offering.
 *
 * **Only two of the six pools' fields are here, and the line is not "could a
 * model produce a string for it".** A suggestion is worth offering when the
 * answer is *in the task* and the set of answers is *closed*:
 *
 * - **`category`** classifies a title into one of the user's own categories.
 *   Closed by construction — the prompt names the list, and `readSuggestions`
 *   drops anything outside it, so the worst case is a category you'd have
 *   picked second rather than one you've never heard of.
 * - **`estimate`** picks one of the effort buckets the card already shows
 *   (`ESTIMATE_EFFORTS`). The model answers in the buckets' own canonical
 *   minutes, so a suggestion is literally one of the pills on screen,
 *   highlighted, rather than a number arriving from somewhere else.
 *
 * Everything else is left out on purpose, and for three different reasons
 * worth keeping apart:
 *
 * - **`priority`, `streak`, `vacation`, `reminder`, `suggestions`** are
 *   preferences, not facts. Priority is defined against everything *else* on
 *   Today (see `BACKFILL_FIELDS`' own hint for it), which is precisely the
 *   context a per-task suggestion doesn't have; the other four are switches
 *   about how you want the app to behave, and a title says nothing about them.
 * - **The People pool** is the sharp one. A birthday, a location, a cadence
 *   and a note about somebody are facts about a real person, so a model has
 *   nothing to reason *from* and would be inventing them — and `docs/arch/
 *   people.md` already refuses far milder things than a made-up birthday.
 *   Nothing here may ever grow a person arm.
 * - **The category, project, item and recipe pools** are simply not asked yet.
 *   Recipe servings and times are the plausible next ones, on the same test
 *   the two above pass, but they are a second pool's worth of surface and
 *   nobody has asked for them.
 *
 * The screen confirms every value with a tap before anything is written, which
 * is the same rule `nutritionEstimate` keeps: the model proposes, a person
 * confirms. Accept-all is the one place a batch commits at once, and it is
 * still a deliberate press on a count the user can see, logged row by row into
 * the session review with its own Undo.
 */
export type SuggestibleBackfillFieldId = Extract<BackfillFieldId, 'category' | 'estimate'>;

export const SUGGESTIBLE_BACKFILL_FIELDS: readonly SuggestibleBackfillFieldId[] = ['category', 'estimate'];

export function isSuggestibleBackfillField(id: BackfillFieldId): id is SuggestibleBackfillFieldId {
  return (SUGGESTIBLE_BACKFILL_FIELDS as readonly BackfillFieldId[]).includes(id);
}

/**
 * Tasks per request. The queue can be hundreds long on a list nobody has ever
 * backfilled, and one request covering the whole thing would be both the
 * slowest and the most expensive thing this app sends. Forty is comfortably
 * more than one sitting's worth of cards, so the common case is a single call.
 */
export const MAX_SUGGESTION_TASKS = 40;

/**
 * Already-answered tasks sent as examples. This is what makes the feature
 * worth having rather than generic: "Pay rent" belongs in *your* Home or
 * *your* Money depending on how you've been filing things, and a dozen of your
 * own answers settles that far better than any amount of prompt wording.
 */
export const MAX_SUGGESTION_EXAMPLES = 12;

/** Characters of a task's notes sent along as context. */
export const SUGGESTION_NOTES_MAX_CHARS = 200;

/** One task as the request sees it — the title actually on the card, plus context. */
export interface SuggestionTask {
  id: string;
  title: string;
  notes: string;
}

/** One already-answered task, as the "here's how I file things" half of the prompt. */
export interface SuggestionExample {
  title: string;
  value: string;
}

export type BackfillSuggestion =
  | { field: 'category'; taskId: string; category: string }
  | { field: 'estimate'; taskId: string; effort: Effort };

/**
 * How a task is named in the request. Always `displayTitleFor` in the app; a
 * parameter rather than an import because that import drags the whole store
 * graph (and so `expo-sqlite`) into this module, and from here into
 * `aiSuggestions.ts` — the module every other AI call in the app already
 * loads, and which several suites load without a database.
 *
 * The rule it exists to hold is worth stating anyway, since a caller could now
 * pass `t => t.title`: **the title sent has to be the title on the card.**
 * Mid-chain the card shows the active step, so asking the model to size
 * "Laundry" while the person is looking at "Move to the dryer" would be
 * answering a different question than the one being asked.
 */
export type TitleOf = (task: Task) => string;

/** The tasks to ask about, trimmed and capped. */
export function suggestionTasks(tasks: Task[], titleOf: TitleOf): SuggestionTask[] {
  return tasks.slice(0, MAX_SUGGESTION_TASKS).map(t => ({
    id: t.id,
    title: titleOf(t),
    notes: t.notes.trim().slice(0, SUGGESTION_NOTES_MAX_CHARS),
  }));
}

/**
 * Up to `MAX_SUGGESTION_EXAMPLES` of the user's own answers for this field, to
 * send as the pattern to match.
 *
 * Drawn from live top-level tasks only, same population the queue itself walks
 * (`backfillCandidates`) — a completed row is history, and a subtask's estimate
 * rides on fields most lists don't show it. Excludes anything being asked about
 * in this same request, which only bites in a from-scratch run: without it a
 * task already carrying a value would be handed to the model as the example for
 * its own question, and the answer would be that value every time.
 */
export function suggestionExamples(
  tasks: Task[],
  field: SuggestibleBackfillFieldId,
  titleOf: TitleOf,
  askingAbout: ReadonlySet<string> = new Set(),
): SuggestionExample[] {
  const out: SuggestionExample[] = [];
  for (const t of tasks) {
    if (out.length >= MAX_SUGGESTION_EXAMPLES) break;
    if (t.parentId || t.completed || t.archived || askingAbout.has(t.id)) continue;
    const title = titleOf(t).trim();
    if (!title) continue;
    if (field === 'category') {
      if (!t.category) continue;
      out.push({ title, value: t.category });
    } else {
      // The bucket's canonical minutes rather than whatever exact figure the
      // task carries, so the examples speak in the same six values the answer
      // is constrained to. A task sized at 45 minutes is an example of "30",
      // which is the bucket its own pill shows.
      const minutes = EFFORT_MINUTES[t.effort];
      if (t.effort === 0 || minutes == null) continue;
      out.push({ title, value: `${minutes} minutes` });
    }
  }
  return out;
}

/** The canonical minutes the `estimate` answer is constrained to, in bucket order. */
export function suggestibleEstimateMinutes(): number[] {
  return ESTIMATE_EFFORTS.map(e => EFFORT_MINUTES[e]).filter((m): m is number => m != null);
}

/** What the model is asked to return, before any of it is believed. */
interface RawSuggestion {
  index?: unknown;
  category?: unknown;
  minutes?: unknown;
}

/**
 * Turns whatever the model said into suggestions over the tasks actually sent.
 *
 * Same discipline `matchBackAisles` keeps for grocery aisles, and for the same
 * reason: a returned string is never an identifier. Three separate refusals,
 * each of which has a way of mattering —
 *
 * - **The index has to land on a task in this batch.** A 1-based position into
 *   what was sent, so an invented or drifted one resolves to nothing rather
 *   than to whichever task happens to sit there.
 * - **A category has to be one of the user's own**, matched case-insensitively
 *   and returned in the app's own spelling. An invented one would write a
 *   category that exists on exactly one task and appears in no picker.
 * - **A duration has to be one of the buckets**, so the suggestion is a pill
 *   already on the card. Anything else is dropped rather than snapped to the
 *   nearest, since a value the model didn't mean isn't better than no
 *   suggestion for that one task.
 *
 * First answer per task wins, so a model repeating itself can't turn one card
 * into two conflicting suggestions.
 */
export function readSuggestions(
  raw: unknown,
  field: SuggestibleBackfillFieldId,
  sent: SuggestionTask[],
  categoryNames: string[] = [],
): Map<string, BackfillSuggestion> {
  const out = new Map<string, BackfillSuggestion>();
  if (!Array.isArray(raw)) return out;

  const byLowerName = new Map(categoryNames.map(n => [n.trim().toLowerCase(), n]));

  for (const entry of raw as RawSuggestion[]) {
    const index = entry?.index;
    if (typeof index !== 'number' || !Number.isInteger(index)) continue;
    const task = sent[index - 1];
    if (!task || out.has(task.id)) continue;

    if (field === 'category') {
      if (typeof entry.category !== 'string') continue;
      const name = byLowerName.get(entry.category.trim().toLowerCase());
      if (!name) continue;
      out.set(task.id, { field: 'category', taskId: task.id, category: name });
    } else {
      if (typeof entry.minutes !== 'number') continue;
      const effort = ESTIMATE_EFFORTS.find(e => EFFORT_MINUTES[e] === entry.minutes);
      if (effort == null) continue;
      out.set(task.id, { field: 'estimate', taskId: task.id, effort });
    }
  }
  return out;
}
