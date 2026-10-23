import { healthBridge } from './healthBridge';
import { isDemoModeActive } from './demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import { isPlausibleReading } from './bloodPressureLog';

/**
 * Writing a blood pressure reading to Apple Health.
 *
 * The sibling of `healthWeightSync.ts`, with the same guards in the same order
 * and the demo-mode refusal first, checked here as well as inside
 * `healthBridge()`: a leak would put a real sample in somebody's real Health
 * record. No id is kept and there is no edit or delete, since Health is the
 * record and correcting a reading is something the Health app does with the
 * person's other sources in view.
 */

/** What came of trying to write a reading. Same meanings as `WeightWriteResult`. */
export type BloodPressureWriteResult = 'written' | 'off' | 'unavailable' | 'invalid' | 'refused';

export async function logBloodPressureToHealth(
  systolic: number,
  diastolic: number,
  when: Date,
): Promise<BloodPressureWriteResult> {
  if (isDemoModeActive()) return 'unavailable';
  if (!isPlausibleReading(systolic, diastolic)) return 'invalid';

  if (!useSettingsStore.getState().healthWriteEnabled) return 'off';

  const bridge = healthBridge();
  if (!bridge) return 'unavailable';

  const saved = await bridge.writeBloodPressureSample(systolic, diastolic, when.toISOString());
  return saved ? 'written' : 'refused';
}
