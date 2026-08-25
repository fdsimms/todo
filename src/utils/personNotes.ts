import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { isSameYear } from 'date-fns/isSameYear';
import type { PersonNote, PersonNoteKind } from '../types';

/**
 * The memory layer — see `docs/arch/people.md`.
 *
 * **Rule 7 in full, and the part that makes the feature a thing you like
 * rather than a thing you tolerate.** The most valuable thing an app can do
 * here is not "remind me to maintain relationship #4", it is "Ansley starts the
 * new job in September, ask her about it". `Person.askAbout` was a one-field
 * slice of this, shipped early so the first nudge anybody sees is warm; this is
 * the rest of it.
 *
 * Three kinds, and each has exactly one place it shows up, which is what keeps
 * them from blurring: a `note` on the person's own screen, a `gift` carried
 * onto the birthday task, a `food` note shown on a meal they're a guest at.
 *
 * **Nothing here scores, ranks, counts or grades anybody.** It sorts notes,
 * says which have gone stale, and hands each kind to its one reader. A count of
 * how many notes somebody has would be a number about a person, and there is
 * nowhere in this feature that may show one.
 *
 * Pure, and takes `today` rather than reading the clock.
 */

/** What each kind is called wherever the user sees it. */
export const PERSON_NOTE_LABELS: Record<PersonNoteKind, string> = {
  note: 'Note',
  gift: 'Gift idea',
  food: 'Food',
};

/** The uppercase section heading each kind sits under on a person's screen. */
export const PERSON_NOTE_HEADINGS: Record<PersonNoteKind, string> = {
  note: 'NOTES',
  gift: 'GIFT IDEAS',
  food: 'FOOD',
};

/**
 * What the sheet says the kind means, one line each.
 *
 * The only in-app documentation these have, same job a `CollapsibleField`'s
 * `hint` does. Each says where the note will actually turn up, because that is
 * the difference between the three and it is not guessable from the name.
 */
export const PERSON_NOTE_HINTS: Record<PersonNoteKind, string> = {
  note: 'Something to remember. Shows on their page.',
  gift: 'Something to get them. Shows on their birthday task.',
  food: "Something about what they eat. Shows on a meal they're a guest at.",
};

/** A note that is still live: not filed away, and with something in it. */
export function isLiveNote(note: PersonNote): boolean {
  return note.archivedAt === null && note.text.trim().length > 0;
}

/**
 * Whether a note's day has been and gone.
 *
 * **Stale is a display state, never a delete.** "Ansley starts the new job in
 * September" stops being a thing to ask about once September has passed, and
 * the honest thing is to show it quieter rather than to remove something the
 * user wrote or to keep presenting it as news. Nothing in the app deletes a
 * note on its own.
 *
 * A note with no day is never stale — "no shellfish" is not about a day, and
 * treating an undated note as expiring would quietly grey out the ones that are
 * always true.
 */
export function isStaleNote(note: Pick<PersonNote, 'relevantOn'>, today: Date): boolean {
  if (!note.relevantOn) return false;
  return differenceInCalendarDays(today, new Date(note.relevantOn)) > 0;
}

/**
 * One kind's notes, in the order they should be read.
 *
 * Dated notes lead, soonest first, because a day that is coming up is the one
 * thing here with a deadline on it. Undated notes follow in the user's own drag
 * order, and stale ones sink to the bottom — the only re-ranking in the people
 * layer that isn't the user's own, and it ranks *notes*, never people.
 */
export function notesOfKind(
  notes: readonly PersonNote[],
  personId: string,
  kind: PersonNoteKind,
  today: Date
): PersonNote[] {
  return notes
    .filter(n => n.personId === personId && n.kind === kind && isLiveNote(n))
    .sort((a, b) => {
      const staleA = isStaleNote(a, today);
      const staleB = isStaleNote(b, today);
      if (staleA !== staleB) return staleA ? 1 : -1;
      const datedA = a.relevantOn !== null;
      const datedB = b.relevantOn !== null;
      if (datedA !== datedB) return datedA ? -1 : 1;
      if (datedA && datedB) return a.relevantOn!.localeCompare(b.relevantOn!);
      return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
    });
}

/** Every live note for one person, whatever kind. */
export function notesFor(notes: readonly PersonNote[], personId: string): PersonNote[] {
  return notes.filter(n => n.personId === personId && isLiveNote(n));
}

/**
 * "Today", "Tomorrow", "In 3 days", "September 12", "Passed".
 *
 * Rule 2's line held: a date is a fact and a duration is a judgment, and the
 * durations allowed here are the short forward-looking ones that read as
 * anticipation rather than as a tally. **Nothing ever says how long a note has
 * been stale** — "94 days ago" about a thing you meant to ask is precisely the
 * scoreboard this feature refuses to be.
 */
export function describeNoteDay(relevantOn: string, today: Date): string {
  const at = new Date(relevantOn);
  const days = differenceInCalendarDays(at, today);
  if (days < 0) return 'Passed';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  return isSameYear(at, today) ? format(at, 'MMMM d') : format(at, 'MMMM d, yyyy');
}

/**
 * The gift ideas to hang off somebody's birthday task, as the task's notes.
 *
 * **This is the whole point of having written them down in March.** A birthday
 * task that arrives carrying "the pottery class, a proper chef's knife" is the
 * memory layer paying off; one that arrives saying only "Ansley's birthday" is
 * a reminder you already had.
 *
 * Stale gift ideas are dropped rather than sunk: a dated gift idea whose day
 * has passed is one you either bought or missed, and a birthday task is not the
 * place to be shown either. Empty string when there is nothing to say, which
 * the caller reads as "write no notes".
 */
export function giftIdeasText(
  notes: readonly PersonNote[],
  personId: string,
  today: Date
): string {
  const ideas = notesOfKind(notes, personId, 'gift', today)
    .filter(n => !isStaleNote(n, today))
    .map(n => n.text.trim());
  if (ideas.length === 0) return '';
  return ideas.map(text => `• ${text}`).join('\n');
}

/**
 * What the guests at one meal can't or won't eat, ready to render.
 *
 * The kitchen half of the app paying off in a way it could not without both
 * halves: remembering that Ansley cannot eat shellfish, at the moment you are
 * deciding what to cook her, is care rather than measurement.
 *
 * Named, because "one guest has a note" is useless and the name is the whole
 * value. Stale food notes are dropped for `giftIdeasText`'s reason — a dated
 * one ("dairy-free until March") that has passed is no longer true.
 */
export interface GuestFoodNote {
  personId: string;
  name: string;
  text: string;
}

export function guestFoodNotes(
  notes: readonly PersonNote[],
  guests: readonly { id: string; name: string }[],
  today: Date
): GuestFoodNote[] {
  const out: GuestFoodNote[] = [];
  for (const guest of guests) {
    for (const note of notesOfKind(notes, guest.id, 'food', today)) {
      if (isStaleNote(note, today)) continue;
      out.push({ personId: guest.id, name: guest.name, text: note.text.trim() });
    }
  }
  return out;
}
