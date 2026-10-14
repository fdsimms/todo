import { Alert } from 'react-native';
import { haptics } from './haptics';
import { describeEnded } from './shieldRelease';
import type { KeyScanResult } from '../store/useNfcKeyStore';

/**
 * What a key scan says back, for the two doors that apply one without a screen
 * to read it from: a tapped link tag (`openInAppUrl`) and a key code run from
 * Shortcuts (`processPendingKeyScans`). One function so the two can't word the
 * same outcome differently.
 */
export function alertKeyScanResult(result: KeyScanResult, unknown: { title?: string; message: string }): void {
  if (result.outcome === 'unknown') {
    haptics.warning();
    Alert.alert(unknown.title ?? 'Tag not recognized', unknown.message);
    return;
  }
  haptics.success();
  if (result.outcome === 'locked') {
    Alert.alert('Apps locked', `${result.key.name} locked your chosen apps. Tap it again to unlock them.`);
    return;
  }
  Alert.alert(
    'Blocks ended',
    `${result.key.name} ended your ${describeEnded(result.ended)}. ${result.ended.includes('schedule') ? 'A schedule starts again at its next window. ' : ''}This is saved in the record on the Screen Time screen.`,
  );
}
