/**
 * Milestones: the day something changed (started a medicine, a new job, moved
 * house), which `mood_insights` reads as a before/after split against the mood
 * log (docs/arch/mood-log.md, "Milestones").
 *
 * Every write goes through `useMilestoneStore`'s own actions, by way of the
 * replica, so a blank label is refused as the sheet refuses it. The date is
 * anchored at noon of the day named, the way `MilestoneSheet` anchors a picked
 * day, because the row's date is the split point every before/after read is
 * built on and a zone or DST boundary must not drag it onto the wrong day.
 *
 * Two rules from the doc shape the words here. Each milestone is its own
 * split: a "Started X" and a later "Stopped X" are two milestones, never paired
 * into one chart, so the tools never offer to pair them. And the contrast is
 * `mood_insights`' to report, under its own floors; a list of milestones says
 * only what and when.
 */
import type { Milestone } from '../../src/types';
import type { Replica } from './replica';
import { eventNoonIso } from './taskFields';

export interface MilestoneRow {
  id: string;
  label: string;
  /** `YYYY-MM-DD`, the day it happened. */
  date: string;
}

const EACH_IS_ITS_OWN = 'mood_insights reads mood before and after each milestone, on its own day, under its minimum-days rules. A start and a later stop are two milestones, read separately; do not pair them, and do not say a milestone caused a change.';

/**
 * The day a milestone is on, as the app keys it. The stored instant is noon of
 * the picked day in the phone's zone, so its UTC date is the day before for a
 * zone far enough east: the day comes from the replica's day key, never from
 * cutting the ISO string.
 */
function row(replica: Replica, m: Milestone): MilestoneRow {
  return { id: m.id, label: m.label, date: replica.logicalDayKeyOf(m.date) };
}

/** A bare day or an ISO instant as the noon the sheet would store, or a refusal naming the field. */
function noonOf(value: string, field: string): Date {
  const iso = eventNoonIso(value);
  if (!iso) throw new Error(`${field}: "${value}" is not a date I can read. Use YYYY-MM-DD.`);
  return new Date(iso);
}

export interface MilestoneList {
  milestones: MilestoneRow[];
  note: string;
}

export function listMilestones(replica: Replica): MilestoneList {
  return {
    milestones: replica.milestones().map(m => row(replica, m)),
    note: `${EACH_IS_ITS_OWN} Milestones reach this server only with Include health logs turned on for the sync server on the phone, so an empty list is not evidence that none were recorded.`,
  };
}

export interface AddMilestoneInput {
  label: string;
  /** `YYYY-MM-DD`. Defaults to the person's logical today. */
  date?: string;
}

export function addMilestone(replica: Replica, input: AddMilestoneInput): { milestone: MilestoneRow; note: string } {
  const date = noonOf(input.date ?? replica.todayKey(), 'date');
  const milestone = replica.addMilestone(input.label, date);
  return { milestone: row(replica, milestone), note: EACH_IS_ITS_OWN };
}

export interface MilestonePatchInput {
  label?: string;
  /** `YYYY-MM-DD`. */
  date?: string;
}

export function updateMilestone(replica: Replica, id: string, patch: MilestonePatchInput): { milestone: MilestoneRow } {
  if (patch.label === undefined && patch.date === undefined) throw new Error('Nothing to change: give a label, a date, or both.');
  const milestone = replica.updateMilestone(id, {
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.date !== undefined ? { date: noonOf(patch.date, 'date') } : {}),
  });
  return { milestone: row(replica, milestone) };
}

export function deleteMilestone(replica: Replica, id: string): { removed: MilestoneRow } {
  return { removed: row(replica, replica.deleteMilestone(id)) };
}
