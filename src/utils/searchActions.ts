import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import type { MedicationLog } from '../types';
import {
  formatDose,
  medicationKey,
  medicationVocabulary,
  repeatDose,
  type MedicationDose,
} from './medicationLog';
import { limitStatus, prefsFor, type MedicationSettingsMap } from './medicationSettings';
import { readDoseWords } from './quickDose';

/**
 * Things the quick-search card can *do*, not just find: "take aleve" offers to
 * record a dose of Aleve from the medications you already log.
 *
 * An action is only ever an offer. Nothing here records anything; the card
 * shows a row and a tap on it goes through `recordDose`, the same path the
 * Medications screen and quick add use, so the limit is asked about and a low
 * supply offers a refill whichever door the dose came in by.
 *
 * Present tense is fine here where quick add refuses it (`quickDose.ts`): in
 * quick add "take ibuprofen" is a task to write, and recording a dose instead
 * would be the app guessing. In search nothing is written until the row is
 * tapped, so the verb only has to say which medication is meant.
 *
 * Only medications that have been logged before are offered (the same
 * vocabulary quick add's pills and the log sheet use, archived ones left
 * out). A search is a lookup, and a name typed into it that the log has never
 * seen is far more likely to be a task title than a new medicine.
 */

/** The most action rows the card shows. They lead the card and spend its budget. */
export const QUICK_ACTION_LIMIT = 3;

/**
 * A query with no verb has to be at least this long before a name match is
 * offered, so "ad" doesn't put a dose row over every search that starts with
 * those letters. With a verb the person has already said what they mean.
 */
const BARE_NAME_MIN_LENGTH = 3;

const VERB_RE = /^\s*(?:take|took|taking|log|record)\b\s*/i;

export interface DoseAction {
  kind: 'dose';
  /** Stable across keystrokes for one medication, for keying the row. */
  key: string;
  /** What a tap records. */
  dose: MedicationDose & { asNeeded: true };
}

export type SearchAction = DoseAction;

export interface SearchActionsOutcome {
  actions: SearchAction[];
  /**
   * The query opened with a verb ("take aleve"), so Return may run a lone
   * action rather than handing the query to the Search tab.
   */
  explicit: boolean;
}

const NONE: SearchActionsOutcome = { actions: [], explicit: false };

/**
 * The dose actions a query offers, best match first.
 *
 * The name typed is matched against the start of a medication's name, or the
 * start of one of its words ("take d" finds Vitamin D), so the row is there
 * by the time the first few letters are. An exact name comes first, then a
 * match on the whole name's start, then on a later word; within each, the
 * vocabulary's own most-used-first order.
 *
 * A stated amount ("take aleve 440mg") is what gets recorded. Without one,
 * the last dose recorded for that medication is repeated, which is what the
 * Medications screen's quick button does too.
 */
export function searchActions(
  query: string,
  logs: readonly MedicationLog[],
  archived: readonly string[] = [],
  limit: number = QUICK_ACTION_LIMIT,
): SearchActionsOutcome {
  if (limit <= 0) return NONE;
  const explicit = VERB_RE.test(query);
  const { typed, amount, unit } = readDoseWords(query.replace(VERB_RE, ''));
  const key = medicationKey(typed);
  if (!key) return NONE;
  if (!explicit && key.length < BARE_NAME_MIN_LENGTH) return NONE;

  const tiers: string[][] = [[], [], []];
  for (const name of medicationVocabulary(logs, archived)) {
    const nameKey = medicationKey(name);
    if (nameKey === key) tiers[0].push(name);
    else if (nameKey.startsWith(key)) tiers[1].push(name);
    else if (nameKey.split(/\s+/).some(word => word.startsWith(key))) tiers[2].push(name);
  }

  const actions = tiers.flat().slice(0, limit).map((name): DoseAction => {
    const last = repeatDose(logs, name);
    return {
      kind: 'dose',
      key: `dose:${medicationKey(name)}`,
      dose: amount !== null ? { name: last.name, amount, unit, asNeeded: true } : last,
    };
  });
  return actions.length > 0 ? { actions, explicit } : NONE;
}

export interface DoseActionDescription {
  title: string;
  /** The parts of the line under the title, in order. */
  meta: string[];
  /** The limit you set says the next dose isn't due yet. Recording still asks. */
  tooSoon: boolean;
}

function clockOrDate(at: Date, now: Date): string {
  return isSameDay(at, now) ? format(at, 'h:mm a') : format(at, 'MMM d, h:mm a');
}

/**
 * What a dose row says: the dose a tap records, when it was last taken, and
 * when the limit you set allows the next one if that's not yet. The limit is
 * said up front rather than only in the confirm a tap raises, since it is the
 * thing most worth knowing before reaching for the row.
 */
export function describeDoseAction(
  action: DoseAction,
  logs: readonly MedicationLog[],
  settings: MedicationSettingsMap,
  now: Date,
): DoseActionDescription {
  const { name } = action.dose;
  const status = limitStatus(logs, name, prefsFor(settings, name).limit, now);
  const meta: string[] = [];
  const amount = formatDose(action.dose);
  if (amount) meta.push(amount);
  if (status.nextOkAt) {
    meta.push(`Within your limit at ${clockOrDate(status.nextOkAt, now)}`);
  } else if (status.lastTakenAt) {
    meta.push(`Last taken ${clockOrDate(new Date(status.lastTakenAt), now)}`);
  }
  return { title: `Record a dose of ${name}`, meta, tooSoon: status.nextOkAt !== null };
}
