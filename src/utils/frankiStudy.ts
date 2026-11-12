/**
 * Time spent studying in Franki, from the last read of its server
 * (`useFrankiStore`): the minutes line on a Franki row, the "Franki: 12 of 20
 * min" goal task and the week on Stats. Pure, so it's tested.
 *
 * The server reports Anki's study days (`study_days` on `/reader/api/status`):
 * the cards answered on each, on every device, the time Anki logged for those
 * answers (capped per answer by each deck's "Maximum answer seconds", 60 by
 * default) and the time spent in Read & Listen. Reading time counts as study
 * time while `frankiCountReading` is on.
 */

/** One of Anki's study days, as the server reports it. */
export interface FrankiStudyDay {
  /** When the study day started (ISO): Anki's "next day starts at" hour, in the server's zone. */
  startsAt: string;
  cards: number;
  answerSeconds: number;
  readingSeconds: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The seconds a day counts as studied: answering, plus reading when that counts. */
export function studySeconds(day: FrankiStudyDay, countReading: boolean): number {
  return day.answerSeconds + (countReading ? day.readingSeconds : 0);
}

/**
 * The study day `now` falls in, or null when the read doesn't cover it (an
 * older server, or Anki's day has turned since the read): an unread day is
 * not a day with nothing studied.
 */
export function studyDayAt(days: readonly FrankiStudyDay[], now: Date): FrankiStudyDay | null {
  const at = now.getTime();
  for (const day of days) {
    const start = Date.parse(day.startsAt);
    if (Number.isFinite(start) && start <= at && at < start + DAY_MS) return day;
  }
  return null;
}

/** Whole minutes studied today, or null when the read doesn't cover today. */
export function minutesStudiedToday(
  days: readonly FrankiStudyDay[],
  now: Date,
  countReading: boolean,
): number | null {
  const day = studyDayAt(days, now);
  return day ? Math.floor(studySeconds(day, countReading) / 60) : null;
}

/** Whole minutes read in Read & Listen today, or null when the read doesn't cover today. */
export function minutesReadToday(days: readonly FrankiStudyDay[], now: Date): number | null {
  const day = studyDayAt(days, now);
  return day ? Math.floor(day.readingSeconds / 60) : null;
}

/** "40 min", "2 h", "2 h 43 min". */
export function formatStudyMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

export interface FrankiWeekBar {
  key: string;
  /** The weekday the study day started on, "Thu". */
  label: string;
  minutes: number;
  today: boolean;
}

export interface FrankiWeek {
  bars: FrankiWeekBar[];
  totalMinutes: number;
  /** The part of the total spent in Read & Listen; 0 when reading doesn't count. */
  readingMinutes: number;
  cards: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The week Stats shows: a bar per study day in the read, oldest first, with
 * the week's totals. Null when the read has no study days (an older server),
 * so the section isn't drawn rather than drawn as a week of zeroes.
 */
export function frankiWeek(days: readonly FrankiStudyDay[], now: Date, countReading: boolean): FrankiWeek | null {
  if (days.length === 0) return null;
  const today = studyDayAt(days, now);
  let totalSeconds = 0;
  let readingSeconds = 0;
  let cards = 0;
  const bars = days.map(day => {
    const seconds = studySeconds(day, countReading);
    totalSeconds += seconds;
    if (countReading) readingSeconds += day.readingSeconds;
    cards += day.cards;
    const start = new Date(day.startsAt);
    return {
      key: day.startsAt,
      label: WEEKDAYS[start.getDay()] ?? '',
      minutes: Math.floor(seconds / 60),
      today: day === today,
    };
  });
  return {
    bars,
    totalMinutes: Math.floor(totalSeconds / 60),
    readingMinutes: Math.floor(readingSeconds / 60),
    cards,
  };
}

/**
 * The line under the week's chart, as its total (drawn bold) and the rest:
 * "2 h 43 min" + " this week, 40 min of it in Read & Listen. 1,240 cards answered."
 */
export function describeFrankiWeek(week: FrankiWeek): { total: string; rest: string } {
  const reading = week.readingMinutes > 0
    ? `, ${formatStudyMinutes(week.readingMinutes)} of it in Read & Listen`
    : '';
  const cards = `${week.cards.toLocaleString('en-US')} ${week.cards === 1 ? 'card' : 'cards'} answered`;
  return { total: formatStudyMinutes(week.totalMinutes), rest: ` this week${reading}. ${cards}.` };
}
