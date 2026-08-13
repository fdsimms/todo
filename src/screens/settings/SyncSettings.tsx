import React from 'react';
import { useSyncStore } from '../../store/useSyncStore';
import { useColors } from '../../theme/ThemeContext';
import { animateLayout } from '../../utils/layoutAnimation';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { describeLastSynced } from '../../utils/syncStatus';

/**
 * Turning sync on, and saying honestly what it has done.
 *
 * Rendered only when the native module is in the build, so a version without
 * it shows nothing rather than a row that can't work.
 *
 * The status line says **when it last synced**, never "up to date". Sync runs
 * when the app comes to the front — iOS won't let a backgrounded app poll, and
 * the Mac window is suspended when it isn't focused — so "up to date" would be
 * a claim the app can't keep. A timestamp is a fact.
 */
export function SyncSettings() {
  const supported = useSyncStore(s => s.supported);
  const enabled = useSyncStore(s => s.enabled);
  const phase = useSyncStore(s => s.phase);
  const lastSyncedAt = useSyncStore(s => s.lastSyncedAt);
  const problem = useSyncStore(s => s.problem);
  const setEnabled = useSyncStore(s => s.setEnabled);
  const syncNow = useSyncStore(s => s.syncNow);

  const colors = useColors();

  if (!supported) return null;

  const onToggle = () => {
    animateLayout();
    void setEnabled(!enabled);
  };

  return (
    <SettingsSection
      label="Sync"
      footer="Changes are exchanged when you open the app on each device."
    >
      <SettingsRow
        icon="cloud-outline"
        iconColor={enabled ? colors.accent : undefined}
        label="Sync with iCloud"
        hint="Keeps your tasks, lists and recipes the same on every device signed in to this Apple ID."
        toggle={enabled}
        value={enabled ? 'On' : 'Off'}
        onPress={onToggle}
        accessibilityLabel="Sync with iCloud"
      />

      {enabled && (
        <SettingsRow
          icon="time-outline"
          label="Last synced"
          value={describeLastSynced(lastSyncedAt, phase)}
          tight
        />
      )}

      {enabled && (
        <SettingsRow
          icon="refresh-outline"
          iconColor={colors.accent}
          label="Sync now"
          busy={phase === 'syncing'}
          onPress={() => void syncNow()}
          disabled={phase === 'syncing'}
          tight
        />
      )}

      {enabled && problem !== null && (
        <SettingsRow
          icon="alert-circle-outline"
          iconColor={colors.red}
          label={problem}
          labelColor={colors.red}
          tight
        />
      )}
    </SettingsSection>
  );
}
