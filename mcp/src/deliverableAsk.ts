/**
 * Whether a completion coming in over MCP has to be sent back for an answer.
 *
 * ## The rule
 *
 * A task can ask a question when it is completed (`Task.deliverableKind`, and
 * per chain step — see `src/utils/deliverables.ts`). `completeTask` reads an
 * *omitted* answer as "nobody asked" and completes the row keeping whatever
 * was already there. That is right for the paths with nobody present — the
 * missed sweep, the quota rollover, a widget tap — and it is the wrong default
 * here, because a model in a conversation is the one caller that could have
 * asked and simply did not. Issue #2367 flagged this as the question to settle
 * before writes were built rather than discover afterwards.
 *
 * So: **an omitted answer on a task that asks one is refused**, with the kind
 * of answer named so the caller knows what to come back with.
 *
 * ## What this does not do
 *
 * It does not make an answer mandatory, and that distinction is the whole
 * design rather than a detail. The feature's own rule is that nothing may ever
 * *require* an answer — the app offers "Complete Without Answering" on every
 * path that asks, and `normalizeDeliverableValue` treats an empty input as a
 * cleared value rather than as a failure. An explicit `null` is exactly that
 * choice, and it is accepted here unchanged.
 *
 * The three states are therefore distinct and all reachable:
 *
 * | `deliverableValue` | Meaning | Result |
 * |---|---|---|
 * | omitted | nobody asked | refused, so the model asks |
 * | `null` | asked and declined | completes, clearing the answer |
 * | a string | answered | completes, recording it |
 *
 * Which keeps the app's rule intact while changing who it applies to: a person
 * may always decline, and a model has to have offered the choice first.
 *
 * Pure, and separate from `replica.ts`, because it is a decision rather than
 * plumbing and is worth pinning down on its own.
 */
import type { DeliverableKind } from '../../src/types';

/** What to come back with, per kind. Phrased for a caller, not for a form label. */
const WANTED: Record<DeliverableKind, string> = {
  text: 'some text',
  date: 'a date (ISO, e.g. 2026-03-14)',
  number: 'a number',
};

/**
 * The message refusing this completion, or null to let it through.
 *
 * `kind` is what the task asks for right now — `deliverableKindFor`, so a
 * chain reports the active step's own question rather than the task-level one
 * it inherited.
 *
 * `datesNextStep` says the answer will not merely be recorded: it places the
 * following chain step (`ChainItem.deliverableDatesNextStep`). Worth saying in
 * the refusal, because a caller that would happily decline a note it saw no
 * point in is deciding a date for a task it has not been shown.
 */
export function deliverableRefusal(
  kind: DeliverableKind | null,
  answered: boolean,
  datesNextStep: string | null = null,
): string | null {
  if (kind === null || answered) return null;
  const consequence = datesNextStep
    ? ` The answer schedules the next step, "${datesNextStep}", so it is a date for that task rather than a note.`
    : '';
  return (
    `That task asks a question when it is completed, and no answer was given. ` +
    `Ask for ${WANTED[kind]} and pass it as deliverableValue.${consequence} ` +
    `Pass deliverableValue: null to complete it without an answer, which is what the app's own "Complete Without Answering" does.`
  );
}
