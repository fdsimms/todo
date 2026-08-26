import type { Person } from '../types';

/**
 * A person-level field the Backfill screen can walk and fill in, one person at
 * a time — the same mechanism as `fieldBackfill.ts`/`categoryBackfill.ts`/
 * `projectBackfill.ts`, over `Person`.
 *
 * **Read `docs/arch/people.md` before changing anything here.** A wizard that
 * walks your friends one at a time is exactly the shape the doc's opening list
 * warns about, and three of its rules decide what this module may and may not
 * do:
 *
 * - **The queue is in the user's own order, never a derived one** (see
 *   `personBackfillCandidates`). This is the one place this module deliberately
 *   departs from its three siblings, which all sort by name.
 * - **Nothing here reads history, a last-together date, or a day count.**
 *   "Missing" is only ever a field sitting at its own default. The screen may
 *   offer a cadence out of somebody's own history once it has one to offer
 *   (rule 5, `observedCadenceDays`), but that is an offer made on the card, not
 *   an input to who gets asked about or in what order.
 * - **A dismissal is about the field, not about the person.** See
 *   `Person.backfillDismissedFields`.
 *
 * The three fields are the three that actually unlock something: a birthday
 * turns on the birthday generators, a cadence turns on the reach-out nudge, and
 * `askAbout` is what makes that nudge a reason to get in touch rather than a
 * prompt to. Deliberately **not** covering `nickname`, `notes`, `email` or
 * `linkUrl`: walking somebody through their friends asking for nicknames is
 * data entry about the people you love, which is the sixth bullet at the top of
 * the arch doc and the failure mode the whole feature is built around avoiding.
 */
export type PersonBackfillFieldId = 'birthday' | 'cadence' | 'askAbout';

export interface PersonBackfillFieldDef {
  id: PersonBackfillFieldId;
  /** The row's own label in `PersonEditor` — reused here so the field reads as
   * the same setting wherever it's found, same call the project fields make. */
  label: string;
  /**
   * What to call the field where a whole sentence won't fit: the review step's
   * header, and the buttons that name it.
   *
   * The project and category fields need no such thing because their editor
   * labels are already two or three words. `PersonEditor`'s cadence row is a
   * full sentence ("Remind me if we haven't talked in a while") because it sits
   * above the control it describes with a card's width to use; a nav-bar title
   * has neither. Same label wherever there's room for it, a short name where
   * there isn't, rather than truncating the long one into something unreadable.
   */
  shortLabel: string;
  /** One line explaining what the field does, shown under its row on the
   * field-picker step. */
  hint: string;
}

// Order matters: the order these render in on the field-picker step. Same
// order PersonEditor's own Birthday and Keeping in touch cards use.
export const PERSON_BACKFILL_FIELDS: PersonBackfillFieldDef[] = [
  {
    id: 'birthday',
    label: 'Birthday',
    shortLabel: 'Birthday',
    hint: 'The month and day they were born, so a reminder can arrive before it comes around.',
  },
  {
    id: 'cadence',
    label: "Remind me if we haven't talked in a while",
    shortLabel: 'Catch-up reminder',
    hint: 'How long with nothing on file before a catch-up task offers itself. Off for everyone until you set one.',
  },
  {
    id: 'askAbout',
    label: 'Ask about',
    shortLabel: 'Ask about',
    hint: 'Something to ask them about next time, so that reminder names a reason instead of just saying to catch up.',
  },
];

/**
 * Whether `person` still has `fieldId` at its default — the backfill queue's
 * inclusion test.
 *
 * Nothing here is a judgment about the person, and that is worth stating
 * because the word "missing" invites one: a friend with no cadence is not
 * neglected, they are somebody the app has been told nothing about, which is
 * the state rule 4 says every person starts in and most people should stay in.
 */
export function isPersonFieldMissing(person: Person, fieldId: PersonBackfillFieldId): boolean {
  switch (fieldId) {
    // The month and the day are always written as a pair (see Person), so
    // either one being null means there is no birthday on file. birthYear is
    // deliberately not part of the test: a birthday with no year is the common
    // case and is not missing data — see "The birthday picker" in the arch doc.
    case 'birthday':
      return person.birthdayMonth === null || person.birthdayDay === null;
    // The gate, not the cadence value — the same call `isProjectFieldMissing`
    // makes about `nudgeOptIn`. The editor keeps the two in step (setting a
    // cadence *is* the opt-in), but a row restored from a backup written by an
    // older version, or synced from another device, can carry a number with the
    // gate still off, and that person has still never been opted in.
    case 'cadence':
      return !person.nudgeOptIn;
    case 'askAbout':
      return person.askAbout.trim() === '';
  }
}

/**
 * Whether the user has told the backfill screen not to ask about `fieldId` for
 * this person again — "I'm not going to put a birthday on this one", not "not
 * right now" (that's the screen's own session-only `skippedIds`, which never
 * touches the person). See `Person.backfillDismissedFields`.
 */
export function isPersonBackfillDismissed(person: Person, fieldId: PersonBackfillFieldId): boolean {
  return person.backfillDismissedFields.includes(fieldId);
}

/**
 * Who is still at the default for `fieldId`, **in the user's own order**.
 *
 * `sortOrder`, not `name.localeCompare` — and this is the one line where a
 * faithful copy of the task/category/project siblings would break a rule the
 * arch doc states outright. That list ("Sorting people by neglect, anywhere,
 * including as a non-default option") rules out a derived order, and the
 * positive half of the same rule is that the hand drag on the People screen is
 * *the only ranking the feature contains*, because it is the one somebody made
 * on purpose. Alphabetical is a milder re-rank than by-neglect, but it is still
 * the app replacing an order the user set with one it worked out, and there is
 * no reason to: the People screen's own order is right here and means something.
 * `reachOutTasks` breaks its cap tie the same way for the same reason.
 *
 * Archived people are out: archiving is an explicit "keep this, out of my way",
 * and chasing somebody for a birthday after they have been filed away is the
 * opposite of what that said. Same exclusion `activePeople` already makes.
 *
 * There is no from-scratch mode here, unlike the task fields. Redoing a field
 * wholesale means being walked past every person you know to reconsider a
 * cadence for each of them, which is the "sort your friends into tiers"
 * afternoon the arch doc opens by refusing.
 */
export function personBackfillCandidates(people: Person[], fieldId: PersonBackfillFieldId): Person[] {
  return people
    .filter(p =>
      !p.archived &&
      isPersonFieldMissing(p, fieldId) && !isPersonBackfillDismissed(p, fieldId)
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * How many people are still at the default for each field, for the
 * field-picker step's counts.
 *
 * A count of the gaps in your own list, which is a different thing from a count
 * *about* anybody — the arch doc bans the latter (a badge, a header count, "N
 * waiting" under somebody's name) because a number under a person's name reads
 * as a tally against them. This one has no person attached and never appears on
 * a card, only on the field row that says whether the field is worth opening.
 * `peopleStats.ts` draws the same line one shelf over: aggregates about you are
 * fine, aggregates about individual people are not.
 */
export function personBackfillFieldCounts(people: Person[]): Record<PersonBackfillFieldId, number> {
  const counts = { birthday: 0, cadence: 0, askAbout: 0 } as Record<PersonBackfillFieldId, number>;
  for (const p of people) {
    if (p.archived) continue;
    for (const field of PERSON_BACKFILL_FIELDS) {
      if (isPersonFieldMissing(p, field.id) && !isPersonBackfillDismissed(p, field.id)) counts[field.id]++;
    }
  }
  return counts;
}

/**
 * The patch that records "don't ask about this field for this person" —
 * appended to whatever else is already dismissed, deduped, so dismissing twice
 * is a no-op rather than growing the array. Same shape as the task, category
 * and project `dismiss*BackfillField` helpers.
 */
export function dismissPersonBackfillField(
  person: Person, fieldId: PersonBackfillFieldId
): Pick<Person, 'backfillDismissedFields'> {
  return {
    backfillDismissedFields: person.backfillDismissedFields.includes(fieldId)
      ? person.backfillDismissedFields
      : [...person.backfillDismissedFields, fieldId],
  };
}

/**
 * The `cadenceDays`/`nudgeOptIn`/`cadenceSetAt` trio to write for a chosen
 * cadence — the same three `PersonEditor.saveAndClose` writes, so a person
 * opted in here reads identically to one opted in from their own editor.
 *
 * **`cadenceSetAt` is stamped only on the off→on transition**, which is the
 * whole reason this is a helper rather than three fields spread inline at the
 * call site. It is the clock a person with no history is measured against, so
 * re-stamping it for somebody already opted in would silently restart their
 * wait — and the backfill screen can reach an already-opted-in person, through
 * its Previous button, even though the queue itself never offers one.
 *
 * A cadence of 0 is not an opt-in: `days` below 1 hands back the off state
 * whole (cleared anchor included), which is what the editor's own
 * `nudgeOptIn = cadenceDays > 0` rule says. That keeps "opted in to nothing"
 * unrepresentable rather than leaving it to the caller to avoid.
 */
export function personCadencePatch(
  person: Person, days: number
): Pick<Person, 'cadenceDays' | 'nudgeOptIn' | 'cadenceSetAt'> {
  if (days < 1) return { cadenceDays: 0, nudgeOptIn: false, cadenceSetAt: null };
  return {
    cadenceDays: days,
    nudgeOptIn: true,
    cadenceSetAt: person.nudgeOptIn ? person.cadenceSetAt : new Date().toISOString(),
  };
}
