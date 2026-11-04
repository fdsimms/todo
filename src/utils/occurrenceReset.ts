import type { Task } from '../types';

/**
 * The per-occurrence state a row starts a new occurrence without: progress and
 * the target's tap log, a recorded answer, a follow-up day, the stamps that
 * stop a penalty being charged twice, a running timer, and the slot-in marks.
 *
 * completeTask's successor is a new row and writes each of these beside the
 * reason for it. Two other things make a row that must start the same way and
 * have to clear the same ones: a skip, which rolls the row forward in place
 * (`skipPatch`), and a copy (`duplicateRows`). Without them the next
 * occurrence opened at "5/8" with the last one's tap times and answer, and a
 * carried penalty stamp meant it could never be charged. A function, so no two
 * rows share one array.
 */
export function freshOccurrenceFields(): Pick<
  Task,
  | 'progressCount' | 'quotaLoggedDayKey' | 'quotaTapTimes' | 'quotaStartedAt'
  | 'rotationLog' | 'rotationPeriodStart' | 'rotationPlan'
  | 'deliverableValue' | 'deliverableWhy' | 'deliverableRevisitIf'
  | 'followUpOn' | 'penaltyFiredAt' | 'penaltyCreditedAt'
  | 'slotDecidedOn' | 'slotWaitingSince' | 'timerStartedAt' | 'timerElapsedSeconds'
> {
  return {
    progressCount: 0,
    quotaLoggedDayKey: null,
    quotaTapTimes: [],
    quotaStartedAt: null,
    rotationLog: [],
    rotationPeriodStart: null,
    rotationPlan: null,
    deliverableValue: null,
    deliverableWhy: null,
    deliverableRevisitIf: null,
    followUpOn: null,
    penaltyFiredAt: null,
    penaltyCreditedAt: null,
    slotDecidedOn: null,
    slotWaitingSince: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
  };
}
