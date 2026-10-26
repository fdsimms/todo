import { currentShieldReasons, outstandingGatesNow, reconcileAppShield } from './appShieldReconcile';
import type { ShieldReasonKind } from './appShield';
import { generateId } from './id';
import { screenTimeBridge } from './screenTimeBridge';
import { canLock, matchKey, type NfcKeyKind } from './nfcKey';
import { cleanReleaseReason, type ReleaseSource } from './shieldRelease';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useFocusStore } from '../store/useFocusStore';
import { useManualBlockStore } from '../store/useManualBlockStore';
import { useNfcKeyStore, type KeyScanResult } from '../store/useNfcKeyStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';

/**
 * End every block that is live right now, and write down that it happened.
 *
 * The one place that does it, for both doors: a key tag (`applyKeyScan`) and
 * the emergency button. It ends each reason where that reason already lives,
 * so nothing here is a second copy of a rule:
 *
 * - the key lock: `unlock`;
 * - schedules: paused until their open window ends (`pauseOpenSchedules`);
 * - a block the person started by hand: dropped (`useManualBlockStore.clear`);
 * - a speed bump the monitor raised: dropped (`clearSpeedBump`, which also disarms
 *   the window that would have lifted it);
 * - a failed-task block: cleared (`setPenaltyShieldUntil(null)`), and the next
 *   failed task starts a fresh one;
 * - a gate and a focus session: remembered as released (`useShieldReleaseStore`),
 *   because neither has an end of its own to write. The session keeps running.
 *
 * What it ends is read from `currentShieldReasons`, the same answer the shield
 * and the Screen Time page use, so it never claims to have ended something that
 * was not blocking. It returns the reasons it ended; an empty list means there
 * was nothing to end, and nothing is recorded.
 *
 * `useAppShieldSync` is subscribed to every store written here, so the system
 * shield follows in the same breath.
 */
export function releaseAllBlocks(source: ReleaseSource, reason?: string): ShieldReasonKind[] {
  const now = new Date();
  const live = currentShieldReasons(now);
  const ended = [...new Set(live.map(r => r.reason))];
  if (ended.length === 0) return [];

  if (ended.includes('key')) useNfcKeyStore.getState().unlock();
  if (ended.includes('schedule')) useAppGroupStore.getState().pauseOpenSchedules(now);
  if (ended.includes('manual')) useManualBlockStore.getState().clear();
  if (ended.includes('speedBump')) {
    screenTimeBridge()?.clearSpeedBump();
    // Nothing in a store changed, so no subscription would lift the shield.
    reconcileAppShield();
  }
  if (ended.includes('penalty')) useSettingsStore.getState().setPenaltyShieldUntil(null, null);
  // Every release goes through here, even one that ends neither: it is also
  // where releases that no longer apply (a done task, a finished session) are
  // forgotten, so the list cannot grow without a reader.
  const session = useFocusStore.getState().session;
  const outstandingIds = new Set(outstandingGatesNow().map(t => t.id));
  useShieldReleaseStore.getState().release(
    {
      gateTaskIds: ended.includes('gate') ? [...outstandingIds] : [],
      focusSessionId: ended.includes('focus') ? session?.id ?? null : null,
    },
    { focusSessionId: session?.id ?? null, outstandingGateIds: outstandingIds },
  );

  // Scanning the tag that raised the lock is how that lock ends, not an early
  // end: it never had an end point to come before. So a tag release records
  // only the other reasons it cut short, and a scan that ended just the lock
  // records nothing. The emergency button records everything, the lock too.
  const cutShort = source === 'tag' ? ended.filter(r => r !== 'key') : ended;
  if (cutShort.length > 0) {
    const cleaned = reason ? cleanReleaseReason(reason) : '';
    useShieldReleaseStore.getState().addRecord({
      id: generateId(),
      at: now.toISOString(),
      source,
      reason: cleaned || null,
      ended: cutShort,
    });
  }
  return ended;
}

/**
 * A tag was read (hardware id), a link was opened (token) or a key code was run
 * from Shortcuts: act on it if it is one of ours.
 *
 * A key tag is the universal way out. With anything blocking, a scan ends all
 * of it, whatever raised it; with nothing blocking it raises the lock, which is
 * what a tag has always done. The one thing it can't do is nothing: a scan that
 * ends nothing locks, so tapping an idle phone is never a silent no-op.
 */
export function applyKeyScan(kind: NfcKeyKind, secret: string | null): KeyScanResult {
  const store = useNfcKeyStore.getState();
  const key = matchKey(store.keys, kind, secret);
  if (!key) return { outcome: 'unknown' };

  const ended = releaseAllBlocks('tag');
  if (ended.length > 0) return { outcome: 'released', key, ended };

  if (canLock(store.keys)) store.lock();
  return { outcome: 'locked', key };
}
