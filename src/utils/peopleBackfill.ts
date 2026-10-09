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
 * The fields are the ones that actually unlock something: a birthday turns on
 * the birthday generators, a cadence turns on the reach-out nudge, `askAbout`
 * is what makes that nudge a reason to get in touch rather than a prompt to,
 * and `location` is what the trip planner (`peopleLocations.ts`) can search.
 * Deliberately **not** covering `nickname`, `notes`, `email` or `linkUrl`:
 * walking somebody through their friends asking for nicknames is data entry
 * about the people you love, which is the sixth bullet at the top of the arch
 * doc and the failure mode the whole feature is built around avoiding.
 */
export type PersonBackfillFieldId = 'birthday' | 'cadence' | 'askAbout' | 'location';

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
    hint: 'The month and day they were born, so a reminder can arrive ahead of time.',
  },
  {
    id: 'cadence',
    label: "Remind me if we haven’t talked in a while",
    shortLabel: 'Catch-up reminder',
    hint: 'How long with nothing on file before a catch-up task is added. Off until you set one.',
  },
  {
    id: 'askAbout',
    label: 'Ask about',
    shortLabel: 'Ask about',
    hint: 'Something to ask them about, so the catch-up reminder names a reason.',
  },
  {
    id: 'location',
    label: 'Location',
    shortLabel: 'Location',
    hint: 'Where they live, so you can find them when planning a trip.',
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
    // A business has no birthday field in the editor, so there is nothing to
    // ask for.
    case 'birthday':
      return person.kind !== 'business' && (person.birthdayMonth === null || person.birthdayDay === null);
    // The gate, not the cadence value — the same call `isProjectFieldMissing`
    // makes about `nudgeOptIn`. The editor keeps the two in step (setting a
    // cadence *is* the opt-in), but a row restored from a backup written by an
    // older version, or synced from another device, can carry a number with the
    // gate still off, and that person has still never been opted in.
    // A business never gets a reach-out nudge (see docs/arch/people.md,
    // "Businesses don't get check-ins"), so neither field that only feeds
    // that nudge is ever "missing" for one — there's nothing to backfill
    // toward. `askAbout` only colors the reach-out task's title, and a
    // business can't have one.
    case 'cadence':
      return person.kind !== 'business' && !person.nudgeOptIn;
    case 'askAbout':
      return person.kind !== 'business' && person.askAbout.trim() === '';
    case 'location':
      return !person.location || person.location.trim() === '';
  }
}

/**
 * Whether `fieldId` is a question for this person at all, set or not: the
 * `isPersonFieldMissing` gates that are about the kind of person rather than
 * about the value. A business has no birthday, and never gets a reach-out
 * nudge, so a redo has nothing to ask it for the three fields that feed those.
 */
export function isPersonFieldApplicable(person: Person, fieldId: PersonBackfillFieldId): boolean {
  switch (fieldId) {
    case 'birthday':
    case 'cadence':
    case 'askAbout':
      return person.kind !== 'business';
    case 'location':
      return true;
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
 * `fromScratch` is the screen's redo, the same as the task fields have. It
 * widens the queue to everybody the field applies to (`isPersonFieldApplicable`),
 * including people who already have a value or were told never to be asked
 * again, and it keeps the order above. It was left out at first, on the
 * reasoning that being walked past every person you know is the "sort your
 * friends into tiers" afternoon the arch doc refuses; it was added on request,
 * so the guards are the ones the rest of this module already holds: it only
 * ever opens by choice (a header button behind a confirm), nobody's value is
 * touched until their own card is answered, and still nothing here reads
 * history or ranks anybody.
 */
export function personBackfillCandidates(
  people: Person[],
  fieldId: PersonBackfillFieldId,
  opts: { fromScratch?: boolean } = {}
): Person[] {
  return people
    .filter(p =>
      !p.archived &&
      (opts.fromScratch
        ? isPersonFieldApplicable(p, fieldId)
        : isPersonFieldMissing(p, fieldId) && !isPersonBackfillDismissed(p, fieldId))
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
  const counts = { birthday: 0, cadence: 0, askAbout: 0, location: 0 } as Record<PersonBackfillFieldId, number>;
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

/**
 * The other current, non-archived members of `person`'s group — see
 * `docs/arch/people.md`'s "Groups" section. Empty when `person` isn't in one;
 * ungrouped is not treated as a group of one.
 *
 * Scans `people` rather than going through `groupMembers()` in
 * `peopleRegistry.ts` on purpose: that helper exists so a row renderer can
 * resolve a group without pulling `usePersonStore` (and therefore
 * expo-sqlite) into a leaf module, which isn't a constraint here — this
 * module already takes the live `people` array as a parameter, the same way
 * `personBackfillCandidates` does.
 */
export function groupmatesOf(person: Person, people: Person[]): Person[] {
  if (!person.groupId) return [];
  return people
    .filter(p => p.id !== person.id && p.groupId === person.groupId && !p.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The cadence a groupmate already has on file, or null — rule 5's offer,
 * pointed at somebody you're grouped with instead of at your own shared
 * history. The reach-out nudge already reads a group's *shared history* to
 * suggest a cadence for either member (`observedCadenceDays` off
 * `namedIdsFor`, in `PersonEditor` and on this same screen); this is the
 * other honest source Backfill can offer before that history exists: a
 * cadence your groupmate already declared, since a couple who share a
 * reminder in practice usually want the same number.
 *
 * Returns the first opted-in groupmate found — groups are small (a couple, a
 * household), so there's no ranking question here the way there would be at
 * task or project scale.
 */
export function groupmateCadenceOffer(person: Person, people: Person[]): { mate: Person; days: number } | null {
  for (const mate of groupmatesOf(person, people)) {
    if (mate.nudgeOptIn && mate.cadenceDays > 0) return { mate, days: mate.cadenceDays };
  }
  return null;
}
