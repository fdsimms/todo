/**
 * The sentence at the top of the task editor that says what the task does,
 * built from the values its rows already show ("Shows up today in the
 * morning. Repeats every week on Sun.").
 *
 * Each value comes back as a part tagged with the editor row it came from, so
 * tapping it can open that row. The values are the rows' own strings, passed
 * in by the editor, so the sentence and the row below it can't word one value
 * two ways. What lives here is the sentence around them: which fields speak,
 * in what order (the order of the cards below), and the words between.
 *
 * It only says what is set. A field with no value adds nothing, and a task
 * with nothing set has no sentence at all, rather than one claiming where an
 * unset task will turn up.
 *
 * The template item editor uses it too, for the task an item will make. Its
 * dates are offsets, so it passes their labels ("3 days before start date")
 * where the task editor passes a day, and it has two things only a template
 * item can say: that the item starts unchecked, and how long it stays hidden.
 */
import type { DeliverableKind, TimeOfDay } from '../types';

export interface SummaryPart {
  text: string;
  /** The editor row this value belongs to. Absent on the words between values. */
  key?: string;
}

export interface TaskSummaryInput {
  /** "If the day is full" is set to wait (Task.slotIn, or its category's). */
  waitsIfFull?: boolean;
  /**
   * The Date row's value (formatScheduledDate). Its past forms, "Yesterday"
   * and "3d ago", change the verb, so the sentence and the row can't disagree
   * about whether the day has gone.
   */
  date?: string;
  /** A template item's "Hide until" offset label. */
  hiddenUntil?: string;
  /** A template item that starts unchecked when the template is applied. */
  optional?: boolean;
  timesOfDay?: TimeOfDay[];
  /** Either bound of the time window, as the row labels it. */
  windowStart?: string;
  windowEnd?: string;
  /** The deadline's label (formatDeadlineLabel). */
  deadline?: string;
  /** The Remind me row's value. */
  reminder?: string;
  /** The Remind me at a place row's value ("Arriving at Home"). */
  placeReminder?: string;
  /** describeRecurrence, for a repeating task. */
  repeat?: string;
  streak?: number;
  /** A priority label, only when one is set. */
  priority?: string;
  pinned?: boolean;
  /** The Effort row's value ("30 min"). */
  effort?: string;
  category?: string;
  project?: string;
  stack?: string;
  tags?: string[];
  /** What "Waiting on" shows (describeBlocks). */
  waitingOn?: string;
  waitingOnPerson?: string;
  /** Names, already joined. */
  people?: string;
  location?: string;
  workout?: string;
  link?: string;
  phone?: string;
  email?: string;
  asks?: DeliverableKind;
  /** The mission to do before it can be checked off, described ("20 pushups"). See Task.mission. */
  mission?: string;
}

const PROPER_FIRST_WORD = new Set([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
]);

/**
 * A value the app wrote, set into the middle of a sentence: "Today" becomes
 * "today" and "Every week" "every week", while a weekday, a month or a number
 * keeps its first letter. Never applied to anything the user named (a
 * category, a tag, a person), whose capitals are theirs.
 */
export function inSentence(value: string): string {
  const first = value.split(/[\s,]/)[0];
  if (!first || PROPER_FIRST_WORD.has(first) || !/^[A-Z][a-z]/.test(first)) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * A value set after "until" or "by", where a template offset's own "On" ("On
 * start date") would make "until on start date".
 */
function afterPreposition(value: string): string {
  return inSentence(value.replace(/^On /, ''));
}

/** "3d ago" and "3d overdue", as the rows abbreviate them, spelled out for a sentence. */
function spelledDays(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

function joinOr(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

const ASKS: Record<DeliverableKind, string> = {
  text: 'an answer',
  date: 'a date',
  dateRange: 'two dates',
  people: 'who',
  number: 'a number',
  yesno: 'yes or no',
  choice: 'a choice',
};

type Clause = SummaryPart[];
const w = (text: string): SummaryPart => ({ text });
const v = (text: string, key: string): SummaryPart => ({ text, key });

function whenSentence(i: TaskSummaryInput): Clause[] {
  const parts: SummaryPart[] = [];
  if (i.date) {
    const ago = /^(\d+)d ago$/.exec(i.date);
    if (ago) parts.push(w('showed up '), v(`${spelledDays(Number(ago[1]))} ago`, 'date'));
    else if (i.date === 'Yesterday') parts.push(w('showed up '), v('yesterday', 'date'));
    else parts.push(w('shows up '), v(inSentence(i.date), 'date'));
    if (i.waitsIfFull) parts.push(w(', or '), v('later if that day is full', 'slotIn'));
  }
  if (i.timesOfDay && i.timesOfDay.length > 0) {
    parts.push(w(parts.length ? ' in the ' : 'shows up in the '), v(joinOr(i.timesOfDay), 'timeOfDay'));
  }
  if (i.windowStart || i.windowEnd) {
    const lead = parts.length ? ' ' : 'shows up ';
    // A bound can follow the sun ("Sunset"), which reads lowercase mid-sentence.
    const start = i.windowStart && inSentence(i.windowStart);
    const end = i.windowEnd && inSentence(i.windowEnd);
    if (start && end) parts.push(w(`${lead}between `), v(`${start} and ${end}`, 'timeWindow'));
    else if (start) parts.push(w(`${lead}from `), v(start, 'timeWindow'));
    else parts.push(w(`${lead}until `), v(end!, 'timeWindow'));
  }
  return parts.length ? [parts] : [];
}

function optionalSentence(i: TaskSummaryInput): Clause[] {
  return i.optional ? [[v('starts unchecked', 'optional'), w(' when the template is applied')]] : [];
}

function hiddenSentence(i: TaskSummaryInput): Clause[] {
  return i.hiddenUntil ? [[w('hidden until '), v(afterPreposition(i.hiddenUntil), 'hideUntil')]] : [];
}

function deadlineSentence(i: TaskSummaryInput): Clause[] {
  if (!i.deadline) return [];
  const overdue = /^(\d+)d overdue$/.exec(i.deadline);
  if (overdue) return [[w('overdue by '), v(spelledDays(Number(overdue[1])), 'deadline')]];
  return [[w('due by '), v(afterPreposition(i.deadline), 'deadline')]];
}

function reminderSentence(i: TaskSummaryInput): Clause[] {
  const clauses: Clause[] = i.reminder ? [[w('reminds you '), v(inSentence(i.reminder), 'remindMe')]] : [];
  if (i.placeReminder) {
    clauses.push([w(i.reminder ? 'and again when ' : 'reminds you when '), v(inSentence(i.placeReminder), 'remindAtPlace')]);
  }
  return clauses;
}

function repeatSentence(i: TaskSummaryInput): Clause[] {
  if (!i.repeat) return [];
  const clauses: Clause[] = [[w('repeats '), v(inSentence(i.repeat), 'repeat')]];
  if (i.streak && i.streak > 0) clauses.push([w('on a streak of '), v(String(i.streak), 'streak')]);
  return clauses;
}

function prioritySentence(i: TaskSummaryInput): Clause[] {
  const clauses: Clause[] = [];
  if (i.priority) clauses.push([v(i.priority, 'priority'), w(' priority')]);
  if (i.pinned) clauses.push([v('pinned to Today', 'pin')]);
  if (i.effort) clauses.push([w('takes about '), v(i.effort, 'effort')]);
  return clauses;
}

function filedSentence(i: TaskSummaryInput): Clause[] {
  const clauses: Clause[] = [];
  if (i.category) clauses.push([w('filed in '), v(i.category, 'category')]);
  if (i.project) clauses.push([w('part of '), v(i.project, 'project')]);
  if (i.stack) clauses.push([w('in the '), v(i.stack, 'stack'), w(' stack')]);
  if (i.tags && i.tags.length > 0) clauses.push([w('tagged '), v(i.tags.join(', '), 'tags')]);
  return clauses;
}

function waitsSentence(i: TaskSummaryInput): Clause[] {
  const parts: SummaryPart[] = [];
  if (i.waitingOn) parts.push(w('waits for '), v(i.waitingOn, 'waitingOn'));
  if (i.waitingOnPerson) parts.push(w(parts.length ? ' and ' : 'waits for '), v(i.waitingOnPerson, 'waitingOnPerson'));
  return parts.length ? [parts] : [];
}

function whoSentence(i: TaskSummaryInput): Clause[] {
  const parts: SummaryPart[] = [];
  if (i.people) parts.push(w('with '), v(i.people, 'people'));
  if (i.location) parts.push(w(parts.length ? ' at ' : 'at '), v(i.location, 'location'));
  return parts.length ? [parts] : [];
}

function opensSentence(i: TaskSummaryInput): Clause[] {
  const clauses: Clause[] = [];
  if (i.workout) clauses.push([w('starts '), v(i.workout, 'workout')]);
  if (i.link) clauses.push([w('opens '), v(i.link, 'link')]);
  if (i.phone) clauses.push([w('calls '), v(i.phone, 'phone')]);
  if (i.email) clauses.push([w('emails '), v(i.email, 'email')]);
  return clauses;
}

function finishSentence(i: TaskSummaryInput): Clause[] {
  const pushups = i.mission ? v(i.mission, 'mission') : null;
  if (pushups && i.asks) {
    return [[w('takes '), pushups, w(' and asks for '), v(ASKS[i.asks], 'deliverable'), w(' when you check it off')]];
  }
  if (pushups) return [[w('takes '), pushups, w(' to check off')]];
  return i.asks ? [[w('asks for '), v(ASKS[i.asks], 'deliverable'), w(' when you check it off')]] : [];
}

/** A sentence from its clauses: commas between, a capital at the front, a period at the end. */
function sentence(clauses: Clause[]): SummaryPart[] {
  const parts: SummaryPart[] = [];
  clauses.forEach((c, n) => {
    if (n > 0) parts.push(w(', '));
    parts.push(...c);
  });
  const first = parts[0];
  parts[0] = { ...first, text: first.text.charAt(0).toUpperCase() + first.text.slice(1) };
  parts.push(w('.'));
  return parts;
}

/**
 * The whole summary as one run of parts, sentences separated by a space. Empty
 * when nothing is set. Neighboring plain parts are merged so a renderer draws
 * one text run between each pair of values.
 */
export function buildTaskSummary(input: TaskSummaryInput): SummaryPart[] {
  const sentences = [
    optionalSentence(input), whenSentence(input), hiddenSentence(input), deadlineSentence(input), reminderSentence(input),
    repeatSentence(input), prioritySentence(input), filedSentence(input),
    waitsSentence(input), whoSentence(input), opensSentence(input), finishSentence(input),
  ].filter(s => s.length > 0).map(sentence);
  const out: SummaryPart[] = [];
  sentences.forEach((s, n) => {
    if (n > 0) s = [w(' '), ...s];
    for (const part of s) {
      const last = out[out.length - 1];
      if (last && !last.key && !part.key) last.text += part.text;
      else out.push({ ...part });
    }
  });
  return out;
}
