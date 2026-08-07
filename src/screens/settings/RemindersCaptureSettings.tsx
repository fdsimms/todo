import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, Alert, AppState, Linking } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  countImportableReminders,
  getRemindersPermission,
  importReminders,
  lastImportOutcome,
  listReminderLists,
  requestRemindersPermission,
  type RemindersPermission,
} from '../../utils/remindersImportSync';
import { findReminderList } from '../../utils/remindersImport';
import type { Calendar as ReminderList } from 'expo-calendar';
import { useColors } from '../../theme/ThemeContext';
import { interaction } from '../../theme';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * Apple Reminders import — labelled in full throughout, because "reminders"
 * already means the per-task notification in the Notifications group.
 *
 * This is the one feature that destroys data the user owns in another app, so
 * the safety rules here are load-bearing rather than ceremony: create the task
 * then delete the reminder, never the reverse; a list is only offered if it
 * allows modification; and nothing runs until an alert naming the list and the
 * exact count has been accepted, keyed on the list id so switching lists asks
 * again. See `remindersImportSync.ts` for the rest.
 */
export function RemindersCaptureSettings() {
  const remindersImportEnabled = useSettingsStore(s => s.remindersImportEnabled);
  const setRemindersImportEnabled = useSettingsStore(s => s.setRemindersImportEnabled);
  const remindersImportListId = useSettingsStore(s => s.remindersImportListId);
  const setRemindersImportListId = useSettingsStore(s => s.setRemindersImportListId);
  const setRemindersImportConfirmedListId = useSettingsStore(s => s.setRemindersImportConfirmedListId);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  // Re-read on focus *and* on foreground: the permission row sends people to
  // the system Settings app, which doesn't unfocus this screen, and the set of
  // Reminders lists can change while they're over there too.
  const [remindersPermission, setRemindersPermission] = useState<RemindersPermission | null>(null);
  const [reminderLists, setReminderLists] = useState<ReminderList[] | null>(null);
  const refreshRemindersState = React.useCallback(() => {
    getRemindersPermission()
      .then(async permission => {
        setRemindersPermission(permission);
        setReminderLists(permission === 'granted' ? await listReminderLists() : null);
      })
      .catch(() => setRemindersPermission(null));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      refreshRemindersState();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') refreshRemindersState();
      });
      return () => sub.remove();
    }, [refreshRemindersState])
  );

  const [listPickerOpen, setListPickerOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const selectedReminderList = findReminderList(reminderLists ?? [], remindersImportListId);
  const lastImport = lastImportOutcome();

  // The list row is also shown while its picker is open with the import still
  // off — that's the first-enable sequence, where choosing a list comes
  // *before* the switch flips (nothing turns on until the confirmation is
  // accepted).
  const showListRow =
    remindersPermission === 'granted' && (remindersImportEnabled || listPickerOpen);

  /**
   * The gate in front of everything destructive. Naming the count *and* the
   * list is what makes it a real decision rather than a dialog to dismiss —
   * and it's raised here, at the tap, never from the drain, which can run on a
   * cold launch with no screen mounted to answer it.
   *
   * Keyed on the list id, so switching list asks again instead of quietly
   * swallowing whatever has piled up in the new one.
   */
  const confirmList = async (list: ReminderList) => {
    setListPickerOpen(false);
    const count = await countImportableReminders(list.id);
    if (count === null) {
      Alert.alert('Couldn’t read that list', 'Try again in a moment, or pick a different list.');
      return;
    }
    const enable = () => {
      setRemindersImportListId(list.id);
      setRemindersImportConfirmedListId(list.id);
      setRemindersImportEnabled(true);
      setImportResult(null);
    };
    Alert.alert(
      count === 0
        ? `Import from “${list.title}”?`
        : `Import ${count} reminder${count === 1 ? '' : 's'} from “${list.title}”?`,
      count === 0
        ? 'Anything you add to this list will be added to your Inbox and then deleted from the Reminders app. Only the title comes across.'
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to your Inbox and deleted from the Reminders app, along with anything you add later. Only the title comes across — dates, notes and alarms are dropped. Completed reminders are left alone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import', style: 'destructive', onPress: enable },
      ]
    );
  };

  /**
   * Turning it on never flips the switch by itself — permission first, then a
   * list, then the confirmation, and only its Import button enables anything.
   * Turning it off is immediate: stopping a destructive thing needs no gate.
   */
  const onToggleRemindersImport = async () => {
    if (remindersImportEnabled) {
      setRemindersImportEnabled(false);
      return;
    }
    if (remindersPermission === 'denied') {
      Linking.openSettings();
      return;
    }
    if (remindersPermission !== 'granted' && !(await requestRemindersPermission())) {
      refreshRemindersState();
      Alert.alert(
        'Reminders access is off',
        'Importing needs permission to read and delete reminders. Turn it on for this app in the Settings app, then try again.'
      );
      return;
    }
    refreshRemindersState();
    const lists = await listReminderLists();
    setReminderLists(lists);
    if (lists.length === 0) {
      Alert.alert(
        'No lists to import from',
        'There are no Reminders lists on this device that can be changed from here.'
      );
      return;
    }
    // No API tells us which list Siri writes to, and probing for it would mean
    // creating a reminder in someone's Reminders app just to look — so picking
    // is the first step rather than a correction to a guess.
    setListPickerOpen(true);
  };

  const onImportNow = async () => {
    if (importBusy) return;
    setImportBusy(true);
    setImportResult(null);
    try {
      const outcome = await importReminders();
      setImportResult(outcome.imported > 0 ? `Imported ${outcome.imported}` : 'Nothing new');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <SettingsSection
      label="Apple Reminders"
      footer="Say “Hey Siri, remind me to…” and it lands here. Siri adds to whichever list is set as Default in Settings › Apps › Reminders, so point that at the list above. Only the title comes across — dates, notes and alarms are dropped, so everything waits in your Inbox until you file it. Each reminder is deleted from the list once its task exists, and completed reminders are left alone."
    >
      <SettingsRow
        icon="arrow-down-circle-outline"
        iconColor={remindersImportEnabled ? colors.accent : undefined}
        label="Import from Reminders"
        hint={remindersImportEnabled
          ? selectedReminderList
            ? `Anything in “${selectedReminderList.title}” is added to your Inbox and removed from the Reminders app`
            : 'The list it was importing from is no longer available'
          : 'Nothing is read from the Reminders app'}
        toggle={remindersImportEnabled}
        onPress={onToggleRemindersImport}
        accessibilityLabel="Import from the Reminders app"
      />

      {/* Denied stays visible even with the import off — that's the
          state where the switch above looks broken. */}
      {(remindersImportEnabled || remindersPermission === 'denied') && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon={remindersPermission === 'granted' ? 'lock-open-outline' : 'lock-closed-outline'}
            iconColor={
              remindersPermission === 'granted' ? colors.accent
              : remindersPermission === 'denied' ? colors.warning
              : undefined
            }
            label="Reminders access"
            hint={
              remindersPermission === 'granted' ? 'Allowed — this app can read and remove reminders in the list below'
              : remindersPermission === 'denied' ? 'Blocked. Nothing can be imported until you turn it back on for this app.'
              : remindersPermission === 'undetermined' ? 'Not enabled yet — nothing can be imported until you allow it'
              : remindersPermission === 'unsupported' ? 'Not available on this platform'
              : 'Checking…'
            }
            value={
              remindersPermission === 'denied' ? 'Open Settings'
              : remindersPermission === 'undetermined' ? 'Allow'
              : undefined
            }
            onPress={
              remindersPermission === 'denied' ? () => Linking.openSettings()
              : remindersPermission === 'undetermined' ? async () => {
                  await requestRemindersPermission();
                  refreshRemindersState();
                }
              : undefined
            }
            accessibilityLabel={
              remindersPermission === 'granted' ? 'Reminders access is allowed'
              : remindersPermission === 'denied' ? 'Reminders access is blocked. Opens the system Settings app.'
              : remindersPermission === 'undetermined' ? 'Reminders access not enabled yet. Double tap to allow.'
              : 'Reminders access'
            }
          />
        </>
      )}

      {showListRow && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="list-outline"
            iconColor={colors.accent}
            label="List"
            value={selectedReminderList?.title ?? (remindersImportListId ? 'Unavailable' : 'Choose')}
            onPress={() => setListPickerOpen(!listPickerOpen)}
            accessibilityLabel="Choose the list to import from"
          />
          {listPickerOpen && (reminderLists ?? []).map(list => {
            const selected = list.id === remindersImportListId;
            return (
              <React.Fragment key={list.id}>
                <View style={styles.sep} />
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => confirmList(list)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Import from ${list.title}`}
                >
                  <View style={styles.rowContent}>
                    <Text style={styles.rowLabel}>{list.title}</Text>
                  </View>
                  {selected && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </>
      )}

      {/* Only worth saying once they're actually biting — each of
          these is a way the import stops without any other symptom. */}
      {remindersImportEnabled && remindersPermission === 'granted' && reminderLists !== null
        && remindersImportListId !== null && !selectedReminderList && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.warning}
            label="That list isn’t on this device"
            hint="Nothing is being imported. Pick another list above, or turn this off."
          />
        </>
      )}

      {remindersImportEnabled && (lastImport?.deleteFailed ?? 0) > 0 && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.warning}
            label={`${lastImport!.deleteFailed} reminder${lastImport!.deleteFailed === 1 ? '' : 's'} couldn’t be removed`}
            hint={`${lastImport!.deleteFailed === 1 ? 'Its task is' : 'Their tasks are'} in your Inbox and${lastImport!.deleteFailed === 1 ? ' it is' : ' they are'} skipped for now. Delete${lastImport!.deleteFailed === 1 ? ' it' : ' them'} in the Reminders app so nothing comes back next time.`}
          />
        </>
      )}

      {/* There's no change notification to subscribe to, so a reminder
          that syncs in from a Mac or Watch while the app is already
          open has nothing to wake the import. */}
      {remindersImportEnabled && remindersPermission === 'granted' && selectedReminderList && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="refresh-outline"
            iconColor={colors.accent}
            label="Import now"
            hint={importResult ?? undefined}
            busy={importBusy}
            onPress={onImportNow}
            disabled={importBusy}
            accessibilityLabel="Import waiting reminders now"
          />
        </>
      )}
    </SettingsSection>
  );
}
