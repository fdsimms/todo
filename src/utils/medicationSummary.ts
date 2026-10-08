import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { addDays } from 'date-fns/addDays';
import type { MedicationLog, Milestone, Task } from '../types';
import { formatDose, medicationFor, medicationKey } from './medicationLog';
import {
  describeLimit,
  limitBreaches,
  prefsFor,
  type MedicationSettingsMap,
} from './medicationSettings';

/**
 * The summary for a visit: what you took over a stretch, laid out for a
 * clinician to read in a minute.
 *
 * `medicationExport.ts` hands over every dose and derives nothing, because a
 * bare "usually 400 mg" in a spreadsheet cell reads as a prescription. This is
 * the other half of that rule rather than an exception to it: **a figure may
 * be derived here as long as it states what it counts.** So there is no
 * "usual dose" (the amounts are a breakdown, "400 mg ×24, 200 mg ×7", or a
 * timeline where they changed), no adherence percentage (a "days it was due"
 * denominator is a guess for anything not taken daily; "recorded 84 times,
 * marked missed 4 times" is two counts nobody has to trust), and a limit is
 * always "Limit you set", judged only from the day it was set.
 *
 * What it never does is put a medicine against a symptom or a mood. That is
 * the refusal `medicationLog.ts` explains at length, and a document a
 * clinician reads is the last place to relax it.
 *
 * Pure: the screen gathers the logs, settings, milestones and missed counts,
 * and this lays them out. `summaryText` and `summaryHtml` are two renderings
 * of the one structure, so the PDF and the copied text can't disagree.
 */

export type SummaryPreset = '30' | '90' | 'sinceLast' | 'custom';

/** The day keys a summary covers, both inclusive. */
export interface SummaryRange {
  startKey: string;
  endKey: string;
}

function keyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function keyOf(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** "Jul 10" in the year being summarised, "Jul 10, 2025" otherwise. */
function shortDay(key: string, yearOf?: string): string {
  const date = keyToDate(key);
  const sameYear = yearOf && key.slice(0, 4) === yearOf.slice(0, 4);
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy');
}

/**
 * The range a preset covers, ending today.
 *
 * "Since my last summary" starts the day after the last one was shared, so two
 * summaries in a row never count the same dose twice; with no earlier summary
 * it falls back to 90 days, the default. A custom range is used as given,
 * swapped if it arrived backwards.
 */
export function summaryRange(
  preset: SummaryPreset,
  todayKey: string,
  opts: { lastSummaryDayKey?: string | null; custom?: SummaryRange | null } = {},
): SummaryRange {
  const today = keyToDate(todayKey);
  if (preset === 'custom' && opts.custom) {
    const { startKey, endKey } = opts.custom;
    return startKey <= endKey ? { startKey, endKey } : { startKey: endKey, endKey: startKey };
  }
  if (preset === 'sinceLast' && opts.lastSummaryDayKey && opts.lastSummaryDayKey < todayKey) {
    return { startKey: keyOf(addDays(keyToDate(opts.lastSummaryDayKey), 1)), endKey: todayKey };
  }
  const days = preset === '30' ? 30 : 90;
  return { startKey: keyOf(subDays(today, days - 1)), endKey: todayKey };
}

/** Days in a range, inclusive. */
export function rangeDays(range: SummaryRange): number {
  return differenceInCalendarDays(keyToDate(range.endKey), keyToDate(range.startKey)) + 1;
}

/** "Jul 10 to Oct 8, 2026 (90 days)". */
export function describeRange(range: SummaryRange): string {
  const days = rangeDays(range);
  const end = format(keyToDate(range.endKey), 'MMM d, yyyy');
  const span = days === 1
    ? end
    : `${shortDay(range.startKey, range.endKey)} to ${end}`;
  return `${span} (${days} ${days === 1 ? 'day' : 'days'})`;
}

function inRange(log: MedicationLog, range: SummaryRange): boolean {
  return log.dayKey >= range.startKey && log.dayKey <= range.endKey;
}

/** A medication the options sheet can offer, with its count in the range. */
export interface SummaryCandidate {
  key: string;
  name: string;
  doses: number;
  archived: boolean;
}

/**
 * Every medication with a dose in the range, most doses first.
 *
 * An archived one is listed only because it has doses in the range (that is
 * what makes it part of the stretch being summarised), and the sheet starts it
 * unticked: archiving said you stopped, and a summary is usually about now.
 */
export function summaryCandidates(
  logs: readonly MedicationLog[],
  archived: readonly string[],
  range: SummaryRange,
): SummaryCandidate[] {
  const byKey = new Map<string, SummaryCandidate & { last: string }>();
  for (const log of logs) {
    if (!inRange(log, range)) continue;
    const key = medicationKey(log.name);
    if (!key) continue;
    const seen = byKey.get(key);
    if (seen) {
      seen.doses++;
      if (log.takenAt > seen.last) { seen.last = log.takenAt; seen.name = log.name.trim(); }
    } else {
      byKey.set(key, { key, name: log.name.trim(), doses: 1, archived: archived.includes(key), last: log.takenAt });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.doses - a.doses || a.name.localeCompare(b.name))
    .map(({ last: _last, ...c }) => c);
}

/**
 * How many times each medication's scheduled task was marked missed in the
 * range, keyed by `medicationKey`. A missed occurrence records no dose (see
 * `completeTask`), so without this a summary would show a gap with no way to
 * tell "missed" from "not written down".
 */
export function missedCountsByMedication(
  tasks: readonly Task[],
  range: SummaryRange,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const task of tasks) {
    if (!task.missedAt) continue;
    const key = keyOf(new Date(task.missedAt));
    if (key < range.startKey || key > range.endKey) continue;
    const dose = medicationFor(task);
    if (!dose) continue;
    const med = medicationKey(dose.name);
    out[med] = (out[med] ?? 0) + 1;
  }
  return out;
}

export interface DoseAmount { dose: string; count: number }
export interface DoseRun { dose: string; fromKey: string; toKey: string }
export interface DoseBucket { startKey: string; count: number }
export interface TimeOfDayCount { label: string; count: number }

export interface SummarySection {
  key: string;
  name: string;
  asNeeded: boolean;
  doses: number;
  days: number;
  firstKey: string;
  lastKey: string;
  /** How much, as a breakdown. Null when shown as a timeline instead. */
  amounts: DoseAmount[] | null;
  /** How much, as runs, for a scheduled dose that changed a few times. */
  timeline: DoseRun[] | null;
  missed: number;
  /** As-needed only: the busiest day. */
  maxInOneDay: { count: number; dayKey: string } | null;
  /** As-needed only: doses per week or per two weeks across the range. */
  buckets: DoseBucket[] | null;
  bucketDays: number;
  limit: string | null;
  /** The day the limit was set, when that is inside the range. */
  limitSetKey: string | null;
  /** Days a dose went past the limit, oldest first. */
  breachDays: string[];
  timeOfDay: TimeOfDayCount[] | null;
}

export interface SummaryNote { dayKey: string; name: string; note: string }

export interface MedicationSummary {
  personName: string | null;
  range: SummaryRange;
  preparedAt: Date;
  sections: SummarySection[];
  notes: SummaryNote[] | null;
  milestones: { dayKey: string; label: string }[] | null;
}

export interface SummaryOptions {
  range: SummaryRange;
  /** `medicationKey`s to include, in the order to show them. */
  keys: readonly string[];
  settings: MedicationSettingsMap;
  missed: Record<string, number>;
  includeNotes: boolean;
  includeTimeOfDay: boolean;
  /** Passed only when milestones are to be included. */
  milestones?: readonly Milestone[] | null;
  personName?: string | null;
  preparedAt: Date;
}

/** Where a timeline stops being readable and a breakdown says it better. */
const MAX_TIMELINE_RUNS = 4;

const NOT_STATED = 'amount not stated';

function amountsOf(entries: readonly MedicationLog[]): DoseAmount[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const d = formatDose(e) ?? NOT_STATED;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([dose, count]) => ({ dose, count }))
    .sort((a, b) => b.count - a.count || a.dose.localeCompare(b.dose));
}

function runsOf(entries: readonly MedicationLog[]): DoseRun[] {
  const runs: DoseRun[] = [];
  for (const e of entries) {
    const d = formatDose(e) ?? NOT_STATED;
    const last = runs[runs.length - 1];
    if (last && last.dose === d) last.toKey = e.dayKey;
    else runs.push({ dose: d, fromKey: e.dayKey, toKey: e.dayKey });
  }
  return runs;
}

function bucketsOf(entries: readonly MedicationLog[], range: SummaryRange, size: number): DoseBucket[] {
  const start = keyToDate(range.startKey);
  const total = rangeDays(range);
  const buckets: DoseBucket[] = [];
  for (let offset = 0; offset < total; offset += size) {
    buckets.push({ startKey: keyOf(addDays(start, offset)), count: 0 });
  }
  for (const e of entries) {
    const index = Math.floor(differenceInCalendarDays(keyToDate(e.dayKey), start) / size);
    if (buckets[index]) buckets[index].count++;
  }
  return buckets;
}

const TIME_SLOTS: { label: string; from: number; to: number }[] = [
  { label: 'Morning', from: 5, to: 12 },
  { label: 'Afternoon', from: 12, to: 17 },
  { label: 'Evening', from: 17, to: 21 },
  { label: 'Night', from: 21, to: 29 },
];

/** Doses by time of day, empty slots dropped. */
export function timeOfDayOf(entries: readonly MedicationLog[]): TimeOfDayCount[] {
  const counts = TIME_SLOTS.map(s => ({ label: s.label, count: 0 }));
  for (const e of entries) {
    const hour = new Date(e.takenAt).getHours();
    const h = hour < 5 ? hour + 24 : hour;
    const slot = TIME_SLOTS.findIndex(s => h >= s.from && h < s.to);
    if (slot >= 0) counts[slot].count++;
  }
  return counts.filter(c => c.count > 0);
}

/** Lay out the summary. Everything it shows is counted from `logs` in the range. */
export function buildMedicationSummary(
  logs: readonly MedicationLog[],
  opts: SummaryOptions,
): MedicationSummary {
  const { range } = opts;
  const bucketDays = rangeDays(range) <= 60 ? 7 : 14;
  const wanted = new Set(opts.keys);
  const ranged = logs
    .filter(l => inRange(l, range) && wanted.has(medicationKey(l.name)))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));

  const sections: SummarySection[] = [];
  for (const key of opts.keys) {
    const entries = ranged.filter(l => medicationKey(l.name) === key);
    if (entries.length === 0) continue;
    const name = entries[entries.length - 1].name.trim();
    const asNeeded = entries.some(e => e.asNeeded);

    const runs = runsOf(entries);
    const useTimeline = !asNeeded && runs.length > 1 && runs.length <= MAX_TIMELINE_RUNS;

    let maxInOneDay: SummarySection['maxInOneDay'] = null;
    if (asNeeded) {
      const perDay = new Map<string, number>();
      for (const e of entries) perDay.set(e.dayKey, (perDay.get(e.dayKey) ?? 0) + 1);
      for (const [dayKey, count] of [...perDay.entries()].sort()) {
        if (!maxInOneDay || count > maxInOneDay.count) maxInOneDay = { count, dayKey };
      }
    }

    const limit = prefsFor(opts.settings, name).limit;
    const limitSetKey = limit ? keyOf(new Date(limit.since)) : null;
    // The breaches are judged against the whole log so a dose just inside the
    // range is measured against the one just before it, then trimmed.
    const breachDays = [...new Set(
      limitBreaches(logs, name, limit)
        .map(b => b.log.dayKey)
        .filter(k => k >= range.startKey && k <= range.endKey),
    )];

    sections.push({
      key,
      name,
      asNeeded,
      doses: entries.length,
      days: new Set(entries.map(e => e.dayKey)).size,
      firstKey: entries[0].dayKey,
      lastKey: entries[entries.length - 1].dayKey,
      amounts: useTimeline ? null : amountsOf(entries),
      timeline: useTimeline ? runs : null,
      missed: opts.missed[key] ?? 0,
      maxInOneDay,
      buckets: asNeeded ? bucketsOf(entries, range, bucketDays) : null,
      bucketDays,
      limit: describeLimit(limit),
      limitSetKey: limitSetKey && limitSetKey > range.startKey ? limitSetKey : null,
      breachDays,
      timeOfDay: asNeeded && opts.includeTimeOfDay ? timeOfDayOf(entries) : null,
    });
  }

  const notes = opts.includeNotes
    ? ranged.filter(l => l.note?.trim()).map(l => ({ dayKey: l.dayKey, name: l.name.trim(), note: l.note!.trim() }))
    : null;

  const milestones = opts.milestones
    ? opts.milestones
      .map(m => ({ dayKey: keyOf(new Date(m.date)), label: m.label.trim() }))
      .filter(m => m.label && m.dayKey >= range.startKey && m.dayKey <= range.endKey)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
    : null;

  return {
    personName: opts.personName?.trim() || null,
    range,
    preparedAt: opts.preparedAt,
    sections,
    notes,
    milestones,
  };
}

// ==== Wording, shared by both renderings ====

export const SUMMARY_CAVEAT =
  'A day with nothing recorded may be a day it wasn\'t taken or a day it wasn\'t written down.';
export const SUMMARY_FOOTER = 'Recorded by the patient in dundundun. Not a prescription.';

export interface SummaryLine { label: string; value: string }

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The label/value rows one section reads as. */
export function sectionLines(section: SummarySection, range: SummaryRange): SummaryLine[] {
  const day = (k: string) => shortDay(k, range.endKey);
  const lines: SummaryLine[] = [];

  let recorded = section.asNeeded
    ? `${plural(section.doses, 'dose', 'doses')} on ${plural(section.days, 'day', 'days')}`
    : plural(section.doses, 'time', 'times');
  if (section.missed > 0) recorded += `, marked missed ${plural(section.missed, 'time', 'times')}`;
  lines.push({ label: 'Recorded', value: recorded });

  if (section.timeline) {
    lines.push({
      label: 'Amounts',
      value: section.timeline
        .map(r => `${r.dose} (${r.fromKey === r.toKey ? day(r.fromKey) : `${day(r.fromKey)} to ${day(r.toKey)}`})`)
        .join(', then '),
    });
  } else if (section.amounts) {
    const allUnstated = section.amounts.length === 1 && section.amounts[0].dose === NOT_STATED;
    lines.push({
      label: 'Amounts',
      value: allUnstated
        ? 'Not stated'
        : section.amounts.length === 1
          ? section.amounts[0].dose
          : section.amounts.map(a => `${a.dose} ×${a.count}`).join(', '),
    });
  }

  if (section.maxInOneDay && section.maxInOneDay.count > 1) {
    lines.push({ label: 'Most in one day', value: `${section.maxInOneDay.count} (${day(section.maxInOneDay.dayKey)})` });
  }

  if (section.limit) {
    const set = section.limitSetKey ? ` (set ${day(section.limitSetKey)})` : '';
    lines.push({ label: 'Limit you set', value: `${section.limit}${set}` });
    // A limit set after the range ended judged none of it, and "Never" would
    // say it had.
    if (!section.limitSetKey || section.limitSetKey <= range.endKey) lines.push({
      label: 'Sooner than that',
      value: section.breachDays.length === 0
        ? 'Never'
        : `${plural(section.breachDays.length, 'day', 'days')} (${section.breachDays.map(day).join(', ')})`,
    });
  }

  if (section.timeOfDay && section.timeOfDay.length > 0) {
    lines.push({
      label: 'Time of day',
      value: section.timeOfDay.map(t => `${t.label.toLowerCase()} ${t.count}`).join(', '),
    });
  }

  lines.push({
    label: 'First and last',
    value: section.firstKey === section.lastKey
      ? day(section.firstKey)
      : `${day(section.firstKey)} and ${day(section.lastKey)}`,
  });
  return lines;
}

function bucketHeading(section: SummarySection): string {
  return section.bucketDays === 7 ? 'Doses per week' : 'Doses per two weeks';
}

/** The summary as plain text, for pasting into a patient portal message. */
export function summaryText(summary: MedicationSummary): string {
  const { range } = summary;
  const out: string[] = ['Medication summary'];
  if (summary.personName) out.push(summary.personName);
  out.push(describeRange(range));
  out.push(`Prepared ${format(summary.preparedAt, 'MMM d, yyyy')}. ${SUMMARY_CAVEAT}`);

  for (const section of summary.sections) {
    out.push('');
    out.push(`${section.name.toUpperCase()} (${section.asNeeded ? 'as needed' : 'on a schedule'})`);
    for (const line of sectionLines(section, range)) out.push(`${line.label}: ${line.value}`);
    if (section.buckets && section.buckets.length > 1) {
      out.push(`${bucketHeading(section)}: ${section.buckets.map(b => b.count).join(', ')}`);
    }
  }

  if (summary.milestones && summary.milestones.length > 0) {
    out.push('', 'MILESTONES');
    for (const m of summary.milestones) out.push(`${shortDay(m.dayKey, range.endKey)}: ${m.label}`);
  }
  if (summary.notes && summary.notes.length > 0) {
    out.push('', 'NOTES YOU ADDED');
    for (const n of summary.notes) out.push(`${shortDay(n.dayKey, range.endKey)}, ${n.name}: ${n.note}`);
  }
  out.push('', SUMMARY_FOOTER);
  return out.join('\n') + '\n';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The summary as a printable page, for `expo-print` to turn into a PDF.
 *
 * Always light, whatever the app's theme: it is paper, and a dark page is
 * the wrong thing to hand a printer. The bars are plain divs rather than an
 * SVG so the print engine needs nothing it might render differently.
 */
export function summaryHtml(summary: MedicationSummary): string {
  const { range } = summary;
  const e = escapeHtml;
  const sections = summary.sections.map(section => {
    const lines = sectionLines(section, range)
      .map(l => `<div class="line"><span class="k">${e(l.label)}</span><span>${e(l.value)}</span></div>`)
      .join('');
    let chart = '';
    if (section.buckets && section.buckets.length > 1) {
      const max = Math.max(1, ...section.buckets.map(b => b.count));
      const cells = section.buckets.map(b => {
        const h = Math.round((b.count / max) * 34);
        return `<td class="bar"><div style="height:${h}px"></div></td>`;
      }).join('');
      const counts = section.buckets.map(b => `<td class="n">${b.count}</td>`).join('');
      const labels = section.buckets.map(b => `<td>${e(shortDay(b.startKey, range.endKey))}</td>`).join('');
      chart = `<div class="line"><span class="k">${e(bucketHeading(section))}</span></div>`
        + `<table class="weeks"><tr>${cells}</tr><tr>${counts}</tr><tr>${labels}</tr></table>`;
    }
    return `<div class="med"><div class="medhead"><b>${e(section.name)}</b>`
      + `<span class="tag">${section.asNeeded ? 'As needed' : 'On a schedule'}</span></div>${lines}${chart}</div>`;
  }).join('');

  const milestones = summary.milestones && summary.milestones.length > 0
    ? `<hr><h2>MILESTONES</h2>${summary.milestones.map(m =>
      `<div class="note"><span>${e(shortDay(m.dayKey, range.endKey))} ·</span> ${e(m.label)}</div>`).join('')}`
    : '';
  const notes = summary.notes && summary.notes.length > 0
    ? `<hr><h2>NOTES YOU ADDED</h2>${summary.notes.map(n =>
      `<div class="note"><span>${e(shortDay(n.dayKey, range.endKey))} · ${e(n.name)} ·</span> ${e(n.note)}</div>`).join('')}`
    : '';
  const empty = summary.sections.length === 0
    ? '<p class="line">No doses recorded for the medications chosen in this range.</p>'
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#17131C;background:#fff}
h1{font-size:22px;font-weight:700}
.who{font-size:13px;color:#4F4A57;margin-top:4px}
.range{font-size:14px;font-weight:600;margin-top:10px}
.caveat{font-size:11px;color:#4F4A57;margin-top:6px;line-height:1.45}
hr{border:0;border-top:1px solid #C9C6CF;margin:18px 0}
h2{font-size:10px;font-weight:600;letter-spacing:.8px;color:#4F4A57;margin-bottom:6px}
.med{margin-bottom:18px;page-break-inside:avoid}
.medhead{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.medhead b{font-size:15px}
.tag{font-size:10px;font-weight:600;letter-spacing:.6px;color:#4F4A57;text-transform:uppercase}
.line{font-size:12px;line-height:1.55;display:flex}
.line .k{color:#4F4A57;flex:none;width:140px}
table.weeks{border-collapse:collapse;margin-top:4px;font-size:10px}
table.weeks td{padding:2px 5px;text-align:center;color:#4F4A57}
table.weeks .bar{height:34px;vertical-align:bottom;padding-bottom:0}
table.weeks .bar div{width:16px;margin:0 auto;background:#6A3FDB;border-radius:2px 2px 0 0}
table.weeks .n{color:#17131C;font-weight:600}
.note{font-size:12px;line-height:1.5}
.note span{color:#4F4A57}
.foot{font-size:10px;color:#6B6574;margin-top:22px}
</style></head><body>
<h1>Medication summary</h1>
${summary.personName ? `<div class="who">${e(summary.personName)}</div>` : ''}
<div class="range">${e(describeRange(range))}</div>
<div class="caveat">Prepared ${e(format(summary.preparedAt, 'MMM d, yyyy'))} from doses recorded in dundundun. ${e(SUMMARY_CAVEAT)}</div>
<hr>
${sections}${empty}${milestones}${notes}
<div class="foot">${e(SUMMARY_FOOTER)}</div>
</body></html>`;
}

/** `medication-summary-2026-10-08.pdf`. */
export function summaryFileName(preparedAt: Date): string {
  return `medication-summary-${format(preparedAt, 'yyyy-MM-dd')}.pdf`;
}
