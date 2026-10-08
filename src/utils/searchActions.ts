import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import type { GroceryItem, GroceryListEntry, MedicationLog, MoodLevel } from '../types';
import {
  formatDose,
  medicationKey,
  medicationVocabulary,
  repeatDose,
  type MedicationDose,
} from './medicationLog';
import { limitStatus, prefsFor, type MedicationSettingsMap } from './medicationSettings';
import { readDoseWords } from './quickDose';
import { MOOD_LEVELS, symptomKey } from './moodLog';
import { describeWater, WATER_STEP_FL_OZ, WATER_STEP_ML, waterToMl, type WaterUnit } from './waterLog';
import { groceryNameKey, parseGroceryInput } from './groceryParse';
import { catalogItemForKey } from './groceryPlural';
import { entryFor } from './groceryLists';

/**
 * Things the search field can *do*, not just find: "take aleve" offers to
 * record a dose, "drank water" a glass of water, "feeling tired" the mood log
 * with Tired checked, "buy milk" milk on the grocery list.
 *
 * An action is only ever an offer. Nothing here writes anything; a row is
 * shown, and a tap on it goes through the same path the feature's own screen
 * uses (`searchActionRun.ts`), so a dose is still checked against its limit
 * and a grocery add still matches the catalog.
 *
 * Present tense is fine here where quick add refuses it (`quickDose.ts`): in
 * quick add "take ibuprofen" is a task to write, and recording a dose instead
 * would be the app guessing. In search nothing is written until the row is
 * tapped, so the verb only has to say which thing is meant.
 *
 * Each kind is offered only while its screen is (the caller passes null for a
 * kind whose screen the side menu has hidden), the rule `useElsewhereSearch`
 * keeps for its results too.
 */

/** The most action rows the card shows. They lead the card and spend its budget. */
export const QUICK_ACTION_LIMIT = 3;

/**
 * A medication name typed with no verb has to be at least this long before a
 * dose is offered, so "ad" doesn't put a dose row over every search that
 * starts with those letters. With a verb the person has already said what
 * they mean.
 */
const BARE_NAME_MIN_LENGTH = 3;

/** The most glasses one row offers to log; past it the number is a typo. */
const MAX_GLASSES = 10;

export interface DoseAction {
  kind: 'dose';
  /** Stable across keystrokes for one thing, for keying the row. */
  key: string;
  /** The query opened with a verb, so Return may run it. */
  explicit: boolean;
  /** What a tap records. */
  dose: MedicationDose & { asNeeded: true };
}

export interface WaterAction {
  kind: 'water';
  key: string;
  explicit: boolean;
  glasses: number;
  /** What a tap adds to today's water, in ml. */
  ml: number;
}

export interface MoodAction {
  kind: 'mood';
  key: string;
  explicit: boolean;
  /** A mood the words named, using the scale's own labels. */
  mood: MoodLevel | null;
  /** A symptom the words named, spelled as the log already spells it. */
  symptom: string | null;
}

export interface GroceryAction {
  kind: 'grocery';
  key: string;
  explicit: boolean;
  /** The text handed to `addByName`, quantity and all. */
  raw: string;
  name: string;
  quantity: string | null;
  listId: string | null;
  listName: string;
  /** Nothing in the catalog matches, so a tap adds a new item. */
  isNew: boolean;
  /** Already on that list ('list') or already checked off in it ('cart'). */
  onList: 'list' | 'cart' | null;
}

export type SearchAction = DoseAction | WaterAction | MoodAction | GroceryAction;

/** What each kind needs to match against, or null while its screen is hidden. */
export interface SearchActionSources {
  medications?: { logs: readonly MedicationLog[]; archived: readonly string[] } | null;
  water?: { unit: WaterUnit } | null;
  mood?: { symptoms: readonly string[] } | null;
  groceries?: {
    items: readonly GroceryItem[];
    listEntries: readonly GroceryListEntry[];
    /** The list an add goes to, named explicitly (null is the home list). */
    listId: string | null;
    listName: string;
  } | null;
}

export interface SearchActionsOutcome {
  actions: SearchAction[];
  /**
   * The action Return runs: the only one offered, when the query asked for it
   * in words ("take aleve", "buy milk") and it can be run. Null otherwise, and
   * Return goes where it always did.
   */
  onSubmit: SearchAction | null;
}

const NONE: SearchActionsOutcome = { actions: [], onSubmit: null };

/** Trailing punctuation a query typed as a sentence ends on. */
function clean(query: string): string {
  return query.trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
}

// ==== doses ====

const DOSE_VERB_RE = /^(?:take|took|taking|log|record)\b\s*/i;

/**
 * Dose actions, best match first. The name typed is matched against the start
 * of a medication's name, or the start of one of its words ("take d" finds
 * Vitamin D). An exact name comes first, then a match on the whole name's
 * start, then on a later word; within each, the vocabulary's own
 * most-used-first order. Only medications already in the log are offered: a
 * name the log has never seen is far more likely to be a task title than a
 * new medicine.
 *
 * A stated amount ("take aleve 440mg") is what gets recorded. Without one,
 * the last dose recorded for that medication is repeated, which is what the
 * Medications screen's quick button does too.
 */
function doseActions(
  query: string,
  logs: readonly MedicationLog[],
  archived: readonly string[],
): DoseAction[] {
  const explicit = DOSE_VERB_RE.test(query);
  const { typed, amount, unit } = readDoseWords(query.replace(DOSE_VERB_RE, ''));
  const key = medicationKey(typed);
  if (!key) return [];
  if (!explicit && key.length < BARE_NAME_MIN_LENGTH) return [];

  const tiers: string[][] = [[], [], []];
  for (const name of medicationVocabulary(logs, archived)) {
    const nameKey = medicationKey(name);
    if (nameKey === key) tiers[0].push(name);
    else if (nameKey.startsWith(key)) tiers[1].push(name);
    else if (nameKey.split(/\s+/).some(word => word.startsWith(key))) tiers[2].push(name);
  }

  return tiers.flat().map((name): DoseAction => {
    const last = repeatDose(logs, name);
    return {
      kind: 'dose',
      key: `dose:${medicationKey(name)}`,
      explicit,
      dose: amount !== null ? { name: last.name, amount, unit, asNeeded: true } : last,
    };
  });
}

// ==== water ====

const WATER_RE = /^(?:(drank|drink|had|log|add)\s+)?(?:(a|an|one|\d+)\s+(?:glass|glasses|cup|cups)\s+(?:of\s+)?)?water$/i;

/** One glass: one step of the food log's own water stepper, in the unit you count in. */
export function glassMl(unit: WaterUnit): number {
  return unit === 'flOz' ? waterToMl(WATER_STEP_FL_OZ, 'flOz') : WATER_STEP_ML;
}

/**
 * "water", "drank water", "2 glasses of water". A glass is one step of the
 * food log's own stepper (250 ml, or 8 fl oz), so the search field and the
 * stepper agree on what a glass is. Only a query that ends on "water", so
 * "water the plants" stays a search.
 */
function waterAction(query: string, unit: WaterUnit): WaterAction | null {
  const match = WATER_RE.exec(query);
  if (!match) return null;
  const [, verb, count] = match;
  const glasses = count === undefined || /^(a|an|one)$/i.test(count) ? 1 : Number(count);
  if (!Number.isInteger(glasses) || glasses < 1 || glasses > MAX_GLASSES) return null;
  return {
    kind: 'water',
    key: 'water',
    explicit: verb !== undefined || count !== undefined,
    glasses,
    ml: glasses * glassMl(unit),
  };
}

// ==== mood ====

const MOOD_LOG_RE = /^(?:(log|record)\s+(?:my\s+|a\s+)?)?mood$/i;
const FEELING_RE = /^(?:i\s+am\s+|i['’]?m\s+|i\s+)?feel(?:ing)?\b\s*(.*)$/i;
const SOFTENERS_RE = /^(?:a\s+bit|a\s+little|kind\s+of|kinda|pretty|really|so|quite)\s+/i;

/** The scale's own labels, plus the one spelling of OK people type more often. */
function moodLevelFor(words: string): MoodLevel | null {
  const key = words.toLowerCase();
  if (key === 'okay') return 3;
  return MOOD_LEVELS.find(l => l.label.toLowerCase() === key)?.value ?? null;
}

/**
 * "mood", "log my mood", "feeling tired", "I'm feeling low". Opens the mood
 * log rather than writing an entry, because an entry is a mood, symptoms and
 * context together and one search line can't say all of that.
 *
 * What the words name is filled in only when it is literally something the
 * log already has: a symptom you've logged before, or one of the scale's own
 * labels ("low", "very good"). Anything else ("feeling like pizza") opens the
 * log empty. Reading "bad" as Low would be the app telling somebody how they
 * feel, which `moodLog.ts` says is the one thing it may not do.
 */
function moodAction(query: string, symptoms: readonly string[]): MoodAction | null {
  const log = MOOD_LOG_RE.exec(query);
  if (log) return { kind: 'mood', key: 'mood', explicit: log[1] !== undefined, mood: null, symptom: null };

  const feeling = FEELING_RE.exec(query);
  if (!feeling) return null;
  const words = feeling[1].replace(SOFTENERS_RE, '').trim();
  const mood = words ? moodLevelFor(words) : null;
  const symptom = words && mood === null
    ? symptoms.find(s => symptomKey(s) === symptomKey(words)) ?? null
    : null;
  return { kind: 'mood', key: 'mood', explicit: true, mood, symptom };
}

// ==== groceries ====

const GROCERY_VERB_RE = /^(buy|add|put)\s+/i;
const LIST_SUFFIX_RE = /\s+(?:to|on)\s+(?:the\s+|my\s+)?(?:grocery\s+list|shopping\s+list|groceries|list)$/i;

/**
 * "buy milk", "add eggs to the list", "add 2 gal milk". Always needs the
 * verb: a bare "milk" already finds the catalog item as a search result.
 *
 * "buy" always offers, since buying is what the list is for. "add" and "put"
 * mean many things ("add a task", "add Sam to the project"), so they offer
 * only when the name is already in your catalog or the line says "to the
 * list".
 *
 * The name is resolved the way `addByName` will resolve it (`parseGroceryInput`
 * then `catalogItemForKey`), so the row names the item a tap will actually
 * add, and says so when it's already on that list rather than offering an add
 * that would do nothing.
 */
function groceryAction(
  query: string,
  sources: NonNullable<SearchActionSources['groceries']>,
): GroceryAction | null {
  const verb = GROCERY_VERB_RE.exec(query);
  if (!verb) return null;
  let rest = query.slice(verb[0].length);
  const toList = LIST_SUFFIX_RE.test(rest);
  rest = rest.replace(LIST_SUFFIX_RE, '').trim();
  const { name, quantity } = parseGroceryInput(rest);
  const key = groceryNameKey(name) || name.trim().toLowerCase();
  if (!key) return null;
  const match = catalogItemForKey(key, sources.items);
  if (!match && !toList && verb[1].toLowerCase() !== 'buy') return null;
  const entry = match ? entryFor(sources.listEntries, match.id, sources.listId) : null;
  return {
    kind: 'grocery',
    key: `grocery:${match?.id ?? key}`,
    explicit: true,
    raw: rest,
    name: match?.name ?? name.trim(),
    quantity,
    listId: sources.listId,
    listName: sources.listName,
    isNew: !match,
    onList: entry ? (entry.checked ? 'cart' : 'list') : null,
  };
}

// ==== all of them ====

/** Whether a row can be run at all: one saying milk is already on the list can't. */
export function isRunnable(action: SearchAction): boolean {
  return action.kind !== 'grocery' || action.onList === null;
}

/** The actions a query offers, at most `limit` of them. */
export function searchActions(
  query: string,
  sources: SearchActionSources,
  limit: number = QUICK_ACTION_LIMIT,
): SearchActionsOutcome {
  const text = clean(query);
  if (limit <= 0 || !text) return NONE;

  const found: SearchAction[] = [];
  if (sources.medications) {
    found.push(...doseActions(text, sources.medications.logs, sources.medications.archived));
  }
  if (sources.water) {
    const water = waterAction(text, sources.water.unit);
    if (water) found.push(water);
  }
  if (sources.mood) {
    const mood = moodAction(text, sources.mood.symptoms);
    if (mood) found.push(mood);
  }
  if (sources.groceries) {
    const grocery = groceryAction(text, sources.groceries);
    if (grocery) found.push(grocery);
  }

  const actions = found.slice(0, limit);
  if (actions.length === 0) return NONE;
  const only = actions.length === 1 ? actions[0] : null;
  return { actions, onSubmit: only && only.explicit && isRunnable(only) ? only : null };
}

// ==== what a row says ====

export interface ActionDescription {
  title: string;
  /** The parts of the line under the title, in order. */
  meta: string[];
  /** The last meta part is a caution (a dose the limit you set says is too soon). */
  warn: boolean;
  /** An Ionicons name. */
  icon: string;
}

/** What describing a row needs to read, beyond the action itself. */
export interface DescribeContext {
  medicationLogs: readonly MedicationLog[];
  medicationSettings: MedicationSettingsMap;
  waterUnit: WaterUnit;
  /** Water already logged today, in ml. */
  waterTodayMl: number;
  now: Date;
}

function clockOrDate(at: Date, now: Date): string {
  return isSameDay(at, now) ? format(at, 'h:mm a') : format(at, 'MMM d, h:mm a');
}

/**
 * A dose row: the dose a tap records, then when the limit you set allows the
 * next one if that's not yet, else when it was last taken. The limit is said up
 * front rather than only in the confirm a tap raises, since it is the thing most
 * worth knowing before reaching for the row.
 */
function describeDose(action: DoseAction, ctx: DescribeContext): ActionDescription {
  const { name } = action.dose;
  const status = limitStatus(ctx.medicationLogs, name, prefsFor(ctx.medicationSettings, name).limit, ctx.now);
  const meta: string[] = [];
  const amount = formatDose(action.dose);
  if (amount) meta.push(amount);
  if (status.nextOkAt) {
    meta.push(`Within your limit at ${clockOrDate(status.nextOkAt, ctx.now)}`);
  } else if (status.lastTakenAt) {
    meta.push(`Last taken ${clockOrDate(new Date(status.lastTakenAt), ctx.now)}`);
  }
  return { title: `Record a dose of ${name}`, meta, warn: status.nextOkAt !== null, icon: 'medkit-outline' };
}

function describeWaterAction(action: WaterAction, ctx: DescribeContext): ActionDescription {
  const meta = [describeWater(action.ml, ctx.waterUnit)];
  if (ctx.waterTodayMl > 0) meta.push(`${describeWater(ctx.waterTodayMl, ctx.waterUnit)} today so far`);
  return {
    title: action.glasses === 1 ? 'Log a glass of water' : `Log ${action.glasses} glasses of water`,
    meta,
    warn: false,
    icon: 'water-outline',
  };
}

function describeMood(action: MoodAction): ActionDescription {
  const label = action.mood !== null ? MOOD_LEVELS.find(l => l.value === action.mood)?.label ?? null : null;
  const meta = action.symptom
    ? [`Opens with ${action.symptom} checked`]
    : label
      ? [`Opens with ${label} picked`]
      : ['Opens the mood log'];
  return { title: 'Log your mood', meta, warn: false, icon: 'happy-outline' };
}

function describeGrocery(action: GroceryAction): ActionDescription {
  const meta: string[] = [];
  if (action.quantity) meta.push(action.quantity);
  if (action.onList === 'cart') {
    return { title: `${action.name} is already in your cart`, meta: [action.listName], warn: false, icon: 'cart-outline' };
  }
  if (action.onList === 'list') {
    return { title: `${action.name} is already on ${action.listName}`, meta, warn: false, icon: 'cart-outline' };
  }
  if (action.isNew) meta.push('New to your catalog');
  return { title: `Add ${action.name} to ${action.listName}`, meta, warn: false, icon: 'cart-outline' };
}

export function describeSearchAction(action: SearchAction, ctx: DescribeContext): ActionDescription {
  switch (action.kind) {
    case 'dose': return describeDose(action, ctx);
    case 'water': return describeWaterAction(action, ctx);
    case 'mood': return describeMood(action);
    case 'grocery': return describeGrocery(action);
  }
}
