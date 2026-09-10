import { healthBridge } from './healthBridge';
import { isDemoModeActive } from './demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import { MAX_WEIGHT_KG } from './weightLog';

/**
 * Writing a weight to Apple Health.
 *
 * The sibling of `healthCompletionSync.ts`, deliberately shaped like it: the
 * same three guards in the same order, and the demo-mode refusal first for the
 * same reason. It is a separate file rather than a second function in that one
 * because that file is about what a *completion* writes — a weight is logged by
 * somebody typing it, which is a different event with a different trigger.
 *
 * **The demo-mode gate is checked here as well as inside `healthBridge()`, and
 * that is not redundant.** It is the same belt-and-braces `logTaskWaterToHealth`
 * keeps, and the reason is worth restating rather than inferring: a write leak
 * puts a *real* sample in somebody's *real* Health record, sourced from a
 * session that was fiction, and it survives the demo by however long it takes
 * them to notice and delete it by hand. A weight is the most personal number
 * this app touches, so it gets the check twice.
 *
 * **There is no update or delete counterpart, and no id is kept.** Health is
 * the record — see `docs/arch/health-data.md` — and correcting or removing a
 * weight is something the Health app does properly, with the person's other
 * sources in view. A mirror of that here would be a second, worse editor for
 * data this app does not own.
 */

/**
 * What came of trying to write a weight.
 *
 * Richer than the water write's plain boolean, because the two are surfaced
 * differently: water is logged unattended by a completing task, where every
 * failure is equally not worth interrupting somebody over, while a weight is
 * typed by a person who is standing there waiting to see it land. "Nothing
 * happened" is not an acceptable answer to that, so the caller gets enough to
 * say which of the reasons applied.
 */
export type WeightWriteResult =
  /** The sample was saved. */
  | 'written'
  /** `healthWriteEnabled` is off, so nothing was attempted. */
  | 'off'
  /** No native half: not iOS, no Health on this device, or demo mode. */
  | 'unavailable'
  /** The value was not a weight anything should record. */
  | 'invalid'
  /** HealthKit refused the save, which in practice means sharing is not allowed. */
  | 'refused';

export async function logWeightToHealth(
  kilograms: number,
  when: Date,
): Promise<WeightWriteResult> {
  if (isDemoModeActive()) return 'unavailable';
  if (!Number.isFinite(kilograms) || kilograms <= 0 || kilograms >= MAX_WEIGHT_KG) return 'invalid';

  const { healthWriteEnabled } = useSettingsStore.getState();
  if (!healthWriteEnabled) return 'off';

  const bridge = healthBridge();
  if (!bridge) return 'unavailable';

  const saved = await bridge.writeBodyMassSample(kilograms, when.toISOString());
  return saved ? 'written' : 'refused';
}
