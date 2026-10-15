import type { ShieldReasonEntry } from './appShield';
import { isScheduleActive, type BlockSchedule } from './blockSchedule';
import type { GroupedReason } from './appGroups';

/**
 * What can't be edited while a block is live: the rules, with no store or clock.
 *
 * **Editing what a live block holds is a way to end it, and ending a block is
 * `releaseAllBlocks`'s job, because that is the one path that writes a record**
 * (`releaseBlocks.ts`). Emptying the group a block names, deleting it, pointing
 * its reason at another group, or turning off or rewriting the schedule that
 * raised it would all lift the shield with nothing saved. So each of those is
 * refused while it is live, and allowed again the moment the block ends.
 *
 * A key tag never edits anything: it ends blocks, and the lock follows what is
 * live, so there is no separate "tag may edit" state.
 *
 * "Live" is the same list the shield and the Screen Time screen read
 * (`currentShieldReasons`), passed in so this stays pure.
 */

/** Groups a live reason names right now. */
export function liveGroupIds(reasons: readonly ShieldReasonEntry[]): Set<string> {
  return new Set(reasons.flatMap(r => r.groupIds));
}

/** Whether the apps picked for a group, or the group itself, are being blocked right now. */
export function groupEditLocked(groupId: string, reasons: readonly ShieldReasonEntry[]): boolean {
  return liveGroupIds(reasons).has(groupId);
}

/**
 * Whether changing which group a reason blocks would move a live block. The
 * reason's own entry is what matters, not the group it names: pointing a live
 * reason at an empty group is the same escape as emptying its group.
 */
export function reasonGroupLocked(reason: GroupedReason, reasons: readonly ShieldReasonEntry[]): boolean {
  return reasons.some(r => r.reason === reason);
}

/**
 * Whether turning a reason's own switch off would end a live block. Same test as
 * `reasonGroupLocked`, named for what it guards: the switch is as good a way out
 * as emptying the group. Turning one on is never refused.
 */
export function reasonSwitchLocked(reason: GroupedReason, reasons: readonly ShieldReasonEntry[]): boolean {
  return reasons.some(r => r.reason === reason);
}

/**
 * Whether changing the default group would move a live block. A reason whose
 * group is missing resolves to the default, so the old default and the new one
 * both count.
 */
export function defaultGroupLocked(
  currentDefaultId: string,
  nextDefaultId: string,
  reasons: readonly ShieldReasonEntry[],
): boolean {
  return groupEditLocked(currentDefaultId, reasons) || groupEditLocked(nextDefaultId, reasons);
}

/** Whether a schedule is blocking right now. A paused or switched-off one is not, and stays editable. */
export function scheduleEditLocked(schedule: BlockSchedule, now: Date): boolean {
  return isScheduleActive(schedule, now);
}

export const BLOCK_EDIT_LOCKED_TITLE = 'Blocked right now';

export const BLOCK_EDIT_LOCKED_MESSAGE =
  'This is blocking apps right now, so it can’t be changed. End the block first, then change it. The emergency button on this screen ends it and is saved in the record.';
