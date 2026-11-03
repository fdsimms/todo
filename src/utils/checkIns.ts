import type { CheckIn, CheckInAnswer } from '../types';
import { medicationKey } from './medicationLog';

/**
 * Check-ins: a question asked some time after a dose or a food, answered
 * Better / Same / Worse. Everything here is pure; the row lives in
 * `useCheckInStore` and the notification in `notifications.ts`.
 */

/** Notification action ids, shared by the category and the tap router. */
export const CHECK_IN_ACTIONS: Record<CheckInAnswer, string> = {
  better: 'check-in-better',
  same: 'check-in-same',
  worse: 'check-in-worse',
};

export const CHECK_IN_ANSWERS: readonly CheckInAnswer[] = ['better', 'same', 'worse'];

const ANSWER_LABEL: Record<CheckInAnswer, string> = { better: 'Better', same: 'Same', worse: 'Worse' };

export function answerLabel(answer: CheckInAnswer): string {
  return ANSWER_LABEL[answer];
}

/** The answer a notification button stands for, or null for any other identifier. */
export function answerForAction(actionIdentifier: string): CheckInAnswer | null {
  return CHECK_IN_ANSWERS.find(a => CHECK_IN_ACTIONS[a] === actionIdentifier) ?? null;
}

/** Waits offered as quick picks, in minutes. */
export const CHECK_IN_WAIT_PRESETS: readonly number[] = [30, 60, 90, 120, 180];

/** The wait used for a food, and for a medication with no suggestion. */
export const DEFAULT_FOOD_WAIT_MINUTES = 120;
export const DEFAULT_MEDICATION_WAIT_MINUTES = 60;

/**
 * Typical minutes before a common over-the-counter medicine is expected to
 * have taken effect. Only a starting point for the wait: the person can change
 * it, and the app never states it as medical advice. Matched against the
 * medication key by substring, first hit wins, so brand and generic names
 * both land.
 */
const SUGGESTED_WAIT: ReadonlyArray<readonly [string[], number]> = [
  [['aleve', 'naproxen'], 60],
  [['ibuprofen', 'advil', 'motrin'], 60],
  [['acetaminophen', 'tylenol', 'paracetamol'], 60],
  [['excedrin'], 60],
  [['aspirin', 'bayer'], 60],
  [['benadryl', 'diphenhydramine'], 60],
  [['zyrtec', 'cetirizine'], 60],
  [['claritin', 'loratadine'], 120],
  [['allegra', 'fexofenadine'], 120],
  [['pepcid', 'famotidine'], 60],
  [['tums', 'rolaids', 'calcium carbonate'], 30],
  [['imodium', 'loperamide'], 60],
  [['dramamine', 'dimenhydrinate'], 60],
];

/** Suggested wait in minutes for a medication, or null when none is known. */
export function suggestedWaitMinutes(name: string): number | null {
  const key = medicationKey(name);
  if (!key) return null;
  for (const [needles, minutes] of SUGGESTED_WAIT) {
    if (needles.some(n => key.includes(n))) return minutes;
  }
  return null;
}

export function defaultWaitMinutes(kind: CheckIn['sourceKind'], name: string): number {
  if (kind === 'food') return DEFAULT_FOOD_WAIT_MINUTES;
  return suggestedWaitMinutes(name) ?? DEFAULT_MEDICATION_WAIT_MINUTES;
}

export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} hr` : `${minutes} min`;
}

/** The question the notification and the alert ask. */
export function checkInQuestion(c: Pick<CheckIn, 'subject' | 'about' | 'sourceKind'>): string {
  const about = c.about?.trim();
  if (about) return `Is your ${about} better, the same, or worse?`;
  return c.sourceKind === 'food'
    ? `How are you feeling since ${c.subject}?`
    : `How are you feeling since taking ${c.subject}?`;
}

export function checkInTitle(c: Pick<CheckIn, 'subject'>): string {
  return `${c.subject} check-in`;
}

/** The end of a check-in's wait, from the moment the dose or food was logged. */
export function checkInDueAt(from: Date, minutes: number): Date {
  return new Date(from.getTime() + Math.max(1, Math.round(minutes)) * 60000);
}

/** A check-in whose question is due and has no answer yet. */
export function isWaitingForAnswer(c: CheckIn, now: Date = new Date()): boolean {
  return c.answer === null && new Date(c.dueAt).getTime() <= now.getTime();
}

/** One-line description for a dose or food row: the answer, or that it is waiting. */
export function describeCheckIn(c: CheckIn, now: Date = new Date()): string {
  if (c.answer) return `Check-in: ${answerLabel(c.answer).toLowerCase()}`;
  return isWaitingForAnswer(c, now) ? 'Check-in: not answered' : 'Check-in: waiting';
}
