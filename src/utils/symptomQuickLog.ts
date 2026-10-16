import type { SymptomSeverity } from '../types';
import { symptomKey } from './moodLog';

/**
 * The words around a symptom name in the search field: "lightheaded",
 * "I got lightheaded at 3:40pm", "log severe headache 20 min ago".
 *
 * Reading only. The name still has to be a symptom the log already has (the
 * caller matches it), so a sentence that merely starts with "I got" or "I'm"
 * can't create one. What this adds is the two things a one-line entry may say
 * besides the name: how bad it was, and when.
 */

export interface SymptomPhrase {
  /** The words left once the lead, the severity and the time are taken off. */
  words: string;
  /** Stated severity, or null for "not said" (the row then logs Mild). */
  severity: SymptomSeverity | null;
  /** The moment stated, in the past, or null for now. */
  at: Date | null;
  /** The line opened with "log" or "record". */
  verb: boolean;
  /** The line was a sentence ("I got ...", "feeling ..."), not a bare name. */
  sentence: boolean;
}

const VERB_RE = /^(?:log|record)\s+(?:my\s+|a\s+|an\s+)?/i;
const FEELING_RE = /^(?:i\s+am\s+|i['’]?m\s+|i\s+)?feel(?:ing)?\b\s*/i;
const SENTENCE_RE = /^i(?:['’]?ve)?\s+(?:got|get|have|had|felt|was)\s+(?:a\s+|an\s+|some\s+|my\s+)?|^i(?:['’]?m|\s+am)\s+/i;
const SOFTENERS_RE = /^(?:a\s+bit|a\s+little|kind\s+of|kinda|pretty|really|very|so|quite)\s+/i;

const SEVERITY: Record<string, SymptomSeverity> = { mild: 1, moderate: 2, severe: 3 };
const LEADING_SEVERITY_RE = /^(mild|moderate|severe)\s+/i;
const TRAILING_SEVERITY_RE = /[\s,]+(mild|moderate|severe)$/i;

const AT_RE = /(?:^|\s)(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i;
const AGO_RE = /(?:^|\s)(\d+(?:\.\d+)?|an?)\s*(m|mins?|minutes?|h|hrs?|hours?)\s+ago$/i;

/** "at 3:40pm" as the latest such moment that isn't in the future. */
export function resolveClockTime(hour: number, minute: number, meridiem: 'am' | 'pm' | null, now: Date): Date | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  let hours: number[];
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hours = [(hour % 12) + (meridiem === 'pm' ? 12 : 0)];
  } else if (hour === 0 || hour >= 13) {
    hours = [hour];
  } else {
    hours = [hour % 12, (hour % 12) + 12];
  }
  const moments = hours.map(h => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, minute);
    // A time later than now is the one from yesterday: an entry is a record
    // of something that has happened.
    return today.getTime() > now.getTime()
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, h, minute)
      : today;
  });
  return moments.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}

function takeTime(text: string, now: Date): { rest: string; at: Date | null } {
  const ago = AGO_RE.exec(text);
  if (ago) {
    const n = /^an?$/i.test(ago[1]) ? 1 : Number(ago[1]);
    const unit = ago[2].toLowerCase();
    const minutes = unit.startsWith('m') ? n : n * 60;
    if (minutes >= 0 && minutes <= 24 * 60) {
      return { rest: text.slice(0, ago.index).trim(), at: new Date(now.getTime() - minutes * 60_000) };
    }
  }
  const clock = AT_RE.exec(text);
  // A bare trailing number ("vitamin 3") isn't a time: it takes "at", a
  // colon or am/pm to say so.
  if (clock && (clock[1] || clock[3] || clock[4])) {
    const meridiem = clock[4] ? (clock[4][0].toLowerCase() === 'p' ? 'pm' : 'am') : null;
    const at = resolveClockTime(Number(clock[2]), clock[3] ? Number(clock[3]) : 0, meridiem, now);
    if (at) return { rest: text.slice(0, clock.index).trim(), at };
  }
  return { rest: text, at: null };
}

/** Split a search line into a symptom's words and the severity and time it states. */
export function parseSymptomPhrase(query: string, now: Date = new Date()): SymptomPhrase {
  let text = query.trim();
  let verb = false;
  let sentence = false;
  let lead: RegExpExecArray | null;
  if ((lead = VERB_RE.exec(text))) {
    verb = true;
    text = text.slice(lead[0].length);
  } else if ((lead = FEELING_RE.exec(text))) {
    sentence = true;
    text = text.slice(lead[0].length);
  } else if ((lead = SENTENCE_RE.exec(text))) {
    sentence = true;
    text = text.slice(lead[0].length);
  }
  if (sentence) text = text.replace(SOFTENERS_RE, '');

  const { rest, at } = takeTime(text, now);
  text = rest;

  let severity: SymptomSeverity | null = null;
  const leading = LEADING_SEVERITY_RE.exec(text);
  if (leading) {
    severity = SEVERITY[leading[1].toLowerCase()];
    text = text.slice(leading[0].length);
  } else {
    const trailing = TRAILING_SEVERITY_RE.exec(text);
    if (trailing) {
      severity = SEVERITY[trailing[1].toLowerCase()];
      text = text.slice(0, trailing.index);
    }
  }
  return { words: text.trim(), severity, at, verb, sentence };
}

/**
 * Known symptoms a typed name points at, best first: the whole name, then the
 * start of a name, then the start of one of its words. Same tiers as the dose
 * rows, so typing "light" finds Lightheaded.
 */
export function matchSymptoms(words: string, symptoms: readonly string[]): { name: string; exact: boolean }[] {
  const key = symptomKey(words);
  if (!key) return [];
  const tiers: string[][] = [[], [], []];
  for (const name of symptoms) {
    const nameKey = symptomKey(name);
    if (nameKey === key) tiers[0].push(name);
    else if (nameKey.startsWith(key)) tiers[1].push(name);
    else if (nameKey.split(/\s+/).some(word => word.startsWith(key))) tiers[2].push(name);
  }
  return tiers.flatMap((names, i) => names.map(name => ({ name, exact: i === 0 })));
}
