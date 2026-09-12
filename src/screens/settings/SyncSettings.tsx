import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSyncStore } from '../../store/useSyncStore';
import { useColors } from '../../theme/ThemeContext';
import { animateLayout } from '../../utils/layoutAnimation';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { describeLastSynced } from '../../utils/syncStatus';

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
 * mechanism, and both hints name the mood, medication and food logs explicitly:
 * they are sync-tracked (see SYNC_TRACKED_TABLES), so "tasks, lists and
 * recipes" was an undercount on the iCloud side too. Weight is the one thing
 * that genuinely cannot travel — HealthKit is the record and there is no table.
 *
 * The pattern is the app's own: PrivacyAiSettings states in each section footer
 * exactly what leaves the device, and this is the same obligation for a bigger
 * departure. See "The privacy consequence, stated plainly" in
 * docs/arch/mcp-server.md.
 */
export function SyncSettings() {
  const supported = useSyncStore(s => s.supported);
  const enabled = useSyncStore(s => s.enabled);
  const phase = useSyncStore(s => s.phase);
  const lastSyncedAt = useSyncStore(s => s.lastSyncedAt);
  const problem = useSyncStore(s => s.problem);
  const serverUrl = useSyncStore(s => s.serverUrl);
  const hasServerToken = useSyncStore(s => s.hasServerToken);
  const setEnabled = useSyncStore(s => s.setEnabled);
  const setServerUrl = useSyncStore(s => s.setServerUrl);
  const setServerToken = useSyncStore(s => s.setServerToken);
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

  const onToggle = () => {
    animateLayout();
    void setEnabled(!enabled);
  };

  // Sync is reachable when either destination is set up, so the rows below that
  // report on a sync can't hang off the iCloud switch alone.
  const anyDestination = (supported && enabled) || (!!serverUrl && hasServerToken);

  return (
    <SettingsSection
      label="Sync"
      footer="Changes are exchanged when you open the app on each device. iCloud keeps them in your private iCloud database, on the Apple ID this device is signed in to. A sync server is not the same: it holds a complete copy of everything in this app, your mood, medication and food logs included, on whatever machine you point it at. Set one up only if you want that copy to exist."
    >
      {supported && (
        <SettingsRow
          entryId="syncEnabled"
          icon="cloud-outline"
          iconColor={enabled ? colors.accent : undefined}
          label="Sync with iCloud"
          hint="Keeps this app's data the same on every device signed in to this Apple ID, your mood, medication and food logs included."
          toggle={enabled}
          value={enabled ? 'On' : 'Off'}
          onPress={onToggle}
          accessibilityLabel="Sync with iCloud"
        />
      )}

      <SettingsRow
        entryId="syncServerUrl"
        icon="server-outline"
        iconColor={serverUrl ? colors.accent : undefined}
        label="Sync server"
        hint="A server you run, so something that isn't an Apple device can sync with this app. It keeps a full copy of your data, health logs included. Both this and the token are needed."
      >
        <TextInput
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
        <TextInput
          style={[styles.apiKeyInput, { color: colors.text, borderBottomColor: colors.separator }]}
          value={tokenDraft}
          onChangeText={setTokenDraft}
          onBlur={() => { if (tokenDraft) void setServerToken(tokenDraft); }}
          placeholder={hasServerToken ? '••••••••' : 'e.g. a1b2c3...'}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="Sync server token"
        />
      </SettingsRow>

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

      {anyDestination && problem !== null && (
        <SettingsRow
          icon="alert-circle-outline"
          iconColor={colors.red}
          label={problem}
          labelColor={colors.red}
        />
      )}
    </SettingsSection>
  );
}
