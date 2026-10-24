import { healthBridge } from './healthBridge';
import { isDemoModeActive } from './demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import { isPlausibleReading, MIN_PULSE, MAX_PULSE } from './bloodPressureLog';
import { isPlausiblePulse } from './pulseLog';

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
export type BloodPressureWriteResult =
  | 'written'
  /** The reading landed and the optional pulse did not. */
  | 'writtenWithoutPulse'
  | 'off'
  | 'unavailable'
  | 'invalid'
  | 'refused';

export async function logBloodPressureToHealth(
  systolic: number,
  diastolic: number,
  pulse: number | null,
  when: Date,
): Promise<BloodPressureWriteResult> {
  if (isDemoModeActive()) return 'unavailable';
  if (!isPlausibleReading(systolic, diastolic)) return 'invalid';
  if (pulse !== null && (!Number.isInteger(pulse) || pulse < MIN_PULSE || pulse > MAX_PULSE)) return 'invalid';

  if (!useSettingsStore.getState().healthWriteEnabled) return 'off';

  const bridge = healthBridge();
  if (!bridge) return 'unavailable';

  const outcome = await bridge.writeBloodPressureSample(systolic, diastolic, pulse, when.toISOString());
  if (outcome === 'saved') return 'written';
  return outcome === 'pulseRefused' ? 'writtenWithoutPulse' : 'refused';
}

/** What came of trying to write a pulse on its own. A subset of the reading's results. */
export type PulseWriteResult = 'written' | 'off' | 'unavailable' | 'invalid' | 'refused';

/**
 * Writing one pulse to Apple Health with no blood pressure beside it. The same
 * guards in the same order as `logBloodPressureToHealth`, demo mode first: a
 * leak would put a real sample in somebody's real Health record.
 */
export async function logPulseToHealth(pulse: number, when: Date): Promise<PulseWriteResult> {
  if (isDemoModeActive()) return 'unavailable';
  if (!isPlausiblePulse(pulse)) return 'invalid';

  if (!useSettingsStore.getState().healthWriteEnabled) return 'off';

  const bridge = healthBridge();
  if (!bridge) return 'unavailable';

  return (await bridge.writeHeartRateSample(pulse, when.toISOString())) ? 'written' : 'refused';
}
