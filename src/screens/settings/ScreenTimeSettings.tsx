import React, { useMemo, useState } from 'react';
import { View, Alert, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useNfcKeyStore } from '../../store/useNfcKeyStore';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';
import { isDemoModeActive } from '../../utils/demoState';
import { screenTimeBridge } from '../../utils/screenTimeBridge';
import { isNfcSupported, scanKeyTag } from '../../utils/nfcBridge';
import { keyLinkUrl, type NfcKey } from '../../utils/nfcKey';
import { UNIVERSAL_LINK_HOSTS } from '../../utils/deepLinks';
import { alertPermissionOff } from '../../utils/permissionAlert';
import type { ShieldReasonEntry } from '../../utils/appShield';
import { shieldReasonLines } from '../../utils/shieldReasonText';
import { navigateToSettingsEntry } from '../../navigation/openSettings';
import { format } from 'date-fns/format';
import { clockTimeToken } from '../../utils/clockTime';

interface Props {
  /** Why the apps are blocked right now, so each switch can say what it is doing. */
  reasons: readonly ShieldReasonEntry[];
  /** How many apps and categories are picked, and how that reads. */
  selectedTotal: number;
  selectionLabel: string;
  /** Opens the system picker. Owned by the screen, which also shows the count. */
  onChooseApps: () => Promise<void>;
}

/**
 * Every setting that decides when the picked apps are blocked: the apps
 * themselves, the three reasons a block can start, and the key tags.
 *
 * These rows used to sit inside Focus sessions, after nine unrelated break and
 * timer rows. They are one feature with one list of apps, so they live
 * together, and the Screen Time screen puts the answer to "are my apps blocked
 * right now" above them. The ids are unchanged apart from the three "Apps to
 * block" rows, which are now one (`screenTimeApps`), so Settings search lands
 * on the same switches.
 *
 * **A tag is one reason among four and never ends the other three** (see
 * `appShield.ts` and `docs/arch/nfc-key.md`). Nothing on this screen may add a
 * button that lifts a focus, gate or penalty block: the penalty's only way out
 * is switching the feature off, which is deliberate.
 */
export function ScreenTimeSettings({ reasons, selectedTotal, selectionLabel, onChooseApps }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const navigation = useNavigation();

  const focusShieldEnabled = useSettingsStore(s => s.focusShieldEnabled);
  const setFocusShieldEnabled = useSettingsStore(s => s.setFocusShieldEnabled);
  const gateShieldEnabled = useSettingsStore(s => s.gateShieldEnabled);
  const setGateShieldEnabled = useSettingsStore(s => s.setGateShieldEnabled);
  const penaltyShieldEnabled = useSettingsStore(s => s.penaltyShieldEnabled);
  const setPenaltyShieldEnabled = useSettingsStore(s => s.setPenaltyShieldEnabled);
  const setPenaltyShieldUntil = useSettingsStore(s => s.setPenaltyShieldUntil);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  const screenTimeRules = useSettingsStore(s => s.screenTimeRules);

  // ==== authorization ====

  // Asking is a Settings action and never something the app does on its own,
  // the same rule the weather rules sheet follows for location. In demo mode
  // the bridge is refused (nothing may touch the real shield), so the switches
  // work against the demo's own settings and ask for nothing.
  const ensureAuthorized = async (message: string): Promise<boolean> => {
    if (isDemoModeActive()) return true;
    const bridge = screenTimeBridge();
    if (!bridge) return false;
    const status = await bridge.requestScreenTimeAuthorization();
    if (status === 'approved') return true;
    alertPermissionOff('Screen Time access needed', message);
    return false;
  };

  const handleChooseApps = async () => {
    haptics.tap();
    if (!(await ensureAuthorized('Choosing apps to block needs Screen Time access. Grant it in Settings, under Screen Time.'))) return;
    await onChooseApps();
  };

  /**
   * Turn a reason on or off. Switching on asks for access and, the first time,
   * goes straight into the picker: the switch does nothing until some apps are
   * chosen, and a toggle that visibly changes nothing is how somebody concludes
   * the feature is broken.
   */
  const toggleReason = async (
    enabled: boolean,
    setEnabled: (on: boolean) => void,
    message: string,
    onOff?: () => void,
  ) => {
    haptics.tap();
    if (enabled) {
      setEnabled(false);
      onOff?.();
      return;
    }
    if (!(await ensureAuthorized(message))) return;
    setEnabled(true);
    if (selectedTotal === 0) await onChooseApps();
  };

  // ==== reasons ====

  const gateReason = reasons.find(r => r.reason === 'gate');
  const penaltyReason = reasons.find(r => r.reason === 'penalty');
  const focusHolding = reasons.some(r => r.reason === 'focus');
  const gateCount = gateReason?.titles?.length ?? 0;
  const penaltyLine = penaltyReason
    ? shieldReasonLines(penaltyReason, iso => {
      const when = new Date(iso);
      return Number.isNaN(when.getTime()) ? null : format(when, clockTimeToken(use24HourTime));
    })[0]
    : null;
  const penaltyEndLabel = penaltyReason?.until && !Number.isNaN(new Date(penaltyReason.until).getTime())
    ? format(new Date(penaltyReason.until), clockTimeToken(use24HourTime))
    : null;

  // ==== key tags ====

  // Asked once: whether this phone can read a tag cannot change while the
  // screen is up. A phone that can't still has link tags.
  const [nfcSupported] = useState(isNfcSupported);
  const nfcKeys = useNfcKeyStore(s => s.keys);
  const keyLocked = useNfcKeyStore(s => s.locked);

  const nameThen = (title: string, fallback: string, then: (name: string) => void) => {
    // iOS only, like the rest of this screen, so the prompt needs no Android branch.
    Alert.prompt(title, 'Choose a name so you can tell your tags apart.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add', onPress: (text?: string) => then(text ?? '') },
    ], 'plain-text', fallback);
  };

  const enrollFailed = (reason: 'unreadable' | 'full' | 'duplicate') => {
    Alert.alert(
      reason === 'duplicate' ? 'Already added' : reason === 'full' ? 'Too many tags' : 'Couldn’t read the tag',
      reason === 'duplicate'
        ? 'This tag is already one of your keys.'
        : reason === 'full'
          ? 'Remove a tag before adding another.'
          : 'Hold the top of your phone to the tag and try again.',
    );
  };

  const handleScanTag = async () => {
    const result = await scanKeyTag('Hold your phone to the tag you want to use as a key.');
    if (result.kind !== 'tag') return;
    nameThen('Name this tag', 'Key tag', name => {
      const enrolled = useNfcKeyStore.getState().enrollTag(result.uid, name);
      if (!enrolled.ok) enrollFailed(enrolled.reason);
      else haptics.success();
    });
  };

  const shareKeyLink = async (key: NfcKey) => {
    const url = keyLinkUrl(key.secret, UNIVERSAL_LINK_HOSTS);
    if (!url) return;
    await Share.share({ message: url }).catch(() => {});
  };

  const handleAddLink = () => {
    nameThen('Name this link tag', 'Link tag', name => {
      const enrolled = useNfcKeyStore.getState().enrollLink(name);
      if (!enrolled.ok) {
        enrollFailed(enrolled.reason);
        return;
      }
      haptics.success();
      Alert.alert(
        'Write the link to a tag',
        'Next, share the link and write it to an NFC tag with an NFC writer app. After that, tapping the tag with the app closed locks or unlocks your apps.',
        [{ text: 'Share link', onPress: () => { void shareKeyLink(enrolled.key); } }, { text: 'Later', style: 'cancel' }],
      );
    });
  };

  const handleAddKey = () => {
    haptics.tap();
    const buttons = [
      ...(nfcSupported ? [{ text: 'Scan a tag', onPress: () => { void handleScanTag(); } }] : []),
      { text: 'Write a link to a tag', onPress: handleAddLink },
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(
      'Add a key tag',
      nfcSupported
        ? 'Scan a tag to use as a key, or write a link to a tag so a tap works with the app closed.'
        : 'This phone can’t scan tags in the app. Write a link to a tag instead, and a tap works with the app closed.',
      buttons,
    );
  };

  const handleKeyRow = (key: NfcKey) => {
    haptics.tap();
    const remove = () => {
      Alert.alert(
        `Remove ${key.name}?`,
        keyLocked && nfcKeys.length === 1
          ? 'This is your only key tag, so removing it also unlocks your apps.'
          : 'This tag will no longer lock or unlock your apps.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => useNfcKeyStore.getState().removeKey(key.id) },
        ],
      );
    };
    Alert.alert(key.name, undefined, [
      ...(key.kind === 'link' ? [{ text: 'Share link', onPress: () => { void shareKeyLink(key); } }] : []),
      { text: 'Remove', style: 'destructive' as const, onPress: remove },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const handleKeyLock = async () => {
    haptics.tap();
    if (keyLocked) {
      // Unlocking from the app takes a scan: a button here would be the way
      // out of a lock whose whole purpose is to need the tag.
      if (!nfcSupported) {
        Alert.alert('Tap your tag to unlock', 'This phone can’t scan tags in the app. Tap a link tag with the app closed to unlock.');
        return;
      }
      const result = await scanKeyTag('Hold your phone to your key tag to unlock your apps.');
      if (result.kind !== 'tag') return;
      const scan = useNfcKeyStore.getState().applyScan('tag', result.uid);
      if (scan.outcome === 'unknown') {
        haptics.warning();
        Alert.alert('Tag not recognized', 'This tag isn’t one of your key tags. A link tag unlocks by tapping it with the app closed.');
      } else {
        haptics.success();
      }
      return;
    }
    if (nfcKeys.length === 0) {
      Alert.alert('Add a key tag first', 'Locking needs a tag to unlock it with.');
      return;
    }
    if (!(await ensureAuthorized('Locking apps with a tag needs Screen Time access. Grant it in Settings, under Screen Time.'))) return;
    if (selectedTotal === 0) await onChooseApps();
    useNfcKeyStore.getState().lock();
  };

  const activeRuleCount = screenTimeRules.filter(r => r.enabled).length;

  return (
    <>
      <SettingsSection label="Apps">
        <SettingsRow
          entryId="screenTimeApps"
          icon="apps-outline"
          iconColor={selectedTotal > 0 ? colors.accent : undefined}
          label="Apps to block"
          hint="One list for every reason below. iOS doesn’t share which apps you picked, so only the count shows here."
          value={selectionLabel}
          onPress={handleChooseApps}
        />
      </SettingsSection>

      <SettingsSection label="Reasons to block">
        <SettingsRow
          entryId="focusShield"
          icon="timer-outline"
          iconColor={focusShieldEnabled ? colors.accent : undefined}
          label="While focusing"
          hint={focusShieldEnabled
            ? focusHolding
              ? 'A session is running, so the apps are blocked. They unblock when you pause or finish it.'
              : 'Blocked while a focus session is running, and unblocked when you pause or finish it.'
            : 'Apps stay available during a session.'}
          toggle={focusShieldEnabled}
          onPress={() => toggleReason(
            focusShieldEnabled, setFocusShieldEnabled,
            'Blocking apps during a focus session needs Screen Time access. Grant it in Settings, under Screen Time.',
          )}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="gateShield"
          icon="checkbox-outline"
          iconColor={gateShieldEnabled ? colors.accent : undefined}
          label="Until a task is done"
          hint={gateShieldEnabled
            ? gateCount > 0
              ? `${gateCount} ${gateCount === 1 ? 'task is' : 'tasks are'} holding your apps now. Finishing a task, or moving it to another day, unblocks them.`
              : 'Tasks you mark keep the apps blocked while they sit on Today undone. No task is holding them now.'
            : 'No tasks block apps.'}
          toggle={gateShieldEnabled}
          onPress={() => toggleReason(
            gateShieldEnabled, setGateShieldEnabled,
            'Blocking apps until a task is done needs Screen Time access. Grant it in Settings, under Screen Time.',
          )}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="penaltyShield"
          icon="alert-circle-outline"
          iconColor={penaltyShieldEnabled ? colors.accent : undefined}
          label="When you fail a task"
          hint={penaltyShieldEnabled
            ? penaltyEndLabel
              ? `${penaltyLine ?? 'A task wasn’t done in time.'} To end this early, turn this off.`
              : 'Each task sets how long. The apps are blocked when you miss a cutoff, or log a slip on a task you’re avoiding.'
            : 'Failing a task blocks nothing.'}
          toggle={penaltyShieldEnabled}
          onPress={() => toggleReason(
            penaltyShieldEnabled, setPenaltyShieldEnabled,
            'Blocking apps when you fail a task needs Screen Time access. Grant it in Settings, under Screen Time.',
            // Switching the feature off is the way out of a block being
            // served, so the block must not be left waiting to resume the
            // moment it comes back on. This is deliberately the *only* way out
            // from inside the app: a "lift it now" button would undo the one
            // thing the feature is for.
            () => setPenaltyShieldUntil(null),
          )}
        />
      </SettingsSection>

      <SettingsSection label="Key tags">
        <SettingsRow
          entryId="nfcKeyLock"
          icon="lock-closed-outline"
          iconColor={keyLocked ? colors.accent : undefined}
          label="Locked"
          hint={keyLocked
            ? 'The apps are locked. Tap a key tag to unlock them. A tag never ends a focus session or a block from a task.'
            : nfcKeys.length === 0
              ? 'Add a key tag to use this.'
              : 'Turn on to lock the apps until you tap a key tag.'}
          toggle={keyLocked}
          onPress={handleKeyLock}
        />
        {nfcKeys.map(key => (
          <React.Fragment key={key.id}>
            <View style={styles.sep} />
            <SettingsRow
              icon={key.kind === 'link' ? 'link-outline' : 'radio-outline'}
              label={key.name}
              value={key.kind === 'link' ? 'Link tag' : 'Scanned tag'}
              onPress={() => handleKeyRow(key)}
            />
          </React.Fragment>
        ))}
        <View style={styles.sep} />
        <SettingsRow
          entryId="nfcKey"
          icon="add-circle-outline"
          iconColor={colors.accent}
          label="Add a key tag"
          hint={nfcSupported
            ? 'Scan a tag to use as a key, or write a link to a tag so a tap works with the app closed.'
            : 'This phone can’t scan tags in the app. Write a link to a tag so a tap works with the app closed.'}
          onPress={handleAddKey}
        />
      </SettingsSection>

      <SettingsSection label="Usage rules">
        <SettingsRow
          icon="list-outline"
          label="Tasks from app usage"
          hint="Add a task when you pass an amount of time in an app. These are set up under Automations."
          value={activeRuleCount === 0 ? 'No rules' : activeRuleCount === 1 ? '1 rule' : `${activeRuleCount} rules`}
          onPress={() => { haptics.tap(); navigateToSettingsEntry(navigation, 'gen:screenTime'); }}
        />
      </SettingsSection>
    </>
  );
}
