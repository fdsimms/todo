import React, { useState, useMemo } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { useColors } from '../../theme/ThemeContext';
import { PatchNotesModal } from '../../components/PatchNotesModal';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

export function AboutSettings() {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showPatchNotes, setShowPatchNotes] = useState(false);

  return (
    <>
      <SettingsSection label="About">
        <SettingsRow
          icon="information-circle-outline"
          label="Version"
          value={`${Constants.expoConfig?.version || '1.0.0'}${Constants.nativeBuildVersion ? ` (${Constants.nativeBuildVersion})` : ''}`}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="gift-outline"
          iconColor={colors.accent}
          label="What's New"
          chevron
          onPress={() => setShowPatchNotes(true)}
        />
      </SettingsSection>

      <PatchNotesModal visible={showPatchNotes} onDismiss={() => setShowPatchNotes(false)} />
    </>
  );
}
