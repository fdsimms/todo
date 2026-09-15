import { format } from 'date-fns/format';

/**
 * The tap on Call, Text or Email, held until you come back to say whether it
 * counted.
 *
 * **Nothing here reads a call log or a message, because iOS has no such read
 * to offer.** CallKit's `CXCall` carries `uuid`, `isOutgoing`, `hasConnected`,
 * `hasEnded` and `isOnHold` and no identity whatever, and `CXCallObserver`
 * observes only calls *in progress* while the app is running — so even mid-call
 * an app cannot name the other party, let alone list past ones. Messages has no
 * read API at all; IdentityLookup, the one extension point near it, exists to
 * filter unwanted SMS from senders who are not in your contacts, which is
 * precisely the set of people this feature is never about. The Contacts
 * framework stores no last-contacted date, and Screen Time reports usage per
 * app rather than per person.
 *
 * So the only observable fact available is one the app produces itself: you
 * tapped its own Call, Text or Email button. That is what makes this the right
 * side of the arch doc's "any reading of messages, call logs, or calendar
 * attendees" (`docs/arch/people.md`) rather than an exception to it — nothing
 * is read.
 *
 * And a tap is an intention, not an event. It cannot tell a call that connected
 * from a number that rang out, or a sent mail from a draft abandoned in the
 * compose window, and it sees nothing dialled from the Phone app itself, which
 * is most of them. So it is never written down on its own: the user is asked
 * first, and only the answer becomes history. Same three beats as
 * `probablyHaveReason` and as the calendar offer sitting on that very screen —
 * guess what you cannot verify, carry the reason, and ask.
 *
 * Pure, and takes `now` rather than reading the clock, so the window rule below
 * is exercisable without standing up the settings store.
 */

/**
 * Which button was tapped. All three open a URL the system handles and return
 * nothing, which is the whole reason a tap is the end of what the app can know.
 *
 * The link button is deliberately not one of them. It opens a chat app for some
 * people and a plain profile for others, so there is no one past-tense sentence
 * it could be written up as, and guessing between "messaged" and "looked at
 * their page" is exactly the kind of invention this feature refuses.
 */
export type ReachOutKind = 'call' | 'text' | 'email';

/** A tap waiting to be confirmed. At most one exists at a time. */
export interface PendingReachOut {
  personId: string;
  kind: ReachOutKind;
  /** ISO, the moment the button was tapped. */
  at: string;
}

/**
 * How long a tap stays worth asking about.
 *
 * Long enough to cover the call itself and a detour afterwards, short enough
 * that opening somebody's screen in the evening does not raise a question about
 * the morning. Past it the stamp is dropped unasked rather than kept: the app
 * has no way to tell a three-hour call from a number that never rang, so once
 * the user's own memory of it has gone cold there is nobody left who could
 * answer honestly, and asking anyway is how a record fills up with guesses.
 */
export const REACH_OUT_PROMPT_WINDOW_MS = 6 * 60 * 60 * 1000;

export function serializePendingReachOut(pending: PendingReachOut): string {
  return JSON.stringify(pending);
}

/**
 * Reads the stamp back, tolerating anything at all in the column.
 *
 * Every field is checked rather than trusted, the same way `normalizeTemplateItem`
 * treats older stored JSON: this rides in the `settings` table, which is a plain
 * string key/value store with no schema to lean on, and a malformed row must read
 * as "nothing pending" rather than putting a prompt on screen about a person who
 * may not exist.
 */
export function parsePendingReachOut(raw: string | null | undefined): PendingReachOut | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { personId, kind, at } = parsed as Record<string, unknown>;
  if (typeof personId !== 'string' || personId.length === 0) return null;
  if (kind !== 'call' && kind !== 'text' && kind !== 'email') return null;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  return { personId, kind, at };
}

/**
 * Whether this stamp is still worth asking about at all.
 *
 * Deliberately **not** scoped to a person. The prompt used to live on one
 * person's detail screen and so had to stay silent about anybody else, but a
 * tap on a task row ("Call Mom" on Today) returns you to Today rather than to
 * Mom's page, and a question that waited there for a visit would usually
 * expire unasked. It asks wherever you are now, so the only question left is
 * whether the stamp is fresh — and the alert names the person it is about, so
 * there is nothing for a screen to disambiguate.
 *
 * That is allowed here and is still not allowed for the calendar offer one
 * section up, which may never prompt on Today. The difference is what the two
 * things are: that one volunteers an observation about your life, which is the
 * kind of thing that grades you, and this one confirms an action you took
 * thirty seconds ago and reports nothing you did not already know.
 */
export function isReachOutPromptLive(
  pending: PendingReachOut | null,
  now: Date,
): boolean {
  if (!pending) return false;
  const at = Date.parse(pending.at);
  if (Number.isNaN(at)) return false;
  const elapsed = now.getTime() - at;
  // A stamp that reads as being from the future is a clock that moved (a
  // timezone change, a manual correction), not a tap that hasn't happened yet.
  // Asking is recoverable and swallowing it silently isn't, so it stays live.
  if (elapsed < 0) return true;
  return elapsed <= REACH_OUT_PROMPT_WINDOW_MS;
}

/**
 * Whether this stamp was written by an earlier launch of the app.
 *
 * The guard on asking at mount, and it exists because **a tap does not mean the
 * app ever went away.** iOS puts its own "call this number?" sheet in front of a
 * `tel:` hand-off, and cancelling that leaves the app exactly where it was; on a
 * device with no phone at all the open silently does nothing. Either way the
 * stamp is written and no call happened, so a screen that asked about any live
 * stamp it found would open with a question about a call the user had just
 * cancelled — a guess presented as a near-certainty, which is the one thing
 * `docs/arch/people.md` says a history may never fill up with.
 *
 * So the foreground transition is the ordinary trigger, since coming back is
 * itself evidence of having left. Mount is the fallback, and it is right only
 * for a stamp that outlived the process that made it: that is the long call
 * during which iOS reclaimed the app, which returns the user to the initial
 * screen with no transition to hear. Anything newer is left alone for a real
 * foreground to pick up.
 */
export function isStampFromEarlierLaunch(
  pending: PendingReachOut,
  processStartMs: number,
): boolean {
  const at = Date.parse(pending.at);
  if (Number.isNaN(at)) return false;
  return at < processStartMs;
}

const PAST_TENSE: Record<ReachOutKind, string> = {
  call: 'Called',
  text: 'Texted',
  email: 'Emailed',
};

/**
 * What the history entry is called once the user says yes.
 *
 * A plain past-tense sentence, the shape somebody would have typed into "Add to
 * history" themselves, so a confirmed prompt is indistinguishable afterwards
 * from an entry made by hand. That is `acceptSuggestion`'s rule for a calendar
 * offer applied again: once it has been confirmed it is not a guess any more,
 * and a history hedging every second row with "probably" is one nobody could
 * read back.
 */
export function reachOutHistoryTitle(kind: ReachOutKind, name: string): string {
  return `${PAST_TENSE[kind]} ${name}`;
}

/**
 * The line under the prompt: exactly what would be written, and when.
 *
 * Shown before anything is saved, for the reason the calendar offer renders the
 * event's own title rather than a count — what has to be checked is whether it
 * really happened, and the user is the only one who can check it.
 */
export function reachOutPromptMessage(kind: ReachOutKind, name: string, at: Date): string {
  return `"${reachOutHistoryTitle(kind, name)}", ${format(at, 'h:mm a')}`;
}
