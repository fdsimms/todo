import type { RewardUnlock } from '../types';
import { statusOfUnlock, type UnlockWorld } from './rewardUnlocks';
import type { UnlockBlock } from './unlockBlockText';

/**
 * Which unlocks want apps blocked right now: the rule behind the shield's
 * "unlock" reason, with no store or native call in it.
 *
 * An unlock with a `blockGroupId` blocks that group of apps for exactly as long
 * as it is `locked`. Open, free (a weekend or vacation it opens on) and playing
 * all lift it, because `statusOfUnlock` already folds those into one answer and
 * this reads nothing else. That is what keeps the block from disagreeing with
 * the Rewards screen about whether the unlock is open.
 *
 * It moves no coins and reads none beyond what the status already does: the
 * "coins never touch the shield" rule (docs/arch/rewards.md) is about coins
 * unblocking apps, and this is the other direction, work unblocking them.
 */
/** The unlocks holding apps shut, oldest first. Empty while rewards are off. */
export function lockedUnlockBlocks(
  unlocks: readonly RewardUnlock[],
  world: UnlockWorld,
  rewardsEnabled: boolean,
  /** Unlocks whose block was ended early today (`isUnlockReleased`). */
  released: (unlockId: string) => boolean = () => false,
): UnlockBlock[] {
  if (!rewardsEnabled) return [];
  const out: UnlockBlock[] = [];
  for (const unlock of unlocks) {
    if (!unlock.blockGroupId) continue;
    if (released(unlock.id)) continue;
    if (statusOfUnlock(unlock, world).status.kind !== 'locked') continue;
    out.push({ id: unlock.id, title: unlock.title, groupId: unlock.blockGroupId });
  }
  return out;
}
