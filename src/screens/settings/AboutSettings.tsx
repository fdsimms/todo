import React, { useState, useMemo } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { useColors } from '../../theme/ThemeContext';
import { PatchNotesModal } from '../../components/PatchNotesModal';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { setTabDiagEnabled, useTabDiagEnabled } from '../../components/FreezeWhenBlurred';

export function AboutSettings() {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  // TEMPORARY: the switch for the blank-tab diagnostic in FreezeWhenBlurred.
  const tabDiag = useTabDiagEnabled();

  return (
    <>
      <SettingsSection label="About">
        <SettingsRow
          entryId="version"
          icon="information-circle-outline"
          label="Version"
          value={`${Constants.expoConfig?.version || '1.0.0'}${Constants.nativeBuildVersion ? ` (${Constants.nativeBuildVersion})` : ''}`}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="patchNotes"
          icon="gift-outline"
          iconColor={colors.accent}
          label="What's New"
          chevron
          onPress={() => setShowPatchNotes(true)}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="tabDiagnostics"
          icon="bug-outline"
          iconColor={tabDiag ? colors.accent : undefined}
          label="Show tab diagnostics"
          hint={tabDiag
            ? 'Shows a line of debug text over every screen'
            : 'Debug text for the blank screen bug is hidden'}
          toggle={tabDiag}
          onPress={() => setTabDiagEnabled(!tabDiag)}
        />
      </SettingsSection>

      <PatchNotesModal visible={showPatchNotes} onDismiss={() => setShowPatchNotes(false)} />
    </>
  );
}
