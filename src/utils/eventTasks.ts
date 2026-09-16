import type { BusyEvent } from './calendarBusy';
import { isLiveEvent } from './calendarBusy';
import type { EventTaskRule, Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import { generateId } from './id';

/**
 * Event rules — "when something on the calendar says *flight*, add a task to
 * pack, three days before".
 *
 * The rules module for the `eventTask` generator (see `generatedTasks.ts` and
 * `docs/arch/generated-tasks.md`), store-free like `weatherTasks.ts` and
 * `calendarReviewTasks.ts` beside it: orchestration — reading settings,
 * reading the calendar window, calling `reconcileGeneratedTask` — lives in
 * `useTaskStore.ts`'s `checkEventTasks`. What's here is the storage
 * round-trip for the rule list, the matching predicate, and the handled
 * record's own pruning.
 *
 * **This is the first generator whose cue is text, and the boundary it works
 * inside is already written down.** `docs/arch/people.md`'s "Where the two
 * lines actually fall" settles that event *titles* are readable and attendees
 * are not, and that the app may not decide something is true off a title. This
 * does not decide: the user supplies both the word and the task, so the app is
 * only noticing that the word is present. That is exactly where `weatherTasks`
 * and `screenTimeRules` already sit, and it is the reason this may write a row
 * where `calendarHistory.ts` — which infers a meaning the user never stated —
 * may only offer one.
 *
 * **What it deliberately does not do is parse.** No date, no duration, no
 * category and no priority is read out of an event title, and `parseTaskInput`
 * is not reached for. That parser is built for text typed into this app behind
 * a sigil ("#home", "!high", "tmrw 5p"), and `calendarHistory.ts` already
 * states the asymmetry this side of it: a deliberate sigil earns a low bar, a
 * title somebody wrote for another purpose entirely gets the higher one. An
 * event also already carries a real date from EventKit, so the one field a
 * parse could plausibly contribute is the one field that needs it least.
 */

/** A rule can't be an empty task title — nothing to show on Today. */
export const EVENT_RULE_TITLE_MAX_LENGTH = 80;

/** Nor an empty cue, and the same ceiling keeps a stored phrase sane. */
export const EVENT_MATCH_MAX_LENGTH = 60;

/**
 * The shortest cue a rule may match on.
 *
 * `MIN_CALENDAR_NAME_LENGTH`'s reasoning, arrived at for names and true of any
 * word: a two-character cue is inside far too much. "PT" sits in nothing
 * useful and "Dr" is in "Drinks"; three is the floor rather than a cleverer
 * rule because the alternative is scoring a match, and a rule the user has to
 * *predict* is worse than one that occasionally misses.
 */
export const EVENT_MATCH_MIN_LENGTH = 3;

/**
 * The most keywords a single rule may carry.
 *
 * Each one is its own whole-word test, and `ruleMatchesTitle` runs every one
 * of them against every eligible event — a ceiling here is what keeps that
 * bounded, the same reasoning `DEFAULT_PILL_LIMIT` applies to an open-ended
 * pill grid. Six is generous for "flight / plane / layover / airport" and
 * still small enough to read as one rule rather than a list.
 */
export const EVENT_RULE_MAX_MATCHES = 6;

/**
 * The longest lead a rule may carry, and it is a mechanical ceiling rather
 * than a product one.
 *
 * `useCalendarStore` reads a 14-day forward window, so an event further out
 * than that is not visible to this generator at all. A rule with a 20-day lead
 * would therefore be asked to write its task on a day when the event it is
 * about cannot yet be seen — it would simply never fire, silently, which is
 * the worst way for a setting to be wrong. Kept in step with
 * `CALENDAR_WINDOW_DAYS` by the test that pins them together.
 */
export const EVENT_LEAD_DAYS_MAX = 14;

/**
 * The two rules the feature ships with, pre-filled the way
 * `defaultWeatherRules` is: the app knows the shape of the answer, and typing
 * one from scratch is the trip a shipped default saves. Both still carry their
 * own `enabled`, and the generator's settings toggle (`eventTasks`) ships off
 * — see `GENERATED_KIND_SPECS.eventTask` — so nobody sees a task from these
 * until they turn the feature on.
 */
export function defaultEventRules(): EventTaskRule[] {
  return [
    { id: generateId(), matches: ['flight'], title: 'Pack a bag', leadDays: 2, enabled: true },
    { id: generateId(), matches: ['dentist'], title: 'Bring your insurance card', leadDays: 0, enabled: true },
  ];
}

/**
 * `eventRules` off `dbGetSetting`, defensively — same shape as
 * `parseWeatherRules`: a malformed or missing stored value reads as "nothing
 * saved yet" rather than throwing, and a bad entry is dropped rather than
 * discarding the whole list.
 *
 * **Reads a legacy single `match` string as a one-entry `matches` array.**
 * An install that saved rules before multi-keyword support shipped has
 * `match: 'flight'` on disk, not `matches`; the array field wins when both
 * are present (nothing writes both), so this is read-compatibility only —
 * `setEventRules` always writes the new shape.
 */
export function parseEventRules(raw: string | null | undefined): EventTaskRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: EventTaskRule[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const r = entry as Partial<EventTaskRule> & { match?: unknown };
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, EVENT_RULE_TITLE_MAX_LENGTH) : '';
    const rawMatches = Array.isArray(r.matches)
      ? r.matches
      : typeof r.match === 'string' ? [r.match] : [];
    const matches: string[] = [];
    for (const m of rawMatches) {
      if (typeof m !== 'string') continue;
      const cue = m.trim().slice(0, EVENT_MATCH_MAX_LENGTH);
      if (cue && !matches.some(existing => existing.toLowerCase() === cue.toLowerCase())) matches.push(cue);
      if (matches.length >= EVENT_RULE_MAX_MATCHES) break;
    }
    // Both halves are required: a rule with no cue matches everything and a
    // rule with no title has nothing to write. Dropped rather than repaired,
    // the call parseWeatherRules makes about a titleless entry.
    if (!title || matches.length === 0) continue;
    const leadDays = typeof r.leadDays === 'number' && Number.isFinite(r.leadDays)
      ? Math.min(EVENT_LEAD_DAYS_MAX, Math.max(0, Math.round(r.leadDays)))
      : 0;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : generateId(),
      matches,
      title,
      leadDays,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

/** Same escape `calendarHistory.ts` uses, for the same whole-word test below. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether **any** of `rule`'s keywords appears in an event title.
 *
 * Whole-word and case-insensitive, the identical test `peopleNamedInTitle`
 * applies (`(?<![a-z0-9]) … (?![a-z0-9])`), so "gym" does not fire on
 * "Gymnastics recital" and "PT" would not fire on "Optometrist" even if the
 * length floor let it through. A multi-word cue ("parent evening") works the
 * same way, with runs of whitespace in the title flattened first so a wrapped
 * or double-spaced title still matches. A rule with several keywords is an
 * OR: "flight" or "layover" or "airport" each independently fire it.
 */
export function ruleMatchesTitle(rule: EventTaskRule, title: string): boolean {
  const haystack = title.replace(/\s+/g, ' ').toLowerCase();
  if (!haystack) return false;
  return rule.matches.some(match => {
    const cue = match.trim().toLowerCase();
    if (cue.length < EVENT_MATCH_MIN_LENGTH) return false;
    const pattern = new RegExp(`(?<![a-z0-9])${escapeRegExp(cue)}(?![a-z0-9])`);
    return pattern.test(haystack);
  });
}

/**
 * The secondary line under a rule's title in `EventRulesSheet` — what it
 * matches, and when it fires relative to the event.
 *
 * Lives here rather than inline in the sheet for the reason
 * `weatherConditionLabel` does: it is the rule read back as a sentence, which
 * is a property of the rule rather than of the row drawing it, and it is
 * testable without a renderer.
 */
export function describeEventRule(rule: EventTaskRule): string {
  const cues = rule.matches.map(m => m.trim()).filter(Boolean);
  const words = cues.length > 0 ? cues.map(c => `"${c}"`) : ['"anything"'];
  const cue = words.length === 1
    ? words[0]
    : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
  if (rule.leadDays === 0) return `${cue} · same day`;
  if (rule.leadDays === 1) return `${cue} · 1 day before`;
  return `${cue} · ${rule.leadDays} days before`;
}

/**
 * The events a rule may be applied to at all.
 *
 * Three refusals, each of which is something that is not an appointment you
 * can prepare for:
 *
 * - **Nothing cancelled** (`isLiveEvent`) — the same call every other reader
 *   of this data makes.
 * - **Nothing already started.** A lead time is time *before* something, so a
 *   meeting that is under way has no preparation left to ask for. This is what
 *   stops a rule turned on this afternoon writing tasks for this morning.
 * - **All-day events are kept.** They are the one place `calendarBusy`'s own
 *   exclusion does not carry over: an all-day event is not *minutes*, which is
 *   what `occupiesTime` is about, but "Dad's birthday" and "Conference" are
 *   exactly the kind of entry a lead-time rule is for.
 */
export function eventIsRuleEligible(event: BusyEvent, now: Date): boolean {
  if (!isLiveEvent(event)) return false;
  const start = Date.parse(event.start);
  if (!Number.isFinite(start)) return false;
  return start > now.getTime();
}

/**
 * One occurrence's identity, and the reason it is not the event id alone.
 *
 * EventKit hands back every instance of a recurring event under the same
 * `calendarItemIdentifier`, so a standing "Flight home" would be one id and
 * twelve occurrences. `EventReminder` and `HiddenEvent` are both keyed this
 * way already and for this reason; this is the third.
 */
export function eventOccurrenceKey(event: Pick<BusyEvent, 'id' | 'start'>): string {
  return `${event.id}|${event.start}`;
}

/** `${eventId}|${eventStart}#${ruleId}` — one occurrence and the rule that named it. */
export function eventTaskSourceId(occurrenceKey: string, ruleId: string): string {
  return `${occurrenceKey}#${ruleId}`;
}

/**
 * The reverse of `eventTaskSourceId`, or null for anything that isn't one.
 *
 * Split on the **last** `#` rather than the first: an occurrence key is built
 * from an EventKit identifier this app does not get to choose the shape of,
 * where a rule id is always `generateId()`'s own alphabet. Splitting the other
 * way would mis-parse the day an identifier happened to contain a `#`.
 */
export function parseEventTaskSourceId(
  sourceId: string | null,
): { occurrenceKey: string; ruleId: string } | null {
  if (!sourceId) return null;
  const i = sourceId.lastIndexOf('#');
  if (i < 0) return null;
  const occurrenceKey = sourceId.slice(0, i);
  const ruleId = sourceId.slice(i + 1);
  if (!occurrenceKey || !ruleId) return null;
  return { occurrenceKey, ruleId };
}

/** The rule id an event task was generated from, or null for any other task. */
export function eventTaskRuleIdOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return parseEventTaskSourceId(generatedSourceOf(task, 'eventTask'))?.ruleId ?? null;
}

/**
 * What the app has already written a task for, or considered and answered.
 *
 * Keyed by `eventTaskSourceId`, valued by the event occurrence's own end
 * instant (ISO) so the record can prune itself without going back to the
 * calendar. This is `remindersImportHandled`'s shape, not the generic
 * `(kind, sourceId)` suppression record `generatedTasks.ts` rules out — the
 * objection there is that a generic one grows without bound because nothing
 * general can say when an entry stops mattering. Here something can: an
 * occurrence that is over is never coming back, which is the same expiry
 * `pruneStaleReminders` and `pruneStaleHiddenEvents` already run on.
 *
 * It is what stands between a swiped-away task and the next foreground sweep,
 * the job `WeatherRule.lastFiredDayKey` does one shelf over. A rule there can
 * carry its own mark because it asks one question a day; a rule here is asked
 * about every event in a fourteen-day window at once, so the mark has to name
 * the occurrence rather than the day.
 */
export type HandledEventTasks = Record<string, string>;

/**
 * `eventTaskHandled` off `dbGetSetting`, defensively — same shape as
 * `parseEventRules`: an unreadable value reads as "nothing handled yet", and a
 * single bad entry is dropped rather than discarding the record. Erring toward
 * dropping is right here and is the opposite of the call `remindersImport`'s
 * name index makes: a lost entry costs one duplicate task the user can delete,
 * where a bogus one suppresses a rule for ever with nothing to point at.
 */
export function parseHandledEventTasks(raw: string | null | undefined): HandledEventTasks {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: HandledEventTasks = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key || typeof value !== 'string') continue;
    if (!Number.isFinite(Date.parse(value))) continue;
    out[key] = value;
  }
  return out;
}

/** Drops every entry whose occurrence has finished. */
export function pruneHandledEventTasks(
  handled: Readonly<HandledEventTasks>,
  now: Date,
): HandledEventTasks {
  const kept: HandledEventTasks = {};
  for (const [key, endsAt] of Object.entries(handled)) {
    const end = Date.parse(endsAt);
    // An unparseable value has no expiry to judge and would otherwise be
    // immortal, so it is dropped rather than kept — the cost is one task
    // possibly written twice, against a record that never empties.
    if (Number.isFinite(end) && end > now.getTime()) kept[key] = endsAt;
  }
  return kept;
}

/** One rule/event pairing the sweep has decided to act on. */
export interface EventTaskMatch {
  sourceId: string;
  rule: EventTaskRule;
  event: BusyEvent;
  /** ISO — when this occurrence ends, which is when its handled entry expires. */
  endsAt: string;
}

/**
 * Every task the rules want written, given the calendar window as it stands.
 *
 * Pure, and `now`-injected rather than reading the clock, so the whole
 * decision is testable without a device. Ordering is by event start and then
 * by the rule's position in the list, so a sweep is deterministic and two
 * devices reconciling the same window agree.
 *
 * **A rule is only applied once its lead time has been reached.** A two-day
 * rule against a flight next Friday matches the flight today, but the task
 * belongs on Wednesday, and writing it now would put a row on Today that is
 * not about today — the thing `mealPlanNudge` gets to do deliberately and this
 * has no case for. So the match is held until the day it is due, which is also
 * what makes the fourteen-day window enough: by the time a task is wanted, its
 * event is at most `leadDays` away.
 */
export function matchedEventTasks(
  rules: readonly EventTaskRule[],
  events: readonly BusyEvent[],
  now: Date,
  handled: Readonly<HandledEventTasks>,
): EventTaskMatch[] {
  const out: EventTaskMatch[] = [];
  const eligible = events
    .filter(event => eventIsRuleEligible(event, now))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  for (const event of eligible) {
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!ruleMatchesTitle(rule, event.title)) continue;
      const sourceId = eventTaskSourceId(eventOccurrenceKey(event), rule.id);
      if (sourceId in handled) continue;
      if (!leadTimeReached(event, rule, now)) continue;
      out.push({ sourceId, rule, event, endsAt: event.end });
    }
  }
  return out;
}

/**
 * Whether the day a rule's task belongs on has arrived.
 *
 * Compared on whole local days rather than on a 48-hour subtraction, so a
 * two-day rule against a Friday evening flight lands on Wednesday whatever
 * hour the sweep happens to run at. Deliberately not `dayResetTime`-aware:
 * both sides of this comparison come off the *event's* own calendar date, and
 * the day a task is written on is decided by `dueDate` below rather than here.
 */
export function leadTimeReached(event: BusyEvent, rule: EventTaskRule, now: Date): boolean {
  const start = new Date(event.start);
  const firesOn = new Date(start.getFullYear(), start.getMonth(), start.getDate() - rule.leadDays);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return firesOn.getTime() <= today.getTime();
}
