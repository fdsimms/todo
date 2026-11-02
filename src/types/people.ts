/**
 * Someone you want to keep track of — see `docs/arch/people.md`, which holds
 * the rules this shape exists to serve and is not optional reading.
 *
 * The short version, because it decides what may and may not be added here: the
 * app can never know the state of a friendship, only what got written down, so
 * it never asserts a state. There is deliberately **no score, streak, tier,
 * closeness rank or "last contacted" column**, and adding one is the way this
 * feature turns into the thing it was built not to be. What "last together"
 * means is derived from completed tasks carrying this person's id, at read
 * time, the way `probablyHaveReason` derives a cupboard nobody can see into.
 */
export interface Person {
  id: string;
  name: string;
  // 'individual' unless set otherwise. 'business' marks an entry that isn't a
  // person — an optometrist, a vet, a dry cleaner — so the app stops reading
  // its name the way it reads a person's: the "@" mention index and the
  // calendar-title guess in calendarHistory.ts both answer to a name's first
  // word on the assumption that it's a first name ("@gideon" for "Gideon
  // Reyes"), which turns a company name like "Eye Q" into "Eye" as though it
  // were somebody's given name. Business entries skip that fallback. It also
  // turns the reach-out nudge off outright — see docs/arch/people.md,
  // "Businesses don't get check-ins" — because a business has no cadence to
  // keep up with; the editor hides the cadence field for one accordingly.
  kind: 'individual' | 'business';
  // What you'd actually call them, when that isn't their name. Display falls
  // back to `name`, so leaving it empty is the normal case rather than a gap.
  // May hold several, comma-separated; read it through `src/utils/nicknames.ts`.
  nickname: string;
  notes: string;
  // Hand-ordered, like categories and aisles, and never re-ranked by recency or
  // by how long it's been. The order of this list is the only ranking the
  // feature contains, and it's one the user made on purpose.
  sortOrder: number;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  // Held at the top of the People list, above the people/business sections.
  // Something you chose one person at a time, like pinning a task: it moves a
  // row up and never ranks anybody against anybody (pinned people are still A to
  // Z among themselves). Off for every new person and never set by the app.
  pinned: boolean;

  // Month (1-12) and day, held apart from the year because the year is the part
  // people genuinely don't know — a birthday with no year is the common case and
  // not missing data. Null month/day together mean no birthday on file; the two
  // are always written as a pair.
  birthdayMonth: number | null;
  birthdayDay: number | null;
  // Recorded for its own sake, never derived from and never read to compute an
  // age — that use (a "Turning 34" chip) was removed in #2083, and this is a
  // second, unrelated life for the same column: something worth knowing about
  // somebody, not an input to arithmetic. Optional even once a birthday is on
  // file (most people's is the common case, see docs/arch/people.md), but
  // never set on its own: clearing the birthday clears this too, the same
  // "both halves together" rule birthdayMonth/Day already follow.
  birthYear: number | null;
  // When the user deleted this person's birthday task (see
  // src/utils/birthdayTasks.ts). The per-source opt-out every generated task
  // writes on its source row, and unlike `Project.reviewDeclinedAt` a permanent
  // one: "don't remind me about this birthday" is a durable thing to have said,
  // where "this project isn't worth reviewing today" is not.
  birthdayTaskOptOut: boolean;
  // The same permanent "no", one field over, for the gift task rather than the
  // reminder itself (see src/utils/birthdayTasks.ts). A separate field because
  // the two are separate decisions: somebody might want the day marked on
  // their list without wanting a second row about buying anything for it.
  birthdayGiftTaskOptOut: boolean;

  // Enough to reach them, and nothing more. phoneNumber is stored as typed, the
  // same decision `Task.phoneNumber` documents — a canonical dial string needs a
  // country the app never asks for. It's copied onto a generated task so the
  // row's existing call and text buttons work, which is the whole reason it's
  // here rather than left to the system contact card.
  phoneNumber: string | null;
  // Stored as typed, like phoneNumber. Nothing dials or sends to it: it is a
  // number to read off the card, which is why it is not copied onto a task.
  faxNumber: string | null;
  email: string | null;
  // Anything else that opens them: a chat app, a profile. Same field and same
  // meaning as `Task.linkUrl`.
  linkUrl: string | null;

  // Days of quiet before this person's reach-out nudge offers itself. 0 = never,
  // which is what every person starts as. Stored as a plain day count and shown
  // as "2 weeks" by nudgeCadence.ts, exactly like `Project.nudgeCadenceDays`.
  cadenceDays: number;
  // Off by default, and the real gate: nothing about a person may appear in any
  // nudge surface until this is explicitly true. Same rule as
  // `Project.nudgeOptIn` and for the same reason — the annoying half of a nudge
  // feature is the half you get without asking for it. It is also what keeps
  // "ranking" a non-question, since most people have no cadence to compare.
  nudgeOptIn: boolean;
  // When the cadence was last turned on — null while `cadenceDays` is 0. This is
  // the clock a brand-new person with no history is measured against, so opting
  // somebody in doesn't itself read as "it has already been long enough": the
  // first nudge waits out the cadence from here, the same as it would once real
  // history exists. Untouched by an editor tweak to the number while already
  // opted in, only by the off→on transition; cleared when cadenceDays drops back
  // to 0, so opting in again later starts the wait over rather than reading as
  // still-running from the first time.
  cadenceSetAt: string | null;
  // When the user last swiped away this person's reach-out task. A stamp that
  // lapses, never a verdict: the only permanent fields available are the two
  // above, and both mean "never chase me about this person again", which is far
  // more than one swipe says.
  reachOutDeclinedAt: string | null;
  // When the "turn off reminders for X" offer (WhenPicker's reach-out variant
  // of PostponeCheckBanner, shown once a reach-out task has been pushed past
  // the threshold) was last declined by deferring the task again instead of
  // accepting it. Same lapsing-stamp shape as reachOutDeclinedAt above, and
  // deliberately its own field rather than reusing that one: that stamp
  // records declining the *row* (a swipe on Today), this one declining the
  // *offer* — see docs/arch/people.md, "the reach-out nudge".
  reachOutOfferDeclinedAt: string | null;
  /**
   * Something to ask them about next time — "the new job", "how the move went".
   *
   * Rule 7 in miniature, and the field that keeps the nudge from being purely a
   * clock: when it is set, the reach-out task's title becomes "Ask Tessa about
   * the new job" instead of "Catch up with Tessa". A reason to get in touch
   * beats a prompt to.
   *
   * Empty on every person and never filled in by the app. It is a note you
   * wrote, which is the whole point of it.
   */
  askAbout: string;
  /**
   * Which Backfill fields (see `src/utils/peopleBackfill.ts`) this person has
   * been told to stop asking about — same mechanism and same reasoning as
   * `Project.backfillDismissedFields`, holding `PersonBackfillFieldId` values
   * as plain strings since a `Person` field can't depend on a type from
   * `src/utils`.
   *
   * It records a decision about *your own list*, never one about them: "this
   * person's birthday isn't something I want on file" rather than anything
   * ranking or grading anybody. The two permanent fields above
   * (`birthdayTaskOptOut`, `birthdayGiftTaskOptOut`) are about what the app
   * writes; this one is only about what it asks.
   */
  backfillDismissedFields: string[];
  /**
   * The `PersonGroup` this person belongs to, or null. A couple or a
   * household you always catch up with together, so the reach-out nudge can
   * fold them into one task instead of asking about each of them apart —
   * see `docs/arch/people.md`'s "Groups" section. Single-valued, like
   * `Task.groupId` pointing at a `TaskGroup`: a person is a member of at most
   * one group at a time.
   */
  groupId: string | null;
  /**
   * Where this person lives — free text ("Austin, TX"), typed once and read
   * back, never geocoded or validated against a real place. The editor can
   * suggest places from Apple Maps (`usePlaceSuggestions`, behind the
   * `placeSuggestionsEnabled` switch), but a pick is written as text and no
   * coordinate is kept. Same shape as
   * `Project.destination`: a fact you wrote down, not an input to arithmetic.
   * Exists so a person can be found by place when planning a trip
   * (`src/utils/peopleLocations.ts`), not to sort or group people by anything
   * that ranks them — the trip planner reads it as a plain substring match.
   */
  location: string | null;
  /**
   * Their street address, as typed over as many lines as they need. Free text
   * like `location`, and a different question: `location` is the town, read by
   * the trip planner as a plain substring match, while this is the full
   * address to read off the card (mailing a gift, finding the door). It is
   * never geocoded, never sorted or grouped by, and nothing matches against it.
   */
  address: string | null;
  /**
   * Days worth remembering besides the birthday: an anniversary, the day you
   * met, the day they started a new job. Each can repeat every year or happen
   * once, and each can put a task on the list a few days ahead, the way the
   * birthday does (`src/utils/personDateTasks.ts`).
   *
   * Optional so a row written before this existed reads as having none, and a
   * JSON list on the row rather than a table of its own: a date is edited only
   * from its person's editor, travels with that person, and is never looked up
   * on its own.
   */
  dates?: PersonDate[];
}

/**
 * One date on a person besides their birthday (see `Person.dates`).
 *
 * Month and day are stored apart from the year for the reason `Person` stores
 * a birthday that way: February 29 clamps to the 28th in a common year without
 * the clamp ever feeding the next one. `year` is optional for a yearly date
 * ("our anniversary is June 14", year not given) and required for a one-off,
 * which has no other way to say when it is.
 */
export interface PersonDate {
  id: string;
  /** What the day is, as the person wrote it: "Anniversary", "Met", "Started new job". */
  label: string;
  /** 1 to 12. */
  month: number;
  day: number;
  year: number | null;
  /** Comes round every year. False is a one-off on `year` itself. */
  yearly: boolean;
  /**
   * Whether a task shows up ahead of it. Turned off by deleting that task, the
   * permanent "no" `Person.birthdayTaskOptOut` is for a birthday.
   */
  remind: boolean;
}

/**
 * A couple, a household, anyone you'd never think to catch up with
 * separately — a lightweight, renameable label a `Person` hangs off of via
 * `Person.groupId`, the same "label, not a join table" shape `TaskGroup`
 * uses for stacks. It carries no cadence, no history and no nudge settings
 * of its own: those stay on each `Person`, and a group only changes how the
 * reach-out nudge presents people who share one (see
 * `collapseGroupedReachOuts` in `src/utils/reachOutTasks.ts`) and how an
 * "@name" mention resolves (see `docs/arch/people.md`).
 */
export interface PersonGroup {
  id: string;
  name: string;
  // Hand-ordered, the same independent number space Person.sortOrder is —
  // never re-ranked by recency or by anything about the people in it.
  sortOrder: number;
  createdAt: string;
  /**
   * Whether the reach-out nudge treats each member on their own instead of the
   * group as one candidate. Off by default, which is how every group behaved
   * before this existed. On: no "Catch up with {group}" row, and a member's
   * last-together date reads only the tasks naming them, so seeing one half of
   * a couple does not reset the other's clock. The "@" mention still tags the
   * whole group either way.
   */
  catchUpSeparately: boolean;
}

/**
 * What kind of thing a `PersonNote` is. Two, and each has exactly one place
 * it shows up, which is what keeps them from blurring into one another:
 *
 * - `note` — something to remember, on the person's own screen.
 * - `gift` — something to get them, carried onto the birthday task.
 *
 * A third, `food`, was for the meal plan's guests and went with them. A stored
 * `food` row reads back as a `note` (`rowToPersonNote`), so nothing written
 * under it is lost.
 */
export type PersonNoteKind = 'note' | 'gift';

export const PERSON_NOTE_KINDS: readonly PersonNoteKind[] = ['note', 'gift'];

/**
 * One thing you wrote down about somebody — see `docs/arch/people.md`.
 *
 * Rule 7 in full, and the only genuinely novel part of the feature: the most
 * valuable thing an app can do here is not "maintain relationship #4", it is
 * "Tessa starts the new job in September, ask her about it". A note like that,
 * resurfaced at the right moment, makes you a better friend, and it cannot be
 * read as ranking anybody.
 *
 * **Rows rather than fields on `Person`**, unlike `askAbout` beside it. The
 * argument the arch doc makes for `Task.personIds` being a JSON array does not
 * apply here: task rows get copied constantly (a recurrence successor, a series
 * member, a chain step) and a JSON column rides every copy for free, where a
 * person row is never copied at all. What these need instead is to be added and
 * removed one at a time and to carry their own date, which is a row.
 *
 * Everything about this is optional and empty by default. A person with no
 * notes shows no section at all, never an empty prompt to start filing facts
 * about your friends.
 */
export interface PersonNote {
  id: string;
  /**
   * Whose note it is. Resolve-or-shrug like every other pointer in the people
   * layer: a note whose person is gone is simply never read, and nothing
   * rewrites rows a delete isn't otherwise touching.
   */
  personId: string;
  kind: PersonNoteKind;
  text: string;
  createdAt: string;
  /**
   * The day this note is *about*, or null for one that is always true.
   *
   * **This is the whole distinction from `Person.notes`**, which is a static
   * description. A dated note can go stale: "Tessa starts the new job in
   * September" stops being a thing to ask about once you have asked, and the
   * app's job is to show it quieter rather than to delete it or to nag. Null is
   * the common case and is not missing data — "no shellfish" is not about a day.
   *
   * ISO, like every other date in the app.
   */
  relevantOn: string | null;
  /**
   * Filed away: kept, out of the way. The same "keep this, out of my way"
   * archiving means everywhere else, and the reason a stale note is never
   * deleted on the app's own initiative.
   */
  archivedAt: string | null;
  /** Orders notes of one kind within one person. The user's own drag order. */
  sortOrder: number;
}
