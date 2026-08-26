import React, { useState, useMemo } from 'react';
import { View, Alert } from 'react-native';
import Constants from 'expo-constants';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useDemoStore } from '../../store/useDemoStore';
import { dbExportTables, dbReplaceAllData, dbSetRecipeImagePath } from '../../db/database';
import { confirmDelete } from '../../utils/confirmDelete';
import {
  buildBackup, serializeBackup, parseBackup, summarizeBackup, backupFileName, type Backup,
} from '../../utils/backup';
import {
  writeBackupFile, shareBackupFile, discardBackupFile, pickBackupFile, canShare,
} from '../../utils/backupFile';
import {
  recipeImageBasename, readRecipeImageBase64, writeRecipeImageFile,
} from '../../utils/recipePhoto';
import {
  RETENTION_OPTIONS, retentionCutoff, retentionLabel, selectPurgeableTaskIds, type RetentionDays,
} from '../../utils/retention';
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
function restoreRecipeImages(backup: Backup): void {
  for (const row of backup.tables.recipes ?? []) {
    const id = row.id;
    const path = row.image_path;
    if (typeof id !== 'string' || typeof path !== 'string' || !path) continue;

    const basename = recipeImageBasename(path);
    const base64 = basename ? backup.images[basename] : undefined;
    if (basename && base64) {
      dbSetRecipeImagePath(id, writeRecipeImageFile(basename, base64));
    } else {
      dbSetRecipeImagePath(id, null);
    }
  }
}

/**
 * Restoring rebuilds every table, so both stores have to re-read from scratch
 * afterwards. Tasks first, then settings — settings is what the visibility
 * rules read, so a task list rebuilt against the *old* day reset would be
 * wrong for a frame.
 */
function applyBackup(backup: Backup): void {
  dbReplaceAllData(backup.tables);
  restoreRecipeImages(backup);
  useTaskStore.getState().initialize();
  useSettingsStore.getState().initialize();
}

const RETENTION_SEGMENTS: SegmentOption<RetentionDays>[] =
  RETENTION_OPTIONS.map(o => ({ value: o.value, label: o.label }));

export function DataResetSettings() {
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const completedRetentionDays = useSettingsStore(s => s.completedRetentionDays);
  const setCompletedRetentionDays = useSettingsStore(s => s.setCompletedRetentionDays);
  const resetToDefaults = useSettingsStore(s => s.resetToDefaults);

  const allTasks = useTaskStore(useShallow(s => s.tasks));
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
      uri = writeBackupFile(serializeBackup(backup), backupFileName(now));
      if (!(await canShare())) {
        Alert.alert('Can’t share from this device', `Your backup was written to ${uri}.`);
        uri = null; // left in place — it's the only copy the user has
        return;
      }
      await shareBackupFile(uri);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Something went wrong writing the backup.');
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
        `The backup holds ${summarizeBackup(backup)}. Everything currently in the app (tasks, projects, stacks, templates, categories and settings) is deleted and replaced by it. This can't be undone, so export what you have first if you haven't.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => {
              try {
                applyBackup(backup);
                Alert.alert('Restored', `Your data now matches the backup: ${summarizeBackup(backup)}.`);
              } catch (e) {
                Alert.alert(
                  'Restore failed',
                  `${e instanceof Error ? e.message : 'Something went wrong.'} Nothing was changed. The restore is a single transaction, so your existing data is still there.`
                );
              }
            },
          },
        ]
      );
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : 'Something went wrong reading the file.');
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
    const doomed = cutoff ? selectPurgeableTaskIds(allTasks, cutoff) : [];
    if (doomed.length === 0) {
      setCompletedRetentionDays(days);
      return;
    }
    confirmDelete({
      title: `Delete ${doomed.length} completed task${doomed.length === 1 ? '' : 's'}?`,
      message: `${doomed.length === 1 ? 'One task was' : `${doomed.length} tasks were`} completed more than ${retentionLabel(days).toLowerCase()} ago. They'll be deleted now, along with their Logbook entries and their share of Stats, and every completion that ages past ${retentionLabel(days).toLowerCase()} from here on goes the same way. This can't be undone, so export first if you want to keep them.`,
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
      'Your tasks are hidden and replaced everywhere with a sample list. Nothing of yours is changed or deleted. Turn it off to get it all back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: enterDemoMode },
      ]
    );
  };

  const confirmResetStreaks = () => {
    confirmDelete({
      title: 'Reset All Streaks',
      message: 'This sets every task\'s streak back to 0. You can undo this right after by shaking your phone.',
      confirmLabel: 'Reset',
      onConfirm: () => resetAllStreaks(),
    });
  };

  const confirmResetToDefaults = () => {
    confirmDelete({
      title: 'Reset Settings to Defaults',
      // It also clears remindersImportEnabled, which no version of this copy
      // used to mention — so a reset quietly stopped Siri capture from working.
      message: 'This resets appearance, day and time, haptics, the daily agenda and the tasks and projects toggles back to their defaults, and turns off importing from Apple Reminders. Your tasks, API key, app lock, and vacation mode are not affected.',
      confirmLabel: 'Reset',
      onConfirm: () => resetToDefaults(),
    });
  };

  return (
    <>
      <SettingsSection
        label="Backup"
        footer="Everything lives on this device and nowhere else, so a backup is the only copy that survives losing the phone. The file holds your tasks, projects, stacks, templates, categories and settings, but never your API key, since a backup is a file you send places. Restoring replaces what's in the app rather than merging into it."
      >
        <SettingsRow
          icon="download-outline"
          iconColor={demoActive ? colors.textTertiary : colors.accent}
          label="Export all data"
          labelColor={demoActive ? colors.textTertiary : undefined}
          hint={demoActive
            ? 'Unavailable while demo mode is on'
            : 'Saves everything to a JSON file you can send anywhere'}
          busy={backupBusy === 'export'}
          onPress={onExport}
          disabled={demoActive || backupBusy !== null}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="cloud-upload-outline"
          iconColor={demoActive ? colors.textTertiary : colors.red}
          label="Restore from a backup"
          labelColor={demoActive ? colors.textTertiary : colors.red}
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
        footer="A task you repeat daily leaves a completed copy behind every time, and by default those are kept forever. A window trims them permanently, along with their Logbook entries and their share of Stats, so export before shortening one. Streaks aren't affected: a streak count lives on the task still running it. Archived tasks are never touched."
      >
        <SettingsRow
          icon="book-outline"
          iconColor={completedRetentionDays === null ? undefined : colors.accent}
          label="Keep completed tasks for"
          hint={completedRetentionDays === null
            ? 'Forever. Nothing is ever deleted on its own'
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
        footer="Every screen (Today, Search, Projects, Stats) switches to a sample list you can edit freely. Nothing you do while it's on touches your real tasks, and turning it off discards the sample list and brings yours back."
      >
        <SettingsRow
          icon={demoActive ? 'flask' : 'flask-outline'}
          iconColor={demoActive ? colors.accent : undefined}
          label="Demo mode"
          hint={demoActive
            ? 'You are looking at sample data; your own tasks are hidden'
            : 'Swap your whole list for sample data, so you can show the app to someone'}
          toggle={demoActive}
          onPress={onToggleDemo}
        />
      </SettingsSection>

      <SettingsSection
        label="Reset"
        footer="Both ask for confirmation first. Resetting streaks can be undone right after by shaking your phone; resetting settings leaves your tasks, API key, app lock and vacation mode alone."
      >
        <SettingsRow
          icon="refresh-outline"
          iconColor={colors.red}
          label="Reset all streaks"
          labelColor={colors.red}
          hint="Sets every task's streak count back to 0"
          onPress={confirmResetStreaks}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="refresh-circle-outline"
          iconColor={colors.red}
          label="Reset to defaults"
          labelColor={colors.red}
          hint="Puts every setting in the app back to its default"
          onPress={confirmResetToDefaults}
          accessibilityLabel="Reset settings to defaults"
        />
      </SettingsSection>
    </>
  );
}
