import { Alert } from 'react-native';
import type { Task } from '../types';
import { formatDuration } from './effort';
import { nextSlipIsFree } from './negativeHabits';
import { guardedSlipPrompt, type GuardedSlip } from './rewardGuard';
import { BUTTON_LABEL } from '../copy/shared';
import { openUnlockLinkedTo } from './unlockWorld';

/** A guarded habit's slip, as `useRewardStore.slipGuardFor` reads it. */
export interface SlipGuard {
  plan: GuardedSlip;
  balance: number;
  claimedToday: boolean;
  /** Coins the claim would take from savings for the goal (`savingsNeededFor`). */
  fromSavings?: number;
}

/**
 * Ask before logging a slip that costs something, and go straight through when
 * it doesn't.
 *
 * Shared because a negative task has two tap targets that both report a slip —
 * the row's own leading gutter (`TaskItem`) and the standalone `TaskCheckbox`
 * used everywhere else — and a confirmation on one of them is not a
 * confirmation. Whichever grows third gets it by calling this rather than by
 * copying the wording.
 *
 * The prompt exists because this is the one mis-tap in the app that cannot be
 * taken back: `undoSlip` restores the run but deliberately leaves the block
 * standing, since retracting it would also be a way to retract a block earned
 * by something else entirely (see `slipPenaltyUntil`). Asking first is the
 * cheaper half of that trade — one extra tap, and only for the tasks somebody
 * has actually attached a cost to.
 *
 * `guard` is the habit's guarding reward, when it has one, and replaces the
 * question: the tap is then a claim or a charge of the reward's price.
 */
export function confirmSlip(
  task: Task,
  penaltyEnabled: boolean,
  todayStart: Date,
  onConfirm: () => void,
  guard: SlipGuard | null = null,
): void {
  const penalty = penaltyEnabled && task.penaltyMinutes !== null && !nextSlipIsFree(task, todayStart)
    ? `This blocks the apps you picked for ${formatDuration(task.penaltyMinutes!)}. It can’t be undone.`
    : null;
  // A habit an unlock is linked to ("playing Switch while it's locked"):
  // while the unlock is open, doing the thing isn't a slip, so say so first.
  // It can still be logged, for a slip that happened earlier while it was locked.
  const unlock = guard ? null : openUnlockLinkedTo(task.id);
  if (unlock) {
    Alert.alert(
      'Log a slip anyway?',
      [`${unlock.title} is unlocked today, so doing it now isn’t a slip.`, penalty].filter(Boolean).join(' '),
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: 'Log it', style: 'destructive', onPress: onConfirm },
      ],
    );
    return;
  }
  // A habit a reward guards always asks: the tap either spends the reward's
  // price or takes the balance, and both are worth a second look. A claim
  // records no slip, so it blocks nothing either.
  if (guard) {
    const prompt = guardedSlipPrompt(guard.plan, guard.balance, guard.claimedToday, guard.fromSavings ?? 0);
    const blocks = guard.plan.kind === 'charge' ? penalty : null;
    Alert.alert(
      prompt.title,
      [prompt.message, blocks].filter(Boolean).join(' '),
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: prompt.confirm, style: guard.plan.kind === 'charge' ? 'destructive' : 'default', onPress: onConfirm },
      ],
    );
    return;
  }
  // A slip inside the day's allowance blocks nothing, so there is nothing to confirm.
  if (!penalty) {
    onConfirm();
    return;
  }
  Alert.alert(
    'Log a slip?',
    penalty,
    [
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
      { text: 'Log it', style: 'destructive', onPress: onConfirm },
    ],
  );
}
