import React, { useState, useMemo } from 'react';
import { View, Alert } from 'react-native';
import Constants from 'expo-constants';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useProjectStore } from '../../store/useProjectStore';
import { useTaskStore } from '../../store/useTaskStore';
import { clearUndoHistories, useDemoStore } from '../../store/useDemoStore';
import { useSharedLinkStore } from '../../store/useSharedLinkStore';
import { useStepTimerStore } from '../../store/useStepTimerStore';
import { dbExportTables, dbReplaceAllData, dbSetRecipeImagePath } from '../../db/database';
import { confirmDelete } from '../../utils/confirmDelete';
import {
  buildBackup, serializeBackup, parseBackup, summarizeBackup, backupFileName, type Backup,
} from '../../utils/backup';
import {
  writeExportFile, shareBackupFile, discardBackupFile, pickBackupFile, canShare,
} from '../../utils/backupFile';
import {
  recipeImageBasename, readRecipeImageBase64, writeRecipeImageFile,
} from '../../utils/recipePhoto';
import {
  RETENTION_OPTIONS, retentionCutoff, retentionDeletionSummary, retentionLabel,
  selectPurgeableFocusSessionIds, selectPurgeableTaskIds, type RetentionDays,
} from '../../utils/retention';
import { useFocusStore } from '../../store/useFocusStore';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { type SegmentOption } from '../../components/SegmentedControl';
import { makeSettingsStyles } from './settingsStyles';

/**
 * Recipe photos are the one thing in a backup that isn't a table row (see the
 * note at the top of backup.ts): `dbReplaceAllData` has already written every
 * recipe's `image_path` back exactly as the backup held it, which is the
 * *origin* device's path and generally not a file that exists here. This
 * writes each embedded photo into this device's own recipe-images directory
 * and repoints the row at that — clearing it instead when the backup has no
 * matching bytes (an older backup taken before this shipped, or a photo that
 * failed to read at export time), so a dangling path doesn't linger as a
 * permanently blank image.
 */
function restoreRecipeImages(backup: Backup): number {
  let failed = 0;
  for (const row of backup.tables.recipes ?? []) {
    const id = row.id;
    const path = row.image_path;
    if (typeof id !== 'string' || typeof path !== 'string' || !path) continue;

    const basename = recipeImageBasename(path);
    const base64 = basename ? backup.images[basename] : undefined;
    if (basename && base64) {
      // One photo failing to write (a full disk, an odd file name) costs that
      // photo, not the rest of them, and not the store refresh after this loop.
      try {
        dbSetRecipeImagePath(id, writeRecipeImageFile(basename, base64));
      } catch {
        dbSetRecipeImagePath(id, null);
        failed++;
      }
    } else {
      dbSetRecipeImagePath(id, null);
    }
  }
  return failed;
}

/**
 * Restoring rebuilds every table, so both stores have to re-read from scratch
 * afterwards. Tasks first, then settings — settings is what the visibility
 * rules read, so a task list rebuilt against the *old* day reset would be
 * wrong for a frame.
 */
function applyBackup(backup: Backup): number {
  // Only this line can fail with nothing changed: it is one transaction. Past
  // it the data is already replaced, so the stores are re-read whatever the
  // photos do. Left holding the old data, their next writes would put
  // pre-restore rows back over the restored ones.
  dbReplaceAllData(backup.tables);
  try {
    return restoreRecipeImages(backup);
  } finally {
    useTaskStore.getState().initialize();
    useSettingsStore.getState().initialize();
    // The rest of what leaving demo mode resets, for the same reason: a
    // restore swaps every row out from under the stores just as that does.
    // The two queues re-read the restored database, and every undo history
    // goes, because an undo writes its row snapshots back by id, and those
    // rows belong to the data that was just replaced. Kept, a shake after
    // restoring put pre-restore rows into the restored data.
    useSharedLinkStore.getState().reload();
    useStepTimerStore.getState().reload();
    clearUndoHistories();
  }
}

const RETENTION_SEGMENTS: SegmentOption<RetentionDays>[] =
  RETENTION_OPTIONS.map(o => ({ value: o.value, label: o.label }));

export function DataResetSettings() {
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const completedRetentionDays = useSettingsStore(s => s.completedRetentionDays);
  const setCompletedRetentionDays = useSettingsStore(s => s.setCompletedRetentionDays);
  const resetToDefaults = useSettingsStore(s => s.resetToDefaults);

  const allTasks = useTaskStore(useShallow(s => s.tasks));
  const focusHistory = useFocusStore(useShallow(s => s.history));
  const purgeOldCompletedTasks = useTaskStore(s => s.purgeOldCompletedTasks);
  const resetAllStreaks = useTaskStore(s => s.resetAllStreaks);

  const demoActive = useDemoStore(s => s.active);
  const enterDemoMode = useDemoStore(s => s.enterDemoMode);
  const exitDemoMode = useDemoStore(s => s.exitDemoMode);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  // Guards both backup rows against a second tap while the first is still
  // going. Export walks every table and restore rewrites them, and neither is
  // safe to have two of in flight.
  const [backupBusy, setBackupBusy] = useState<'export' | 'restore' | null>(null);

  const onExport = async () => {
    if (backupBusy) return;
    setBackupBusy('export');
    let uri: string | null = null;
    try {
      const now = new Date();
      const tables = dbExportTables();
      const images: Record<string, string> = {};
      for (const row of tables.recipes ?? []) {
        const path = row.image_path;
        if (typeof path !== 'string' || !path) continue;
        const basename = recipeImageBasename(path);
        const base64 = basename ? readRecipeImageBase64(path) : null;
        if (basename && base64) images[basename] = base64;
      }
      const backup = buildBackup(tables, {
        appVersion: Constants.expoConfig?.version || '1.0.0',
        exportedAt: now,
        images,
      });
      uri = writeExportFile(serializeBackup(backup), backupFileName(now));
      if (!(await canShare())) {
        Alert.alert('Can’t share from this device', `Your backup was written to ${uri}.`);
        uri = null; // left in place — it's the only copy the user has
        return;
      }
      await shareBackupFile(uri);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Couldn’t write the backup. Try again.');
    } finally {
      // The share sheet has already copied the file wherever it was going, so
      // the cache copy is done either way.
      if (uri) discardBackupFile(uri);
      setBackupBusy(null);
    }
  };

  const onRestore = async () => {
    if (backupBusy) return;
    setBackupBusy('restore');
    try {
      const text = await pickBackupFile();
      if (text == null) return; // user backed out of the picker

      const result = parseBackup(text);
      if (!result.ok) {
        Alert.alert('That backup can’t be read', result.error);
        return;
      }

      const backup = result.backup;
      Alert.alert(
        'Replace everything with this backup?',
        `The backup holds ${summarizeBackup(backup)}. Everything currently in the app (tasks, projects, groceries, recipes, the meal plan, the food and mood logs, people and settings) is deleted and replaced with it. Meals already written to Apple Health and events added to your calendar stay. This can’t be undone, so export your current data first.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => {
              try {
                const photosLost = applyBackup(backup);
                const photoNote = photosLost === 0
                  ? ''
                  : ` ${photosLost} recipe ${photosLost === 1 ? 'photo' : 'photos'} couldn’t be saved and ${photosLost === 1 ? 'was' : 'were'} left off.`;
                Alert.alert('Restored', `Your data now matches the backup: ${summarizeBackup(backup)}.${photoNote}`);
              } catch (e) {
                Alert.alert(
                  'Restore failed',
                  `${e instanceof Error ? e.message : 'Something went wrong.'} Nothing was changed, so your existing data is still there.`
                );
              }
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : 'Couldn’t read the file.');
    } finally {
      setBackupBusy(null);
    }
  };

  /**
   * Picking a retention window applies it to the backlog immediately rather
   * than leaving it to take effect at the next launch — a setting that deletes
   * has to show what it costs at the moment it's chosen, not silently later.
   * So the count comes from the same selection the purge itself runs, and the
   * setting is only written once the user has said yes to that number.
   *
   * Shortening to a window nothing falls outside of, or lengthening one (up to
   * and including Forever), takes nothing and so just saves.
   */
  const onPickRetention = (days: RetentionDays) => {
    if (days === completedRetentionDays) return;
    const cutoff = retentionCutoff(days, new Date(), dayResetTime);
    // The same exemption the purge applies, or the count here would name
    // lines on a list that the purge then keeps.
    const listIds = new Set(useProjectStore.getState().projects.filter(p => p.kind === 'list').map(p => p.id));
    const doomed = cutoff ? selectPurgeableTaskIds(allTasks, cutoff, listIds) : [];
    // Finished focus sessions ride the same window, so they have to be in the
    // count too. The dialog is this feature's whole safety mechanism, and one
    // that named only the tasks would understate what the tap deletes.
    const doomedSessions = cutoff ? selectPurgeableFocusSessionIds(focusHistory, cutoff) : [];
    if (doomed.length === 0 && doomedSessions.length === 0) {
      setCompletedRetentionDays(days);
      return;
    }
    const summary = retentionDeletionSummary(doomed.length, doomedSessions.length);
    const window = retentionLabel(days).toLowerCase();
    confirmDelete({
      title: `Delete ${summary}?`,
      message: `${summary} older than ${window} will be deleted now, along with their Logbook entries and Stats history. Anything that ages past ${window} is deleted the same way from now on. This can’t be undone. Export first to keep them.`,
      onConfirm: () => {
        setCompletedRetentionDays(days);
        purgeOldCompletedTasks();
      },
    });
  };

  const onToggleDemo = () => {
    if (demoActive) {
      exitDemoMode();
      return;
    }
    Alert.alert(
      'Turn on demo mode?',
      'Your tasks are hidden and replaced with a sample list. Nothing is changed or deleted. Turn demo mode off to bring them back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: enterDemoMode },
      ]
    );
  };

  const confirmResetStreaks = () => {
    confirmDelete({
      title: 'Reset all streaks?',
      message: 'This sets every task’s streak back to 0. Shake your phone right after to undo.',
      confirmLabel: 'Reset',
      onConfirm: () => resetAllStreaks(),
    });
  };

  const confirmResetToDefaults = () => {
    confirmDelete({
      title: 'Reset settings to defaults?',
      // It also clears remindersImportEnabled, which no version of this copy
      // used to mention — so a reset quietly stopped Siri capture from working.
      message: 'This resets appearance, day and time, haptics, the daily agenda and the tasks and projects toggles, and turns off importing from Apple Reminders. Your tasks, API key, app lock and vacation mode aren’t affected.',
      confirmLabel: 'Reset',
      onConfirm: () => resetToDefaults(),
    });
  };

  return (
    <>
      <SettingsSection
        label="Backup"
        footer="Your data lives only on this device, so a backup is the only copy if you lose the phone. A backup includes your tasks, projects, groceries, recipes, meal plan, food and mood logs, people and settings, but not your API key."
      >
        <SettingsRow
          entryId="exportBackup"
          icon="download-outline"
          iconColor={demoActive ? colors.textTertiary : colors.accent}
          label="Export all data"
          labelColor={demoActive ? colors.textTertiary : undefined}
          hint={demoActive
            ? 'Unavailable while demo mode is on'
            : 'Saves everything to a JSON file you can share'}
          busy={backupBusy === 'export'}
          onPress={onExport}
          disabled={demoActive || backupBusy !== null}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="restoreBackup"
          icon="cloud-upload-outline"
          iconColor={demoActive ? colors.textTertiary : colors.red}
          label="Restore from a backup"
          labelColor={demoActive ? colors.textTertiary : colors.redText}
          hint={demoActive
            ? 'Unavailable while demo mode is on'
            : 'Replaces everything in the app with a backup file'}
          busy={backupBusy === 'restore'}
          onPress={onRestore}
          disabled={demoActive || backupBusy !== null}
        />
      </SettingsSection>

      {/* History sits directly under Backup, since exporting is the thing that
          makes choosing a window here safe. */}
      <SettingsSection
        label="History"
        footer="Every completed copy of a repeating task is kept forever by default. Choosing a time limit permanently deletes older copies, along with their Logbook entries, their Stats history and older finished focus sessions, so export first. Streaks and archived tasks aren’t affected."
      >
        <SettingsRow
          entryId="retention"
          icon="book-outline"
          iconColor={completedRetentionDays === null ? undefined : colors.accent}
          label="Keep completed tasks for"
          hint={completedRetentionDays === null
            ? 'Forever. Nothing is deleted automatically'
            : `Completions older than ${retentionLabel(completedRetentionDays).toLowerCase()} are deleted at launch`}
          tight
        />
        <SettingsSegments
          attached
          options={RETENTION_SEGMENTS}
          selected={completedRetentionDays}
          onSelect={onPickRetention}
          accessibilityLabelFor={o => `Keep completed tasks for ${o.label}`}
        />
      </SettingsSection>

      <SettingsSection
        label="Demo"
        footer="Every screen shows a sample list you can edit. Your real tasks aren’t touched, and turning demo mode off discards the sample list and brings them back."
      >
        <SettingsRow
          entryId="demoMode"
          icon={demoActive ? 'flask' : 'flask-outline'}
          iconColor={demoActive ? colors.accent : undefined}
          label="Demo mode"
          hint={demoActive
            ? 'Showing sample data. Your own tasks are hidden'
            : 'Replaces your list with sample data so you can show the app to someone'}
          toggle={demoActive}
          onPress={onToggleDemo}
        />
      </SettingsSection>

      <SettingsSection
        label="Reset"
        footer="Both ask for confirmation first. Shake your phone right after resetting streaks to undo it. Resetting settings leaves your tasks, API key, app lock and vacation mode alone."
      >
        <SettingsRow
          entryId="resetStreaks"
          icon="refresh-outline"
          iconColor={colors.red}
          label="Reset all streaks"
          labelColor={colors.redText}
          hint="Sets every task’s streak count back to 0."
          onPress={confirmResetStreaks}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="resetDefaults"
          icon="refresh-circle-outline"
          iconColor={colors.red}
          label="Reset to defaults"
          labelColor={colors.redText}
          hint="Puts every setting in the app back to its default."
          onPress={confirmResetToDefaults}
          accessibilityLabel="Reset settings to defaults"
        />
      </SettingsSection>
    </>
  );
}
