/**
 * How you felt, on the one scale every mood read in the app shares.
 *
 * **Fixed 1..5, deliberately, and this is the decision issue #1223 left open.**
 * The freeform half of that question is answered one field down, on
 * `LoggedSymptom.name` — a symptom is whatever you call it, because "brain
 * fog" is not a thing a fixed list could have guessed. Mood is the opposite:
 * its entire value here is that it is *comparable*, both against your own
 * other days and against what you got done on them. A user-defined scale
 * ("1-10", "terrible..great", three faces) makes every number in
 * `moodInsights.ts` incomparable across the very axis the feature exists to
 * read, and the define-your-own-scale UI is most of the build. So the scale is
 * the app's, the vocabulary is yours.
 *
 * Stored as the number, so these are storage values — the labels in
 * `MOOD_LEVELS` (`src/utils/moodLog.ts`) can be reworded freely, the integers
 * cannot be renumbered.
 */
export type MoodLevel = 1 | 2 | 3 | 4 | 5;

/**
 * How an entry felt against the person's previous one, as they said it: a
 * second answer beside `MoodLog.mood`, never a part of it. See
 * `docs/arch/mood-log.md`, "Since your last entry".
 */
export type MoodChange = 'worse' | 'same' | 'better';

/** How bad a symptom was. Fixed for the reason `MoodLevel` is, at a coarser grain. */
export type SymptomSeverity = 1 | 2 | 3;

/**
 * One symptom on one log entry, by whatever name you gave it.
 *
 * Nested in the entry's JSON rather than being rows of its own, the same call
 * `Task.tags` makes: a symptom has no lifecycle apart from the entry holding
 * it, is never pointed at, and is only ever read as part of the entry. The
 * vocabulary that accumulates from these is derived by reading the entries
 * (`symptomVocabulary`), not stored — so unlike `tag_registry` there is no
 * second copy of it to drift, and a symptom you logged once and never again
 * stops being offered on its own rather than needing a prune.
 */
export interface LoggedSymptom {
  /** Trimmed, stored in the user's own casing; matched case-insensitively. */
  name: string;
  severity: SymptomSeverity;
}

/**
 * How you were doing at one moment — see `src/utils/moodLog.ts` for the rules
 * and `src/utils/moodInsights.ts` for what a pile of these can be read to mean.
 *
 * Its own entity rather than a `Task`, which is what #1223 concluded and is
 * worth not re-deriving: there is nothing here to complete, nothing to
 * schedule, and nothing to defer. It is not a quota either — `targetCount` /
 * `progressCount` count *toward* a target within a day, where this records an
 * arbitrary value with no target to reach. What it is closest to is a Logbook
 * row: a record of something that happened, read in aggregate rather than
 * worked through.
 *
 * **Several a day is the normal case, not an edge one.** Mood moves through a
 * day, and an app that allowed one entry per day would be asking you to
 * average your own morning and evening before typing anything. So the entity
 * is stamped with an instant, and every daily read collapses the day's entries
 * itself (`dayMoodAverage`) rather than the schema pretending there is one.
 */
export interface MoodLog {
  id: string;
  /** The instant it was logged. ISO, like every other date in the app. */
  loggedAt: string;
  /**
   * The logical day it counts toward (`2026-08-17`), stamped at write time
   * from `dayResetTime` rather than derived from `loggedAt` on read.
   *
   * Stored rather than computed because `dayResetTime` is a setting the user
   * can change: derive it on every read and moving your day boundary to 02:00
   * silently rewrites which day last month's late-night entries belong to,
   * shifting every correlation in `moodInsights.ts` under a feature whose only
   * job is to be a truthful record. Stamped once, an entry stays on the day it
   * was actually made — the same reasoning `completedAt` follows.
   */
  dayKey: string;
  /**
   * How you felt, or null for an entry that only logs symptoms.
   *
   * Nullable because "my knee hurts" is a complete thing to record on a day
   * you have no particular opinion about your mood, and forcing a number would
   * make every symptom entry carry an invented one straight into the averages.
   */
  mood: MoodLevel | null;
  /** Empty is the common case and means no symptoms, never "not asked". */
  symptoms: LoggedSymptom[];
  /**
   * Things going on that day that aren't symptoms but plausibly explain the
   * mood anyway — "vacation", "big deadline at work", "travel day". Freeform,
   * on the same `symptomKey`-style match `LoggedSymptom.name` uses, and for
   * the same reason: no fixed list was ever going to guess what belongs here,
   * and the app has no business deciding two spellings are the same tag.
   *
   * Unlike a symptom, a tag carries no severity — it either applies to the day
   * or it doesn't, so it is stored as plain names rather than `{ name,
   * severity }` pairs.
   */
  contextTags: string[];
  /**
   * How this felt against the previous entry, or null when not asked or not
   * answered. Its own field rather than something derived from two moods,
   * because the point is the felt change on a day the 1..5 number barely moves
   * (a run of 3s), and nothing may read it as a mood: the averages and
   * contrasts never touch it.
   */
  change: MoodChange | null;
  /**
   * A short line on why, if you want one. Null rather than empty string.
   *
   * Longer writing, and dreams, are `JournalEntry` rows of their own (see
   * `docs/arch/journal.md`); this is the note that explains this mood.
   */
  note: string | null;
}

/** Which of the two writing logs an entry belongs to. */
export type JournalKind = 'journal' | 'dream';

/**
 * Something written down: a journal entry, or a dream you woke up with. See
 * `docs/arch/journal.md`.
 *
 * Both kinds are one shape (a day, a moment and the words), so they share a
 * table and a store, and the screens split them by `kind`. Several a day is
 * normal, which is why `dayKey` is stamped beside the instant rather than
 * being the key, the same call `MoodLog` makes.
 */
export interface JournalEntry {
  id: string;
  kind: JournalKind;
  /** The instant it was written, or noon of a backdated day. ISO. */
  loggedAt: string;
  /**
   * The logical day it files under, stamped at write time from
   * `dayResetTime` and never derived on read (`MoodLog.dayKey`'s reasoning).
   * A dream files under the day you woke.
   */
  dayKey: string;
  /** What was written. Never empty: the store refuses a blank entry. */
  text: string;
  /**
   * A note to your future self: the logical day it opens, or null for an
   * entry that is open as soon as it's written (every entry before this, and
   * most after). Until that day it is sealed: kept, synced and counted as
   * written, but every reader shows it only as "a note for later", never its
   * words. Read through `openEntries` (utils/journal.ts), the one rule every
   * reader uses. Optional so a row or fixture from before it reads as open.
   */
  openOn?: string | null;
  /**
   * Labels the person put on the entry ("recurring", "work"). Typed by them
   * and never detected from the words, so the app still derives nothing from
   * what was written. Optional so a row from before tags reads as untagged.
   */
  tags?: string[];
  /**
   * The people the entry is about (`Person.id`), picked by the person. The
   * person's page lists these entries and nothing more: a count of pages is
   * not a ranking. Optional so an older row reads as about nobody.
   */
  personIds?: string[];
  /**
   * Photos on the entry: file names in the `journal-photos` folder
   * (`src/utils/journalPhotos.ts`). Device-local like the files themselves,
   * which stay on this device and travel only in a backup, as the journal
   * stays off iCloud. Optional so a row written before photos existed reads
   * as having none.
   */
  photos?: string[];
}

/**
 * One fast: a span with no food, started and ended by hand, read against a
 * goal in hours (`src/utils/fasting.ts`). Health has no type for fasting, so
 * this is the app's own record, and it travels with the health record
 * (`HEALTH_SYNC_TABLES`). At most one is open (`endedAt` null) at a time.
 */
export interface Fast {
  id: string;
  startedAt: string;
  /** Null while the fast is running. */
  endedAt: string | null;
  goalHours: number;
  createdAt: string;
}

/**
 * A dated marker for something that changed — starting or stopping a
 * medicine, a new job, moving house — read by `moodInsights.ts` as a
 * before/after split against the mood log. See `docs/arch/mood-log.md`.
 *
 * Deliberately just a label and a date, the same freeform-vocabulary call
 * `LoggedSymptom` and `MoodLog.contextTags` make: no fixed list of milestone
 * "kinds", and — this is the one worth not re-deriving — no attempt to pair a
 * "Started X" with a later "Stopped X" by matching their text. That is exactly
 * the fuzzy matching `symptomKey` refuses for the same reason: getting it
 * wrong silently folds two different questions ("how were things before I
 * started" and "how were things before I stopped") into one chart. Each
 * milestone is its own single split point; recording both ends of a change is
 * two milestones, read independently.
 *
 * No archive column, unlike `PersonNote`: a milestone that's wrong is edited
 * or deleted, not filed away, and there is no "gone stale" state for a fact
 * about a single day in the past.
 */
export interface Milestone {
  id: string;
  /** What happened, in your own words — "Started sertraline", "New job". */
  label: string;
  /**
   * The day it happened. Noon on the picked day, the same anchor a backdated
   * mood entry uses (see `MoodLog`'s backdating note) — a timezone or DST
   * boundary must not drag it onto the wrong day, since this is the split
   * point every before/after read is built on.
   */
  date: string;
  createdAt: string;
}

/**
 * One dose of something taken — see `src/utils/medicationLog.ts` and
 * `docs/arch/mood-log.md`.
 *
 * **This deliberately does not replace the task-based answer, and most doses
 * should never reach it by hand.** `taskMoodContrasts` already answers "how do
 * the days I take it compare" off an ordinary repeating task, and that stays
 * the answer for anything on a schedule: a tracker asking you to log the
 * tablets again, in its own list, next to the task reminding you to take them,
 * is asking for the same fact twice. Two things that argument doesn't reach,
 * and they are the whole of what this is for:
 *
 * - **An as-needed dose has no task to complete.** You don't schedule "take an
 *   ibuprofen if the headache gets bad", so nothing records it — and how often
 *   you reached for it is itself the number worth having, the one a doctor
 *   asks for. A one-off task can't stand in: `contrastsFor` needs
 *   `MIN_CONTRAST_DAYS` a side, so a task completed once is excluded by
 *   construction.
 * - **A completion carries no amount.** Ticking a task records that you did
 *   it, not that it was 20mg rather than 10mg.
 *
 * So the scheduled case still rides the task, and `Task.medicationName` writes
 * one of these on completion rather than asking twice — the same shape
 * `logHealthMetric`/`logHealthAmount` already use to turn a completion into a
 * quantity recorded elsewhere.
 */
export interface MedicationLog {
  id: string;
  /**
   * What was taken, in your own words and casing — matched case-insensitively
   * via `medicationKey`, which refuses fuzzy matching for a harder version of
   * the reason `symptomKey` does. Folding "Ibuprofen 200" into "Ibuprofen 400"
   * would not merely blur a chart, it would misstate a dose.
   */
  name: string;
  /** ISO instant. */
  takenAt: string;
  /**
   * Stamped at write time from `dayResetTime`, never derived on read — the
   * same rule `MoodLog.dayKey` follows, and for the same reason: moving your
   * day boundary must not silently rewrite which day last month's late-night
   * doses belong to.
   */
  dayKey: string;
  /**
   * How much, as a number, or null when not stated. Null and 0 are different
   * and must stay different: "I took it, I didn't record how much" against a
   * recorded zero, which is not a dose at all.
   */
  amount: number | null;
  /** The unit `amount` is in ('mg', 'ml', 'tablet'). Null exactly when `amount` is. */
  unit: string | null;
  /**
   * Taken as needed rather than on a schedule.
   *
   * Per entry rather than per medication because there is no medication
   * entity — the vocabulary is derived from the entries, exactly as
   * `symptomVocabulary` is. `isAsNeededMedication` reads it back as "any entry
   * said so", which errs toward treating a medication as as-needed; that is
   * the safe direction, because it is what withholds the symptom comparison
   * that would otherwise be drawn backwards (see `medicationLog.ts`).
   */
  asNeeded: boolean;
  /**
   * The task whose completion recorded this, when one did. Provenance only:
   * nothing reads it to decide what a dose means, and a dose whose task was
   * later deleted is still a dose that was taken. It exists so unticking a
   * task ticked by mistake can take its dose back with it.
   */
  taskId: string | null;
  note: string | null;
  /**
   * What one counted unit (a capsule, a tablet) contained when this dose was
   * taken, or absent when it stated nothing. Stamped from the medication's
   * strength at write time and then left alone, so switching to a 250 mcg
   * product later does not re-read last month's capsules as 250 mcg. Only
   * meaningful on a dose whose `unit` is counted; `amount` stays what was taken
   * ("1 capsule") and the total is `doseTotal`'s product of the two.
   */
  strength?: { amount: number; unit: string } | null;
}

/** What a check-in can be answered with. */
export type CheckInAnswer = 'better' | 'same' | 'worse';

/**
 * A follow-up asked some time after a dose or a food ("is your headache any
 * better?"). Its own row rather than columns on either log: a saved meal writes
 * several food entries but is one check-in, and the answer has its own life
 * (due, asked, answered) that must not restamp the dose it follows.
 * `sourceId` is provenance and may dangle; the answer outlives a deleted dose.
 */
export interface CheckIn {
  id: string;
  sourceKind: 'medication' | 'food';
  sourceId: string;
  /** The medication name or food label, kept so the notification needs no lookup. */
  subject: string;
  /** What it was for ("headache"), or null when none was entered. */
  about: string | null;
  /** ISO time the question is asked. */
  dueAt: string;
  /** Logical day of the dose or food, so the answer sits with it. */
  dayKey: string;
  answer: CheckInAnswer | null;
  /** ISO time it was answered, null while waiting. */
  answeredAt: string | null;
}
