import type { Priority } from '../types';
import {
  parsePriorityInput, parseProjectInput, parseChainInput, parseLinkInput, parsePhoneInput, parseEmailInput,
  parseDurationInput, parseSupplyInput, parseTargetInput, parseEstimateInput, parseWeatherWaitInput,
  parseSunWindowInput, parseMeterInput, parseRainSkipInput, parseWaitingOnInput, parseSubtasksInput,
  parseAvoidInput,
} from './parseTaskInput';
import { canSkipForRain, defaultRainSkipMm, formatRain, type RainUnit } from './rainSkip';
import { formatMeterAmount, meterKey } from './meters';
import { formatDuration } from './effort';
import { formatQuotaTarget } from './quotaUnit';
import { formatSupplyLeft } from './supply';
import { KNOWN_LINK_APPS } from '../constants/linkApps';

/**
 * The part of the title-reading chain that comes after the schedule phrase,
 * the "#category/#tag" token and the "@name" suggestion: priority, project,
 * chain, link, phone, email, timer, supply, target, estimate, weather wait,
 * sun window, meter, rain skip, waiting on, subtasks, avoid.
 *
 * Quick add and the task editor both read a title for these and offer one
 * suggestion at a time, in this order, so the two can't disagree about what
 * a line means. Everything a form's state would otherwise decide (is the
 * kind plain, is there a repeat, is the weather switch on) comes in through
 * `TitleSuggestionContext`, because refusing what the form wouldn't honor is
 * half of what each parser's gate is for.
 */
export interface TitleSuggestionContext {
  /** The plain task kind. Timer, chain, target, avoid and the habit-shaped phrases are offered only here. */
  plainKind: boolean;
  /** Whether the Effort/estimate control exists for this kind. */
  estimateOffered: boolean;
  recurrenceType: string;
  recurrenceInterval: number;
  recurrenceDays: readonly number[];
  /** The task already has several dates. */
  hasSeries: boolean;
  /** The task already has chain steps. */
  hasChainSteps: boolean;
  /** Live projects a "+project" token can name; null when a project is already fixed. */
  projects: { id: string; title: string }[] | null;
  /** Tasks "after <task>" can name. */
  waitCandidates: { id: string; title: string }[];
  weatherTasksOn: boolean;
  weatherWait: string | null;
  polarity: 'positive' | 'negative';
  /** The task already has a meter. */
  hasMeter: boolean;
  /** Meter names already read, so "the car" files under "Car". */
  knownMeters: string[];
  /** The task already skips for rain. */
  hasRainSkip: boolean;
  rainUnit: RainUnit;
  /** Start of the day a sun bound resolves on, and where that day's sun is. */
  sunClock: (anchor: string) => string | null;
}

type Hit<T extends (...args: never[]) => unknown> = NonNullable<ReturnType<T>>;

export type TitleSuggestion =
  | { kind: 'priority'; hit: Hit<typeof parsePriorityInput> }
  | { kind: 'project'; hit: Hit<typeof parseProjectInput> }
  | { kind: 'chain'; hit: Hit<typeof parseChainInput> }
  | { kind: 'link'; hit: Hit<typeof parseLinkInput> }
  | { kind: 'phone'; hit: Hit<typeof parsePhoneInput> }
  | { kind: 'email'; hit: Hit<typeof parseEmailInput> }
  | { kind: 'duration'; hit: Hit<typeof parseDurationInput> }
  | { kind: 'supply'; hit: Hit<typeof parseSupplyInput> }
  | { kind: 'target'; hit: Hit<typeof parseTargetInput> }
  | { kind: 'estimate'; hit: Hit<typeof parseEstimateInput> }
  | { kind: 'weather'; hit: Hit<typeof parseWeatherWaitInput> }
  | { kind: 'sun'; hit: Hit<typeof parseSunWindowInput> & { clock: string } }
  | { kind: 'meter'; hit: Hit<typeof parseMeterInput> & { read: boolean } }
  | { kind: 'rain'; hit: Hit<typeof parseRainSkipInput> & { mm: number } }
  | { kind: 'waiting'; hit: Hit<typeof parseWaitingOnInput> }
  | { kind: 'subtasks'; hit: Hit<typeof parseSubtasksInput> }
  | { kind: 'avoid'; hit: Hit<typeof parseAvoidInput> };

/** The first suggestion the title offers, or null. Priority order is the order of the checks. */
export function pickTitleSuggestion(title: string, ctx: TitleSuggestionContext): TitleSuggestion | null {
  if (!title.trim()) return null;

  const priority = parsePriorityInput(title);
  if (priority) return { kind: 'priority', hit: priority };

  const project = ctx.projects ? parseProjectInput(title, ctx.projects) : null;
  if (project) return { kind: 'project', hit: project };

  // A chain is only offered from the plain kind: accepting it commits the form to Chain.
  const chain = ctx.plainKind ? parseChainInput(title) : null;
  if (chain) return { kind: 'chain', hit: chain };

  const link = parseLinkInput(title);
  if (link) return { kind: 'link', hit: link };
  const phone = parsePhoneInput(title);
  if (phone) return { kind: 'phone', hit: phone };
  const email = parseEmailInput(title);
  if (email) return { kind: 'email', hit: email };

  // Accepting a duration switches the form into Timed, so only from the plain kind.
  const duration = ctx.plainKind ? parseDurationInput(title) : null;
  if (duration) return { kind: 'duration', hit: duration };

  // A supply counts down by riding onto a successor, so it needs a repeat to mean anything.
  const supply = ctx.recurrenceType !== 'none' ? parseSupplyInput(title) : null;
  if (supply) return { kind: 'supply', hit: supply };

  const target = targetFor(title, ctx);
  if (target) return { kind: 'target', hit: target };

  const estimate = ctx.estimateOffered ? parseEstimateInput(title) : null;
  if (estimate) return { kind: 'estimate', hit: estimate };

  // Only where the wait would be honored: a plain one-off, with the weather switch on.
  const weather = ctx.weatherTasksOn && ctx.plainKind && ctx.recurrenceType === 'none' && !ctx.hasSeries
    && !ctx.hasChainSteps && ctx.weatherWait === null
    ? parseWeatherWaitInput(title) : null;
  if (weather) return { kind: 'weather', hit: weather };

  const sun = parseSunWindowInput(title);
  if (sun) {
    const clock = ctx.sunClock(sun.anchor);
    if (clock) return { kind: 'sun', hit: { ...sun, clock } };
  }

  const meter = ctx.plainKind && ctx.recurrenceType === 'none' && !ctx.hasSeries && !ctx.hasChainSteps
    && ctx.weatherWait === null && ctx.polarity !== 'negative' && !ctx.hasMeter
    ? parseMeterInput(title) : null;
  if (meter) {
    const known = ctx.knownMeters.find(n => meterKey(n) === meterKey(meter.meterName));
    const name = known?.trim() ?? meter.meterName.charAt(0).toUpperCase() + meter.meterName.slice(1);
    return { kind: 'meter', hit: { ...meter, meterName: name, read: !!known } };
  }

  // Rain needs the weather switch (nothing reads rainfall otherwise) and a repeat to skip a day of.
  const rain = ctx.weatherTasksOn && ctx.plainKind && !ctx.hasRainSkip
    && canSkipForRain({ recurrenceType: ctx.recurrenceType as never, polarity: ctx.polarity })
    ? parseRainSkipInput(title) : null;
  if (rain) return { kind: 'rain', hit: { ...rain, mm: rain.mm ?? defaultRainSkipMm(ctx.rainUnit) } };

  const waiting = parseWaitingOnInput(title, ctx.waitCandidates);
  if (waiting) return { kind: 'waiting', hit: waiting };

  const subtasks = parseSubtasksInput(title);
  if (subtasks) return { kind: 'subtasks', hit: subtasks };

  const avoid = ctx.plainKind && ctx.polarity !== 'negative' ? parseAvoidInput(title) : null;
  if (avoid) return { kind: 'avoid', hit: avoid };

  return null;
}

/**
 * "8 times a day" / "3 times a week". Only from the plain kind, and only while
 * the repeat is unset or matches a period a target can count across: a target
 * resets by repeating, so on "every 2 weeks" no reading of "3 times" survives.
 */
function targetFor(title: string, ctx: TitleSuggestionContext): Hit<typeof parseTargetInput> | null {
  if (!ctx.plainKind) return null;
  const plainWeekly = ctx.recurrenceType === 'weekly' && ctx.recurrenceInterval === 1 && ctx.recurrenceDays.length === 0;
  if (ctx.recurrenceType !== 'none' && ctx.recurrenceType !== 'daily' && !plainWeekly) return null;
  if (ctx.recurrenceType === 'daily' && ctx.recurrenceInterval !== 1) return null;
  const result = parseTargetInput(title);
  if (!result) return null;
  if (result.period === 'week' && ctx.recurrenceType === 'daily') return null;
  return plainWeekly ? { ...result, period: 'week' as const } : result;
}

/** Where the matched text sits in the title, for the highlight. */
export function suggestionMatch(
  title: string,
  s: TitleSuggestion,
): { matchStart: number; matchedText: string; wholeLine?: boolean } {
  switch (s.kind) {
    case 'chain': return { matchStart: s.hit.matchStart, matchedText: s.hit.matchedText, wholeLine: true };
    case 'link': return { matchStart: s.hit.matchStart, matchedText: s.hit.url };
    case 'phone': return { matchStart: s.hit.matchStart, matchedText: s.hit.number };
    case 'email': return { matchStart: s.hit.matchStart, matchedText: s.hit.address };
    default: return { matchStart: s.hit.matchStart, matchedText: title.slice(s.hit.matchStart, s.hit.matchEnd) };
  }
}

export function linkLabel(url: string): string {
  return KNOWN_LINK_APPS.find(app => app.scheme === url)?.name ?? url;
}

const PRIORITY_LABELS_SHORT = ['None', 'Low', 'Med', 'High', 'Urgent'] as const;

/** The pill's icon and wording for one suggestion. */
export function describeTitleSuggestion(
  s: TitleSuggestion,
  rainUnit: RainUnit,
  /** How a clock time reads, which follows the 12/24-hour setting. */
  formatClock: (hhmm: string) => string,
): { icon: string; label: string } {
  switch (s.kind) {
    case 'priority': return { icon: 'alert-circle-outline', label: `Priority · ${PRIORITY_LABELS_SHORT[s.hit.priority as Priority]}` };
    case 'project': return { icon: 'briefcase-outline', label: `Project · ${s.hit.title}` };
    case 'chain': return { icon: 'git-commit-outline', label: `Chain · ${s.hit.steps.length} steps` };
    case 'link': return { icon: 'link-outline', label: linkLabel(s.hit.url) };
    case 'phone': return { icon: 'call-outline', label: `Call ${s.hit.number}` };
    case 'email': return { icon: 'mail-outline', label: `Email ${s.hit.address}` };
    case 'duration': return { icon: 'timer-outline', label: `Timer · ${formatDuration(s.hit.minutes)}` };
    case 'supply': return { icon: 'cube-outline', label: `Supply · ${formatSupplyLeft(s.hit.count, s.hit.unit)}` };
    case 'target': return {
      icon: 'speedometer-outline',
      label: `${s.hit.period === 'week' ? 'Weekly' : 'Daily'} target · ${formatQuotaTarget(s.hit.count, null)}`,
    };
    case 'estimate': return { icon: 'barbell', label: `Estimate · ${formatDuration(s.hit.minutes)}` };
    case 'weather': return { icon: 'partly-sunny-outline', label: `Wait for a ${s.hit.condition} day` };
    case 'sun': return {
      icon: s.hit.anchor === 'sunrise' ? 'sunny-outline' : 'moon-outline',
      label: `${s.hit.bound === 'start' ? 'Hidden until' : 'Expires at'} ${s.hit.anchor} · ${formatClock(s.hit.clock)} that day`,
    };
    case 'meter': return {
      icon: 'speedometer-outline',
      label: `Due every ${formatMeterAmount(s.hit.every, s.hit.unit)} on ${s.hit.meterName}`,
    };
    case 'rain': return { icon: 'rainy-outline', label: `Skip after ${formatRain(s.hit.mm, rainUnit)} of rain` };
    case 'waiting': return { icon: 'hourglass-outline', label: `Waiting on · ${s.hit.title}` };
    case 'subtasks': return { icon: 'list-outline', label: `${s.hit.subtasks.length} subtasks` };
    case 'avoid': return { icon: 'shield-checkmark-outline', label: 'Avoid this habit' };
  }
}
