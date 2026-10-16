import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Alert } from 'react-native';
import { useDemoStore } from '../../store/useDemoStore';
import { dbOptimizeStorage, dbStorageStats } from '../../db/database';
import { availableDiskBytes, recipeImagesBytes } from '../../utils/recipePhoto';
import {
  describeAreas,
  formatBytes,
  optimizeBlockedReason,
  worthOptimizing,
  type StorageStats,
} from '../../utils/storageReport';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

function readStats(): StorageStats | null {
  try {
    return { ...dbStorageStats(), photoBytes: recipeImagesBytes() };
  } catch {
    return null;
  }
}

/**
 * Settings › Data & reset › Storage: what the app's data takes on the device,
 * and a button that gives back the space deleted rows leave behind. See
 * `utils/storageReport.ts` for why those are two different figures.
 */
export function StorageSettings() {
  const demoActive = useDemoStore(s => s.active);
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const [stats, setStats] = useState<StorageStats | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setStats(readStats()), []);

  // Read after the first paint: the per-table sizes walk every page.
  useEffect(() => {
    if (demoActive) { setStats(null); return; }
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [demoActive, refresh]);

  const blocked = stats ? optimizeBlockedReason(stats, availableDiskBytes()) : null;
  const canOptimize = !demoActive && !!stats && !busy && worthOptimizing(stats) && !blocked;

  const onOptimize = async () => {
    if (!canOptimize) return;
    setBusy(true);
    // Let the spinner paint: the rewrite holds the JS thread until it finishes.
    await new Promise(resolve => setTimeout(resolve, 50));
    try {
      const { before, after } = dbOptimizeStorage();
      refresh();
      Alert.alert('Storage compacted', `The database went from ${formatBytes(before)} to ${formatBytes(after)}.`);
    } catch (e) {
      Alert.alert('Couldn’t compact storage', e instanceof Error ? e.message : 'The database couldn’t be rewritten. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const unavailable = 'Unavailable while demo mode is on';
  const total = stats ? stats.databaseBytes + stats.photoBytes : null;

  let compactHint: string;
  if (demoActive) compactHint = unavailable;
  else if (!stats) compactHint = 'Calculating';
  else if (!worthOptimizing(stats)) compactHint = 'Nothing to give back right now';
  else if (blocked) compactHint = blocked;
  else compactHint = `Gives back ${formatBytes(stats.freeBytes)} of space left by deleted data`;

  return (
    <SettingsSection
      label="Storage"
      footer="Deleting data frees space inside the database file but doesn’t make the file smaller. Compacting rewrites it, takes a few seconds and needs free space on your phone about the size of your data. Nothing is deleted."
    >
      <SettingsRow
        entryId="storageUsage"
        icon="server-outline"
        label="Storage used"
        hint={demoActive ? unavailable : stats ? describeAreas(stats.tables) || 'Tasks, recipes and everything else you’ve saved' : undefined}
        alwaysShowHint
        value={total != null ? formatBytes(total) : undefined}
      />
      <View style={styles.sep} />
      <SettingsRow
        entryId="storagePhotos"
        icon="image-outline"
        label="Recipe photos"
        hint="Saved on this device, outside the database"
        value={stats ? formatBytes(stats.photoBytes) : undefined}
      />
      <View style={styles.sep} />
      <SettingsRow
        entryId="optimizeStorage"
        icon="contract-outline"
        iconColor={canOptimize ? colors.accent : colors.textTertiary}
        label="Compact the database"
        labelColor={canOptimize ? undefined : colors.textTertiary}
        hint={compactHint}
        alwaysShowHint
        busy={busy}
        onPress={onOptimize}
        disabled={!canOptimize}
      />
    </SettingsSection>
  );
}
