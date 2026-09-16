import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { FeatureWheelSheet } from '../../components/FeatureWheelSheet';
import { WHEEL_MAX_SLOTS } from '../../utils/featureWheel';
import { haptics } from '../../utils/haptics';

/**
 * The radial shortcut on its own handle above the tab bar, and which screens
 * it holds.
 *
 * Filed here rather than under Appearance because it answers the same question
 * the two switches above it do — which parts of the app you actually use — and
 * a shortcut to six screens is that question asked a third time. What it is
 * *not* is a way to reach anything: every tab still switches on a tap exactly
 * as it always did, and the handle isn't on top of them, which is the whole
 * reason the wheel is allowed to be a gesture.
 */
export function FeatureWheelSettings() {
  const colors = useColors();
  const [sheetVisible, setSheetVisible] = useState(false);

  const enabled = useSettingsStore(s => s.featureWheelEnabled);
  const setEnabled = useSettingsStore(s => s.setFeatureWheelEnabled);
  const routes = useSettingsStore(useShallow(s => s.featureWheelRoutes));

  const count = Math.min(routes.length, WHEEL_MAX_SLOTS);

  return (
    <>
      <SettingsSection
        label="Feature wheel"
        footer="Tapping a tab still does what it always did, and tapping More still opens the full menu with everything in it. The wheel is a shortcut over the top of that, not a replacement for it, opened from its own handle rather than the tabs themselves."
      >
        <SettingsRow
          entryId="featureWheelEnabled"
          icon="radio-button-on-outline"
          iconColor={enabled ? colors.accent : undefined}
          label="Feature wheel"
          hint={enabled
            ? 'Press the small handle above the tab bar and drag to open it'
            : 'Tabs only switch screens'}
          toggle={enabled}
          onPress={() => setEnabled(!enabled)}
        />
        {enabled && (
          <SettingsRow
            entryId="featureWheelRoutes"
            icon="list-outline"
            label="What's on it"
            hint={`Up to ${WHEEL_MAX_SLOTS} screens or groups, in the order you put them`}
            value={count === 0 ? 'Nothing' : count === 1 ? '1 screen' : `${count} screens`}
            chevron
            onPress={() => { haptics.tap(); setSheetVisible(true); }}
          />
        )}
      </SettingsSection>
      <FeatureWheelSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </>
  );
}
