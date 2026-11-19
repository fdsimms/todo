import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useScreenTimeStore } from '../../store/useScreenTimeStore';
import { useColors } from '../../theme/ThemeContext';
import { screenTimeBridge, isScreenTimeSupported } from '../../utils/screenTimeBridge';
import { USAGE_GROUP_ID, USAGE_STEP_MINUTES } from '../../utils/screenTimeUsage';
import { selectionLabel } from '../../utils/shieldReasonText';
import { alertPermissionOff } from '../../utils/permissionAlert';
import { haptics } from '../../utils/haptics';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

type Count = { applications: number; categories: number; websites?: number };

const NONE: Count = { applications: 0, categories: 0, websites: 0 };

const totalOf = (c: Count) => c.applications + c.categories + (c.websites ?? 0);

/**
 * The switch that records daily phone use for Mood Insights, and the apps it
 * counts. A section of its own, beside the Screen Time screen's other rows,
 * so the screen itself gains one line (`docs/arch/mood-log.md`, "Phone use").
 *
 * The apps are chosen under the reserved `usage` group rather than the Default
 * one: Default is what gets blocked, and counting everything is the opposite
 * choice. The system picker has no "everything", so the hint tells the person
 * to pick every category.
 */
export function ScreenTimeUsageSection() {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const usageOn = useSettingsStore(s => s.screenTimeUsage);
  const setUsageOn = useSettingsStore(s => s.setScreenTimeUsage);
  const usageDays = useScreenTimeStore(s => s.usageDays);
  const usageArmed = useScreenTimeStore(s => s.usageArmed);
  const [chosen, setChosen] = useState<Count>(NONE);

  const readChosen = useCallback(() => {
    setChosen(screenTimeBridge()?.screenTimeSelectionCount(USAGE_GROUP_ID) ?? NONE);
  }, []);
  useFocusEffect(readChosen);

  // Same refusal the other Screen Time rows make: asking is a Settings action
  // and never something the app does on its own.
  const authorize = async (): Promise<boolean> => {
    const bridge = screenTimeBridge();
    if (!bridge) return false;
    if ((await bridge.requestScreenTimeAuthorization()) === 'approved') return true;
    alertPermissionOff(
      'Screen Time access needed',
      'Counting your screen time needs Screen Time access. Grant it in Settings, under Screen Time.',
    );
    return false;
  };

  const chooseApps = async () => {
    const bridge = screenTimeBridge();
    if (!bridge) return;
    if (!(await authorize())) return;
    const picked = await bridge.presentAppPicker(USAGE_GROUP_ID, false);
    if (!picked) return;
    readChosen();
    // The picker's own counts win over a read-back, which can say none right after a pick.
    if (picked.counts) setChosen(picked.counts);
    // A changed choice is a different ladder, so it is armed again even if the day hasn't moved.
    void useScreenTimeStore.getState().armMonitor(true);
  };

  const toggle = async () => {
    haptics.tap();
    if (usageOn) {
      setUsageOn(false);
      useScreenTimeStore.getState().clearUsage();
      return;
    }
    if (!(await authorize())) return;
    setUsageOn(true);
    // Nothing is counted until some apps are chosen, so the picker opens now.
    if (totalOf(chosen) === 0) await chooseApps();
  };

  // Not a switch the person can reach in Expo Go, on Android or in demo mode.
  if (!isScreenTimeSupported()) return null;

  const days = usageDays.length;
  return (
    <SettingsSection
      label="Screen time for Mood Insights"
      footer={`Records how long you use your phone each day, in ${USAGE_STEP_MINUTES} minute steps, and compares it with your mood on the Mood Insights screen. It stays on this phone. Turning it off deletes what it recorded.`}
    >
      <SettingsRow
        entryId="screenTimeUsage"
        icon="phone-portrait-outline"
        iconColor={usageOn ? colors.accent : undefined}
        label="Count screen time"
        hint="Only days from when you turn this on are counted."
        toggle={usageOn}
        onPress={() => { void toggle(); }}
      />
      {usageOn && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="screenTimeUsageApps"
            icon="apps-outline"
            label="What counts"
            hint="Pick every category to count all your use."
            value={totalOf(chosen) === 0 ? 'None' : selectionLabel(chosen.applications, chosen.categories, chosen.websites ?? 0)}
            chevron
            onPress={() => { haptics.tap(); void chooseApps(); }}
          />
          {usageArmed === false && totalOf(chosen) > 0 && (
            <>
              <View style={styles.sep} />
              <SettingsRow
                icon="warning-outline"
                iconColor={colors.red}
                label="Couldn’t start counting"
                hint="iOS refused to start it, which can happen when many usage rules are running. Remove a rule or speed bump and open the app again."
                alwaysShowHint
              />
            </>
          )}
          <View style={styles.sep} />
          <SettingsRow
            icon="calendar-outline"
            label="Days counted"
            value={days === 1 ? '1 day' : `${days} days`}
          />
        </>
      )}
    </SettingsSection>
  );
}
