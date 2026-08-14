import React, { useState, useMemo } from 'react';
import { View, Alert, AppState, Linking } from 'react-native';
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
import { findReminderList, reminderListOptions } from '../../utils/remindersImport';
import type { Calendar as ReminderList } from 'expo-calendar';
import { useColors } from '../../theme/ThemeContext';
import { animateLayout } from '../../utils/layoutAnimation';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { SettingsChoiceTray } from './SettingsChoiceTray';
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
  const remindersImportReview = useSettingsStore(s => s.remindersImportReview);
  const setRemindersImportReview = useSettingsStore(s => s.setRemindersImportReview);
  const remindersImportDelete = useSettingsStore(s => s.remindersImportDelete);
  const setRemindersImportDelete = useSettingsStore(s => s.setRemindersImportDelete);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const groceryImportEnabled = useSettingsStore(s => s.groceryImportEnabled);
  const setGroceryImportEnabled = useSettingsStore(s => s.setGroceryImportEnabled);
  const groceryImportListId = useSettingsStore(s => s.groceryImportListId);
  const setGroceryImportListId = useSettingsStore(s => s.setGroceryImportListId);
  const setGroceryImportConfirmedListId = useSettingsStore(s => s.setGroceryImportConfirmedListId);
  const groceryImportDelete = useSettingsStore(s => s.groceryImportDelete);
  const setGroceryImportDelete = useSettingsStore(s => s.setGroceryImportDelete);

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
  const [groceryPickerOpen, setGroceryPickerOpen] = useState(false);
  // The choices unfold below the row rather than in a sheet, so the motion is
  // what tells you where they went — without it the tray simply appears, three
  // rows down, and reads as content that was always there.
  const togglePicker = (set: (open: boolean) => void, open: boolean) => {
    animateLayout();
    set(!open);
  };
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const selectedReminderList = findReminderList(reminderLists ?? [], remindersImportListId);
  const selectedGroceryList = findReminderList(reminderLists ?? [], groceryImportListId);
  // The two destinations must be disjoint: handledIds is global, so a list
  // wired to both would send each reminder to whichever drain reached it
  // first — a coin toss between the Inbox and the grocery list.
  const taskListChoices = reminderListOptions(reminderLists ?? [], groceryImportListId);
  const groceryListChoices = reminderListOptions(reminderLists ?? [], remindersImportListId);
  const lastImport = lastImportOutcome();

  // The list row is also shown while its picker is open with the import still
  // off — that's the first-enable sequence, where choosing a list comes
  // *before* the switch flips (nothing turns on until the confirmation is
  // accepted).
  const showListRow =
    remindersPermission === 'granted' && (remindersImportEnabled || listPickerOpen);
  const showGroceryListRow =
    remindersPermission === 'granted' && (groceryImportEnabled || groceryPickerOpen);

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
    animateLayout();
    setListPickerOpen(false);
    // 'task' so the count already excludes anything the drain would skip on a
    // name it recognises — otherwise the one alert that has to be exact
    // over-promises the moment deletion is off.
    const count = await countImportableReminders(list.id, 'task');
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
    // Nothing is destroyed with deletion off, so the alert stops being a
    // warning and the buttons stop being destructive — dressing a copy up as a
    // deletion is how a real one stops being read.
    const body = remindersImportDelete
      ? count === 0
        ? 'Anything you add to this list will be added to your Inbox and then deleted from the Reminders app. The title and notes come across; any date, repeat or alarm waits on the task for you to accept.'
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to your Inbox and deleted from the Reminders app, along with anything you add later. The title and notes come across, and any date, repeat or alarm waits on the task in your Inbox until you accept it. Completed reminders are left alone.`
      : count === 0
        ? 'Anything you add to this list will be added to your Inbox and left where it is in the Reminders app. Anything whose name already matches a task is skipped, so nothing comes in twice.'
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to your Inbox, along with anything you add later. Nothing is removed from the Reminders app, and anything whose name already matches a task is skipped so it can’t come in twice. Completed reminders are left alone.`;
    Alert.alert(
      count === 0
        ? `Import from “${list.title}”?`
        : `Import ${count} reminder${count === 1 ? '' : 's'} from “${list.title}”?`,
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: remindersImportDelete ? 'destructive' : 'default',
          onPress: enable,
        },
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
    animateLayout();
    setListPickerOpen(true);
  };

  /**
   * Same gate as confirmList, aimed at the grocery list. Kept as its own
   * function rather than parameterised: the copy is what makes the alert a
   * real decision, and "added to your Inbox" versus "added to your grocery
   * list" is the whole difference.
   */
  const confirmGroceryList = async (list: ReminderList) => {
    animateLayout();
    setGroceryPickerOpen(false);
    const count = await countImportableReminders(list.id, 'grocery');
    if (count === null) {
      Alert.alert('Couldn’t read that list', 'Try again in a moment, or pick a different list.');
      return;
    }
    const enable = () => {
      setGroceryImportListId(list.id);
      setGroceryImportConfirmedListId(list.id);
      setGroceryImportEnabled(true);
      setImportResult(null);
    };
    const body = groceryImportDelete
      ? count === 0
        ? 'Anything you add to this list will be added to your grocery list and then deleted from the Reminders app. Only the title comes across.'
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to your grocery list and deleted from the Reminders app, along with anything you add later. Only the title comes across. Completed reminders are left alone.`
      : count === 0
        ? 'Anything you add to this list will be added to your grocery list and left where it is in the Reminders app. A name your grocery list already knows is skipped, so nothing comes in twice.'
        : `The ${count} thing${count === 1 ? '' : 's'} already in this list will be added to your grocery list, along with anything you add later. Nothing is removed from the Reminders app, and a name your grocery list already knows is skipped so it can’t come in twice. Completed reminders are left alone.`;
    Alert.alert(
      count === 0
        ? `Send “${list.title}” to groceries?`
        : `Send ${count} reminder${count === 1 ? '' : 's'} from “${list.title}” to groceries?`,
      body,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          style: groceryImportDelete ? 'destructive' : 'default',
          onPress: enable,
        },
      ]
    );
  };

  const onToggleGroceryImport = async () => {
    if (groceryImportEnabled) {
      setGroceryImportEnabled(false);
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
    if (reminderListOptions(lists, remindersImportListId).length === 0) {
      Alert.alert(
        'No lists to import from',
        remindersImportListId
          ? 'The only list available is already being imported into your Inbox. A list can only feed one of the two.'
          : 'There are no Reminders lists on this device that can be changed from here.'
      );
      return;
    }
    animateLayout();
    setGroceryPickerOpen(true);
  };

  const onImportNow = async () => {
    if (importBusy) return;
    setImportBusy(true);
    setImportResult(null);
    try {
      const outcome = await importReminders();
      // The skipped count is worth saying out loud: with deletion off it's the
      // difference between "there was nothing new" and "there were things, and
      // you already have all of them" — which look identical otherwise.
      const skipped = outcome.skipped > 0 ? ` · ${outcome.skipped} already here` : '';
      setImportResult(
        outcome.imported > 0
          ? `Imported ${outcome.imported}${skipped}`
          : outcome.skipped > 0
            ? `Nothing new — ${outcome.skipped} already here`
            : 'Nothing new'
      );
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <SettingsSection
      label="Apple Reminders"
      footer="Say “Hey Siri, remind me to…” and it lands here. Siri adds to whichever list is set as Default in Settings › Apps › Reminders, so point that at the list above. The title and notes come across as the task; a due date, repeat or alarm is read too, but it waits on the task in your Inbox until you accept it, so nothing schedules itself before you’ve seen it. Each reminder is deleted from the list once its task exists. Turn that off and they stay put, and anything whose name you already have is skipped instead. Completed reminders are left alone either way."
    >
      <SettingsRow
        icon="arrow-down-circle-outline"
        iconColor={remindersImportEnabled ? colors.accent : undefined}
        label="Import from Reminders"
        hint={remindersImportEnabled
          ? selectedReminderList
            ? remindersImportDelete
              ? `Anything in “${selectedReminderList.title}” is added to your Inbox and removed from the Reminders app`
              : `Anything in “${selectedReminderList.title}” is added to your Inbox and left in the Reminders app`
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
              remindersPermission === 'granted' ? 'Allowed. This app can read and remove reminders in the list below'
              : remindersPermission === 'denied' ? 'Blocked. Nothing can be imported until you turn it back on for this app.'
              : remindersPermission === 'undetermined' ? 'Not enabled yet. Nothing can be imported until you allow it'
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
            hint={selectedReminderList || remindersImportListId ? undefined : 'Which Reminders list to take from'}
            value={selectedReminderList?.title ?? (remindersImportListId ? 'Unavailable' : undefined)}
            expanded={listPickerOpen}
            onPress={() => togglePicker(setListPickerOpen, listPickerOpen)}
            accessibilityLabel="Choose the list to import from"
          />
          {listPickerOpen && (
            <SettingsChoiceTray
              caption="Import from"
              options={taskListChoices}
              selectedId={remindersImportListId}
              onSelect={confirmList}
              emptyText={groceryImportListId
                ? 'Every list you can change is already going to your grocery list. A list can only feed one of the two.'
                : 'There are no Reminders lists on this device that can be changed from here.'}
              accessibilityLabelFor={list => `Import from ${list.title}`}
            />
          )}
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

      {remindersImportEnabled && remindersPermission === 'granted' && selectedReminderList && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="checkmark-circle-outline"
            iconColor={remindersImportReview ? colors.accent : undefined}
            label="Review before applying"
            hint={remindersImportReview
              ? 'A reminder’s date, repeat and alarm wait on the task in your Inbox until you accept them'
              : 'They’re applied on import, so a dated reminder goes straight to Today or Later'}
            toggle={remindersImportReview}
            onPress={() => setRemindersImportReview(!remindersImportReview)}
            accessibilityLabel="Review a reminder's date and repeat before applying them"
          />
          <View style={styles.sep} />
          <SettingsRow
            icon={remindersImportDelete ? 'trash-outline' : 'archive-outline'}
            iconColor={remindersImportDelete ? colors.accent : undefined}
            label="Delete after importing"
            hint={remindersImportDelete
              ? `Each reminder is removed from “${selectedReminderList.title}” once its task exists`
              : 'Reminders stay in the list. One whose name already matches a task (a finished one counts) is skipped instead, so nothing is imported twice.'}
            toggle={remindersImportDelete}
            onPress={() => setRemindersImportDelete(!remindersImportDelete)}
            accessibilityLabel="Delete each reminder from the Reminders app after importing it"
          />
        </>
      )}

      {/* The grocery leg of the import, gated as one block: without the
          groceries area there's nowhere for these reminders to land. The
          setting and the chosen list are left as they are — turning the area
          back on resumes the import that was already configured. */}
      {kitchenEnabled && (
      <>
      <View style={styles.sep} />
      <SettingsRow
        icon="cart-outline"
        iconColor={groceryImportEnabled ? colors.accent : undefined}
        label="Send a list to Groceries"
        hint={groceryImportEnabled
          ? groceryImportDelete
            ? 'Reminders in this list become grocery items instead of tasks.'
            : 'Reminders in this list become grocery items instead of tasks, and stay where they are.'
          : 'Point a second list at your grocery list, so “add milk to my Groceries list” lands there.'}
        toggle={groceryImportEnabled}
        onPress={onToggleGroceryImport}
      />

      {showGroceryListRow && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="list-outline"
            iconColor={colors.accent}
            label="Grocery list"
            hint={selectedGroceryList || groceryImportListId ? undefined : 'Which Reminders list becomes groceries'}
            value={selectedGroceryList?.title ?? (groceryImportListId ? 'Unavailable' : undefined)}
            expanded={groceryPickerOpen}
            onPress={() => togglePicker(setGroceryPickerOpen, groceryPickerOpen)}
            accessibilityLabel="Choose the list to import into groceries"
          />
          {groceryPickerOpen && (
            <SettingsChoiceTray
              caption="Send to groceries"
              options={groceryListChoices}
              selectedId={groceryImportListId}
              onSelect={confirmGroceryList}
              emptyText={remindersImportListId
                ? 'The only list available is already being imported into your Inbox. A list can only feed one of the two.'
                : 'There are no Reminders lists on this device that can be changed from here.'}
              accessibilityLabelFor={list => `Send ${list.title} to groceries`}
            />
          )}
        </>
      )}

      {groceryImportEnabled && remindersPermission === 'granted' && selectedGroceryList && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon={groceryImportDelete ? 'trash-outline' : 'archive-outline'}
            iconColor={groceryImportDelete ? colors.accent : undefined}
            label="Delete after adding to Groceries"
            hint={groceryImportDelete
              ? `Each reminder is removed from “${selectedGroceryList.title}” once it’s on your grocery list`
              : 'Reminders stay in the list. A name your grocery list already knows is skipped instead, so nothing is added twice.'}
            toggle={groceryImportDelete}
            onPress={() => setGroceryImportDelete(!groceryImportDelete)}
            accessibilityLabel="Delete each reminder from the Reminders app after adding it to groceries"
          />
        </>
      )}

      {groceryImportEnabled && remindersPermission === 'granted' && reminderLists !== null
        && groceryImportListId !== null && !selectedGroceryList && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="alert-circle-outline"
            iconColor={colors.warning}
            label="That grocery list isn’t on this device"
            hint="Nothing is being imported into groceries. Pick another list above, or turn this off."
          />
        </>
      )}
      </>
      )}

      {/* There's no change notification to subscribe to, so a reminder
          that syncs in from a Mac or Watch while the app is already
          open has nothing to wake the import. */}
      {remindersPermission === 'granted'
        && ((remindersImportEnabled && selectedReminderList) || (groceryImportEnabled && selectedGroceryList)) && (
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
