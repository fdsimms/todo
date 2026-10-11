import React, { useState, useMemo, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import Constants from 'expo-constants';
import { useColors } from '../../theme/ThemeContext';
import { PatchNotesModal } from '../../components/PatchNotesModal';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { setFlagMode, getFlagModeVersion, isFlagMode, subscribeFlagMode } from '../../utils/copyFlagMode';
import { setTabDiagEnabled, useTabDiagEnabled } from '../../components/FreezeWhenBlurred';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { perfReportText } from '../../utils/perfReport';

export function AboutSettings() {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  // TEMPORARY: the switch for the blank-tab diagnostic in FreezeWhenBlurred.
  const tabDiag = useTabDiagEnabled();
  // TEMPORARY dev tooling (see CopyFlag): session-only, so it can't stay on.
  useSyncExternalStore(subscribeFlagMode, getFlagModeVersion);
  const flagMode = isFlagMode();
  const { copy: copyPerf, copied: perfCopied } = useCopyToClipboard();

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
          label="What’s New"
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
        <View style={styles.sep} />
        <SettingsRow
          entryId="perfLog"
          icon="speedometer-outline"
          label="Copy performance log"
          hint="Copies how long each launch step took, plus the launch and hang times iOS measures. Stays on this device until you paste it."
          value={perfCopied ? 'Copied' : undefined}
          onPress={() => copyPerf(perfReportText())}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="flagCopy"
          icon="flag-outline"
          iconColor={flagMode ? colors.accent : undefined}
          label="Flag copy"
          hint={flagMode
            ? 'Long-press any text to flag it for a rewrite'
            : 'Turns on long-press flagging for text on every screen'}
          toggle={flagMode}
          onPress={() => setFlagMode(!flagMode)}
        />
      </SettingsSection>

      <PatchNotesModal visible={showPatchNotes} onDismiss={() => setShowPatchNotes(false)} />
    </>
  );
}
