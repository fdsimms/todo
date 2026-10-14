import { Alert } from 'react-native';
import { haptics } from './haptics';
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
  Alert.alert(
    result.outcome === 'locked' ? 'Apps locked' : result.outcome === 'paused' ? 'Schedule paused' : 'Apps unlocked',
    result.outcome === 'locked'
      ? `${result.key.name} locked your chosen apps. Tap it again to unlock them.`
      : result.outcome === 'paused'
        ? `${result.key.name} paused ${result.count === 1 ? 'the schedule' : 'the schedules'} that ${result.count === 1 ? 'was' : 'were'} blocking apps. ${result.count === 1 ? 'It starts' : 'They start'} again at the next window. Other blocks, like a focus session, stay on.`
        : `${result.key.name} unlocked your chosen apps. Other blocks, like a focus session, stay on.`,
  );
}
