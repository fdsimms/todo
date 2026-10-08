/**
 * The unattended ledger — the pure half of "what did the app do while nobody
 * was looking".
 *
 * Twenty generators, the expiry sweep and the completed-task purge write and
 * delete rows unattended, at every launch, at every background refresh and on
 * every return to the foreground. Nothing accounted for any of it. A task
 * appeared on Today and the only way to find out which generator wrote it was
 * to recognise the wording; a task left and there was nothing to ask at all.
 *
 * This module decides how an entry *reads*. `useUnattendedStore` does the
 * writing and `src/db/database.ts` holds the table, so these rules can be
 * tested without a database — the same split `retention.ts` makes, and for the
 * same reason.
 *
 * **It reaches no store on purpose.** A ledger entry is a record of something
 * that already happened, so there is nothing to look up and nothing to be
 * current about: the title is a snapshot, the kind is whatever the generator
 * was called at the time, and both are read straight off the row. Importing
 * `visibilityUtils` or a settings lookup here would take the module and its
 * tests out of Jest's node environment for no answer it needs.
 */

import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { GENERATED_KIND_SPECS } from './generatedTasks';
import { dayKeyOf, getDayStart } from './dateUtils';
import type { GeneratedKind, UnattendedAction, UnattendedEntry } from '../types';

/**
 * How each action reads, and which way round it is.
 *
 * The verb is the past tense on purpose: every row here is finished business,
 * and a present-tense label ("adds", "clears") would read as a rule that is
 * still running rather than as a thing that happened at 06:12 this morning.
 *
 * `added` is the one tone that differs, because it is the only action that put
 * something *in front of* the user. The other three took something away, and
 * drawing those in the accent colour would make a tidy-up look like news.
 */
export interface UnattendedActionSpec {
  action: UnattendedAction;
  /** The word on the row. */
  verb: string;
  /** Ionicons glyph. */
  icon: string;
  /** Whether this action added work rather than taking it away. */
  adds: boolean;
}

export const UNATTENDED_ACTION_SPECS: Record<UnattendedAction, UnattendedActionSpec> = {
  created: { action: 'created', verb: 'Added', icon: 'add-circle-outline', adds: true },
  cleared: { action: 'cleared', verb: 'Cleared', icon: 'close-circle-outline', adds: false },
  expired: { action: 'expired', verb: 'Expired', icon: 'hourglass-outline', adds: false },
  purged: { action: 'purged', verb: 'Purged', icon: 'trash-outline', adds: false },
  // Only an agent writes these, but for one: the rain skip writes `moved` (see
  // UnattendedActor). An edit or a move neither adds nor takes away, so
  // neither is drawn as news.
  edited: { action: 'edited', verb: 'Edited', icon: 'create-outline', adds: false },
  moved: { action: 'moved', verb: 'Moved', icon: 'calendar-outline', adds: false },
  completed: { action: 'completed', verb: 'Completed', icon: 'checkmark-circle-outline', adds: false },
  // Only an agent writes this too: a repeating task's occurrence the person told it they missed.
  missed: { action: 'missed', verb: 'Marked missed', icon: 'alert-circle-outline', adds: false },
};

/** The name an agent's rows go under. The MCP server is reached from the Claude apps. */
export const AGENT_SOURCE = 'Claude';

/**
 * `kind` is read straight off a synced column, so a row written by a build that
 * knows a generator this one doesn't carries a string with no spec. Every reader
 * of `GENERATED_KIND_SPECS` goes through this rather than trusting the type, or
 * one such row crashes the whole Activity screen on open.
 */
function isKnownKind(kind: string): kind is GeneratedKind {
  return Object.prototype.hasOwnProperty.call(GENERATED_KIND_SPECS, kind);
}

/** The glyph for a row: the generator's own where there is one, else the action's. */
export function unattendedIcon(entry: Pick<UnattendedEntry, 'action' | 'kind'> & Partial<Pick<UnattendedEntry, 'actor'>>): string {
  if (entry.actor === 'agent') return UNATTENDED_ACTION_SPECS[entry.action].icon;
  if (entry.kind !== null && isKnownKind(entry.kind)) return GENERATED_KIND_SPECS[entry.kind].icon;
  return UNATTENDED_ACTION_SPECS[entry.action].icon;
}

/**
 * What wrote it, in the words Settings already uses for the switch that turns
 * it off — so somebody who reads a row here and wants it to stop has the name
 * of the row they are looking for.
 *
 * The two sweeps have no generator and are named for what they are rather than
 * being left blank: "the app deleted this" with no attribution is exactly the
 * unaccountability this feature exists to end.
 */
export function unattendedSource(entry: Pick<UnattendedEntry, 'action' | 'kind'> & Partial<Pick<UnattendedEntry, 'actor'>>): string {
  if (entry.actor === 'agent') return AGENT_SOURCE;
  if (entry.kind !== null) return isKnownKind(entry.kind) ? GENERATED_KIND_SPECS[entry.kind].label : 'Automatic task';
  if (entry.action === 'purged') return 'Completed task cleanup';
  // The one app-written move: an occurrence skipped because it rained (rainSkip.ts).
  if (entry.action === 'moved') return 'Skipped after rain';
  return 'Expired task sweep';
}

/**
 * The line under the title.
 *
 * A purge names a count and no title, because it took a set of rows rather than
 * one task, and inventing a representative title for it would misreport what
 * happened. Everything else names one row.
 */
export function describeUnattendedEntry(entry: UnattendedEntry): string {
  const source = unattendedSource(entry);
  if (entry.action === 'purged') {
    return `${source} removed ${entry.count} completed ${entry.count === 1 ? 'task' : 'tasks'}`;
  }
  return source;
}

/** A day's worth of entries, newest day first and newest entry first within it. */
export interface UnattendedDay {
  /** `YYYY-MM-DD`, the logical day the entries fall on. */
  dayKey: string;
  entries: UnattendedEntry[];
}

/**
 * Groups entries by the logical day they happened on, newest first.
 *
 * Anchored to `dayResetTime` like every other day-keyed read in the app: a
 * generator that ran at 01:30 for somebody whose day starts at 02:00 belongs
 * under yesterday, which is the day whose work it was catching up on.
 */
export function unattendedDays(
  entries: readonly UnattendedEntry[],
  dayResetTime?: string,
): UnattendedDay[] {
  const byDay = new Map<string, UnattendedEntry[]>();
  for (const entry of entries) {
    const key = dayKeyOf(getDayStart(new Date(entry.at), dayResetTime));
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }
  return [...byDay.entries()]
    .map(([dayKey, group]) => ({
      dayKey,
      entries: [...group].sort((a, b) => b.at.localeCompare(a.at)),
    }))
    .sort((a, b) => b.dayKey.localeCompare(a.dayKey));
}

/**
 * A day-group header, looking backwards.
 *
 * `formatGroupHeader` is the Later list's and reads forwards ("Tomorrow"), so
 * this is its mirror rather than a reuse. Past the last week a day gets its own
 * date rather than being batched into a month the way that one does: this list
 * is bounded to 90 days at the outside, so there is no runaway header count to
 * protect against, and a month header over a log of individual moments would
 * hide which day each one fell on.
 */
export function unattendedDayLabel(dayKey: string, now: Date = new Date(), dayResetTime?: string): string {
  const day = new Date(`${dayKey}T12:00:00`);
  const today = getDayStart(now, dayResetTime);
  const diff = differenceInCalendarDays(today, day);
  if (diff <= 0) return `Today · ${format(day, 'MMM d')}`;
  if (diff === 1) return `Yesterday · ${format(day, 'MMM d')}`;
  if (diff < 7) return format(day, 'EEEE · MMM d');
  return day.getFullYear() === today.getFullYear() ? format(day, 'MMM d') : format(day, 'MMM d, yyyy');
}

/**
 * "Added 14, cleared 9" — the header's summary of the window on screen.
 *
 * Counts rows accounted for rather than entries, so the one purge row that
 * took 40 tombstones reports 40. Reporting 1 there would understate the only
 * pass in this list that deletes in bulk, which is the one somebody scrolling
 * a ledger most wants a real number for.
 */
export function unattendedSummary(entries: readonly UnattendedEntry[]): string {
  let added = 0;
  let removed = 0;
  for (const entry of entries) {
    if (UNATTENDED_ACTION_SPECS[entry.action].adds) added += entry.count;
    else removed += entry.count;
  }
  if (added === 0 && removed === 0) return 'Nothing yet';
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  return parts.join(', ');
}

/** The kinds present in a set of entries, in the registry's own order. */
export function unattendedKinds(entries: readonly UnattendedEntry[]): GeneratedKind[] {
  const seen = new Set<GeneratedKind>();
  for (const entry of entries) {
    if (entry.kind !== null && isKnownKind(entry.kind)) seen.add(entry.kind);
  }
  return [...seen];
}

/** The Activity filter's key for Claude's rows. Not a `GeneratedKind`, and not shaped like one. */
export const AGENT_FILTER = 'agent';

/** What the Activity screen can narrow to: one generator, everything Claude did, or (null) nothing. */
export type ActivityFilter = GeneratedKind | typeof AGENT_FILTER | null;

/** Whether an agent wrote any of these, which is what decides if "Claude" is worth offering as a filter. */
export function hasAgentEntries(entries: readonly UnattendedEntry[]): boolean {
  return entries.some(e => e.actor === 'agent');
}

/**
 * Narrows a ledger to one generator, or to Claude's rows, for the filter on
 * the screen.
 *
 * `null` means no filter rather than "the entries with no kind" — the two
 * sweeps are reached by their own action, not by a null kind, because a filter
 * offering "nothing" as a choice reads as a bug. Claude's rows are matched by
 * `actor`, not `kind`, since an agent's entry has no generator.
 */
export function filterUnattended(
  entries: readonly UnattendedEntry[],
  filter: ActivityFilter,
): UnattendedEntry[] {
  if (filter === null) return [...entries];
  if (filter === AGENT_FILTER) return entries.filter(e => e.actor === 'agent');
  return entries.filter(e => e.actor !== 'agent' && e.kind === filter);
}
