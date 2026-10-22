import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  joinChoiceNeeded,
  useSyncStore,
  type ErasedEvents,
  type SyncDestination,
} from '../../store/useSyncStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useMealPlanStore } from '../../store/useMealPlanStore';
import { reloadAfterDataReplaced } from '../../store/useDemoStore';
import { BUTTON_LABEL } from '../../copy/shared';
import { useColors } from '../../theme/ThemeContext';
import { animateLayout } from '../../utils/layoutAnimation';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { describeLastSynced } from '../../utils/syncStatus';
import { TextField } from '../../components/TextField';
import { AgentNotesRows } from './AgentNotesRows';

/**
 * Turning sync on, and saying honestly what it has done.
 *
 * Two destinations now, and they are independent: iCloud carries device to
 * device, and a payload store the user runs carries to anything that is not an
 * Apple device — which is what a replica of the database needs in order to be a
 * peer (see docs/arch/mcp-server.md). Either, both or neither.
 *
 * The iCloud half renders only when the native module is in the build, so a
 * version without it shows nothing rather than a row that can't work. The
 * server half always renders: nothing native is involved.
 *
 * The status line says **when it last synced**, never "up to date". Sync runs
 * when the app comes to the front and on the background pass — iOS won't let a
 * backgrounded app poll freely — so "up to date" would be a claim the app can't
 * keep. A timestamp is a fact.
 *
 * **The copy names what actually travels, and the two destinations are not
 * equivalent.** CLAUDE.md's promise is that there is no backend and every piece
 * of user data lives on device; a sync server ends that, and the row that turns
 * one on is the last place a person can decide whether they want it to. So the
 * footer says the server holds a complete copy rather than only describing the
 * mechanism, and the mood, medication, food and workout logs are named wherever they go
 * or don't. iCloud never gets them (HEALTH_SYNC_TABLES, App Review 5.1.3(ii)),
 * and the server gets them only behind their own switch, off by default, since
 * a hosted copy of somebody's symptoms and doses is a separate decision from a
 * hosted copy of their tasks. Weight is the one thing that cannot travel at
 * all — HealthKit is the record and there is no table.
 *
 * The pattern is the app's own: PrivacyAiSettings states in each section footer
 * exactly what leaves the device, and this is the same obligation for a bigger
 * departure. See "The privacy consequence, stated plainly" in
 * docs/arch/mcp-server.md.
 *
 * **Turning iCloud on asks first when this device has data of its own** and
 * has never synced (`joinChoiceNeeded`): keep it, and it is merged with the
 * other devices' data and sent to them, or erase it and take only theirs
 * (`eraseAndJoin`). Sync is two-way with no device in charge, so this is the
 * one moment a device can join without adding anything to the others.
 */
/**
 * Straight after the erase: every store re-reads the empty database and drops
 * its undo history, then the calendar events the erased rows held go the way a
 * synced deletion's do, since only this device can delete them.
 */
function afterErase(erased: ErasedEvents): void {
  reloadAfterDataReplaced();
  useTaskStore.getState().reconcileSyncedEvents({ taskIds: [], removedTaskEvents: erased.removedTaskEvents });
  useMealPlanStore.getState().reconcileSyncedEvents({ mealEntryIds: [], removedMealEvents: erased.removedMealEvents });
}

export function SyncSettings() {
  const supported = useSyncStore(s => s.supported);
  const enabled = useSyncStore(s => s.enabled);
  const phase = useSyncStore(s => s.phase);
  const lastSyncedAt = useSyncStore(s => s.lastSyncedAt);
  const problem = useSyncStore(s => s.problem);
  const serverUrl = useSyncStore(s => s.serverUrl);
  const hasServerToken = useSyncStore(s => s.hasServerToken);
  const serverHealthLogs = useSyncStore(s => s.serverHealthLogs);
  const serverJournal = useSyncStore(s => s.serverJournal);
  const setEnabled = useSyncStore(s => s.setEnabled);
  const eraseAndJoin = useSyncStore(s => s.eraseAndJoin);
  const keepAndJoin = useSyncStore(s => s.keepAndJoin);
  const serverHeld = useSyncStore(s => s.serverHeld);
  const setServerUrl = useSyncStore(s => s.setServerUrl);
  const setServerToken = useSyncStore(s => s.setServerToken);
  const setServerHealthLogs = useSyncStore(s => s.setServerHealthLogs);
  const setServerJournal = useSyncStore(s => s.setServerJournal);
  const syncNow = useSyncStore(s => s.syncNow);

  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);

  const [urlDraft, setUrlDraft] = useState(serverUrl);
  // Never seeded from the stored value: a token is write-only here, the same
  // way the API key fields are. What the row reports is whether one is set.
  const [tokenDraft, setTokenDraft] = useState('');

  useFocusEffect(
    React.useCallback(() => {
      setUrlDraft(useSyncStore.getState().serverUrl);
      setTokenDraft('');
    }, [])
  );

  // While an erase-and-join is downloading, before sync reads as on.
  const [joining, setJoining] = useState(false);

  const eraseThenJoin = async (destination: SyncDestination) => {
    setJoining(true);
    try {
      const outcome = await eraseAndJoin(destination, afterErase);
      const where = destination === 'icloud' ? 'iCloud' : 'the sync server';
      if (outcome.status === 'nothing-to-join') {
        Alert.alert(
          `Nothing to download from ${where}`,
          destination === 'icloud'
            ? 'None of your other devices has synced yet, so nothing on this device was erased. Turn on sync on the device whose data you want to keep, then try again here.'
            : 'The sync server holds nothing yet, so nothing on this device was erased. Set up sync on the device whose data you want to keep, then try again here.'
        );
      } else if (outcome.status === 'failed') {
        const reason = /[.!?]$/.test(outcome.reason) ? outcome.reason : `${outcome.reason}.`;
        Alert.alert(`Couldn’t download from ${where}`, `${reason} Nothing on this device was erased.`);
      }
    } finally {
      setJoining(false);
    }
  };

  // Asked before a device with data of its own first joins a destination.
  const askHowToJoin = (destination: SyncDestination) => {
    Alert.alert(
      'Keep the data on this device?',
      destination === 'icloud'
        ? 'If you keep it, it’s merged with your other devices’ data and sent to them. If you erase it, this device starts over with only what your other devices have synced. Erasing also removes the mood, medication and food logs, workouts and journal on this device, since iCloud doesn’t carry them. This can’t be undone.'
        : 'If you keep it, it’s merged with the data on the sync server and sent to it. If you erase it, this device starts over with only what the server holds. Erasing also removes the mood, medication and food logs, workouts and journal on this device unless the server holds them too. This can’t be undone.',
      [
        { text: 'Keep and merge', onPress: () => { animateLayout(); void keepAndJoin(destination); } },
        { text: 'Erase and sync', style: 'destructive', onPress: () => void eraseThenJoin(destination) },
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
      ]
    );
  };

  const onToggle = () => {
    if (joining) return;
    if (!enabled && joinChoiceNeeded('icloud')) {
      askHowToJoin('icloud');
      return;
    }
    animateLayout();
    void setEnabled(!enabled);
  };

  // Asked the moment the server's address and token are both in, while the
  // fields are still in front of the person; the row below asks again later.
  const wasHeld = useRef(serverHeld);
  useEffect(() => {
    if (serverHeld && !wasHeld.current) askHowToJoin('server');
    wasHeld.current = serverHeld;
    // askHowToJoin is rebuilt each render and only read at the transition.
  }, [serverHeld]);

  // Sync is reachable when either destination is set up, so the rows below that
  // report on a sync can't hang off the iCloud switch alone. A held server is
  // set up but not syncing yet.
  const serverSyncing = !!serverUrl && hasServerToken && !serverHeld;
  const anyDestination = (supported && enabled) || serverSyncing;
  // What "Replace with synced data" downloads from: iCloud when it's on, since
  // the other destination then fills in from its own beginning anyway.
  const replaceFrom: SyncDestination = supported && enabled ? 'icloud' : 'server';

  const confirmReplace = () => {
    Alert.alert(
      'Replace this device’s data?',
      replaceFrom === 'icloud'
        ? 'Everything on this device is erased and replaced with what your devices have synced to iCloud. Changes made here that haven’t synced yet are lost, and so are the mood, medication and food logs, workouts and journal on this device, since iCloud doesn’t carry them. This can’t be undone.'
        : 'Everything on this device is erased and replaced with what the sync server holds. Changes made here that haven’t synced yet are lost. Mood, medication and food logs, workouts and the journal come back only if the server holds them. This can’t be undone.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: 'Erase and sync', style: 'destructive', onPress: () => void eraseThenJoin(replaceFrom) },
      ]
    );
  };

  return (
    <SettingsSection
      label="Sync"
      footer="Changes sync when you open the app on each device."
      explain={{
        title: 'How sync works',
        paragraphs: [
          'Changes sync when you open the app on each device.',
          'iCloud stores them in your private iCloud database and doesn’t receive your mood, medication or food logs, workouts, journal, dreams or milestones.',
          'A sync server holds a full copy of everything else except recipe photos, plus your health logs if you include them, on the machine you point it at. Set one up only if you want that copy.',
        ],
      }}
    >
      {supported && (
        <SettingsRow
          entryId="syncEnabled"
          icon="cloud-outline"
          iconColor={enabled ? colors.accent : undefined}
          label="Sync with iCloud"
          hint="Syncs your data across devices signed in to this Apple ID."
          toggle={enabled}
          value={enabled ? 'On' : 'Off'}
          busy={joining}
          disabled={joining}
          onPress={onToggle}
          accessibilityLabel="Sync with iCloud"
        />
      )}

      <SettingsRow
        entryId="syncServerUrl"
        icon="server-outline"
        iconColor={serverUrl ? colors.accent : undefined}
        label="Sync server"
        hint="A server you run so non-Apple devices can sync. It keeps a full copy of your data. Address and token are both required."
      >
        <TextField
          style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
          value={urlDraft}
          onChangeText={setUrlDraft}
          onBlur={() => setServerUrl(urlDraft)}
          placeholder="e.g. https://sync.example.com"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="url"
          accessibilityLabel="Sync server address"
        />
      </SettingsRow>

      <View style={styles.sep} />

      <SettingsRow
        entryId="syncServerToken"
        icon="key-outline"
        iconColor={hasServerToken ? colors.accent : undefined}
        label="Sync server token"
        hint={hasServerToken ? 'Saved. Type a new one to replace it.' : 'The token your sync server was set up with.'}
      >
        <TextField
          style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
          value={tokenDraft}
          onChangeText={setTokenDraft}
          onBlur={() => { if (tokenDraft) void setServerToken(tokenDraft); }}
          placeholder={hasServerToken ? '••••••••' : 'e.g. a1b2c3…'}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="Sync server token"
        />
      </SettingsRow>

      {serverHeld && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            icon="warning-outline"
            iconColor={colors.orange}
            label="Sync server is waiting"
            hint="This device already has data. Choose whether to merge it with the server or erase it first."
            alwaysShowHint
            chevron
            busy={joining}
            disabled={joining}
            onPress={() => askHowToJoin('server')}
          />
        </>
      )}

      <View style={styles.sep} />

      <SettingsRow
        entryId="syncServerHealthLogs"
        icon="heart-outline"
        iconColor={serverHealthLogs ? colors.accent : undefined}
        label="Include health logs"
        hint="Sends your mood, medication and food logs, your workouts and your milestones to the sync server. Turning this off stops sending new entries. Entries already sent stay on the server, and the server is told this is off so Claude knows they may be incomplete."
        toggle={serverHealthLogs}
        value={serverHealthLogs ? 'On' : 'Off'}
        onPress={() => setServerHealthLogs(!serverHealthLogs)}
        accessibilityLabel="Include health logs on the sync server"
      />

      <View style={styles.sep} />

      {/* Its own switch, not part of health logs: the server is what Claude
          reads through the MCP server, and a diary is a separate decision
          (JOURNAL_SYNC_TABLES). */}
      <SettingsRow
        entryId="syncServerJournal"
        icon="book-outline"
        iconColor={serverJournal ? colors.accent : undefined}
        label="Include journal and dreams"
        hint="Sends your journal entries and dreams to the sync server so Claude can read and write them. Turning this off stops sending new entries. Entries already sent stay on the server, and the server is told this is off so Claude knows they may be incomplete."
        toggle={serverJournal}
        value={serverJournal ? 'On' : 'Off'}
        onPress={() => setServerJournal(!serverJournal)}
        accessibilityLabel="Include journal and dreams on the sync server"
      />

      <AgentNotesRows />

      {anyDestination && (
        <SettingsRow
          icon="time-outline"
          label="Last synced"
          value={describeLastSynced(lastSyncedAt, phase)}
          tight
        />
      )}

      {anyDestination && (
        <SettingsRow
          entryId="syncNow"
          icon="refresh-outline"
          iconColor={colors.accent}
          label="Sync now"
          busy={phase === 'syncing'}
          onPress={() => void syncNow()}
          disabled={phase === 'syncing'}
        />
      )}

      {anyDestination && (
        <>
          <View style={styles.sep} />
          <SettingsRow
            entryId="syncReplaceData"
            icon="arrow-down-circle-outline"
            iconColor={colors.red}
            label="Replace with synced data"
            labelColor={colors.redText}
            hint="Erases everything on this device and downloads what your other devices have synced."
            busy={joining}
            disabled={joining || phase === 'syncing'}
            onPress={confirmReplace}
          />
        </>
      )}

      {anyDestination && problem !== null && (
        <SettingsRow
          icon="alert-circle-outline"
          iconColor={colors.red}
          label={problem}
          labelColor={colors.redText}
        />
      )}
    </SettingsSection>
  );
}
