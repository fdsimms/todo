import React, { useCallback, useMemo, useState } from 'react';
import { View, AppState, Linking, Platform } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useColors } from '../../theme/ThemeContext';
import { makeSettingsStyles } from './settingsStyles';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { haptics } from '../../utils/haptics';
import { isHealthSupported } from '../../utils/healthBridge';
import { getCalendarPermission, requestCalendarPermission } from '../../utils/calendarSync';
import { getRemindersPermission, requestRemindersPermission } from '../../utils/remindersImportSync';
import { getContactsPermission, requestContactsPermission } from '../../utils/contactsAccess';
import { getLocationPermission, requestLocationPermission } from '../../utils/weatherLocation';
import { getNotificationPermission, requestNotificationPermissions } from '../../utils/notifications';
import {
  getCameraPermission, requestCameraPermission,
  getPhotoLibraryPermission, requestPhotoLibraryPermission,
} from '../../utils/recipePhoto';
import type { SettingsGroupId } from '../../utils/settingsIndex';

/** The one shape every permission in the app reports its status in. */
type Status = 'granted' | 'denied' | 'undetermined' | 'unsupported' | null;

interface PermissionSpec {
  entryId: string;
  icon: string;
  label: string;
  /** What the app actually uses this for, in one line. */
  hint: string;
  getStatus: () => Promise<Status>;
  requestAccess: () => Promise<boolean>;
  /** iOS-only, matching the index entry — dropped from the list off-platform. */
  iosOnly?: boolean;
}

/**
 * Every system permission the app can ask for, except Apple Health — which
 * lives in its own group below and is deliberately not summarised here (see
 * that section's own comment).
 *
 * One list, in the same order as the labels the OS's own per-app Settings
 * page uses, so a row here and a row there name the same thing side by side.
 */
const PERMISSIONS: PermissionSpec[] = [
  {
    entryId: 'permCalendar', icon: 'calendar-outline', label: 'Calendar',
    hint: 'Reads events to show what your day looks like, and can write deadlines, completions and meals to it',
    getStatus: getCalendarPermission, requestAccess: requestCalendarPermission, iosOnly: true,
  },
  {
    entryId: 'permReminders', icon: 'list-outline', label: 'Reminders',
    hint: 'Imports tasks added by Siri or voice, and can send grocery items to a list',
    getStatus: getRemindersPermission, requestAccess: requestRemindersPermission, iosOnly: true,
  },
  {
    entryId: 'permContacts', icon: 'people-outline', label: 'Contacts',
    hint: 'Fills in a person\'s name and birthday from your address book',
    getStatus: getContactsPermission, requestAccess: requestContactsPermission, iosOnly: true,
  },
  {
    entryId: 'permLocation', icon: 'location-outline', label: 'Location',
    hint: 'Checks the forecast where you are, for weather-based task rules',
    getStatus: getLocationPermission, requestAccess: requestLocationPermission, iosOnly: true,
  },
  {
    entryId: 'permCamera', icon: 'camera-outline', label: 'Camera',
    hint: 'Scans a barcode, and photographs a receipt, a nutrition label or a recipe',
    getStatus: getCameraPermission, requestAccess: requestCameraPermission,
  },
  {
    entryId: 'permPhotos', icon: 'images-outline', label: 'Photos',
    hint: 'Picks an existing photo of a recipe or a product from your library',
    getStatus: getPhotoLibraryPermission, requestAccess: requestPhotoLibraryPermission,
  },
  {
    entryId: 'permNotifications', icon: 'notifications-outline', label: 'Notifications',
    hint: 'Delivers reminders, the daily agenda, and time-sensitive alarms',
    getStatus: getNotificationPermission, requestAccess: requestNotificationPermissions,
  },
];

/**
 * One place to see every system permission the app uses and its current
 * state, and to re-grant whichever ones need it.
 *
 * This is deliberately an index over what every other area's own settings
 * already check, not a second copy of any of them: Calendar/Reminders and
 * Notifications keep their full detail (which calendars, which list, quiet
 * hours) in their own groups, and this screen's rows use exactly the same
 * `get*Permission`/`request*Permission` pair those screens do. It exists
 * because none of those screens are somewhere you'd think to look right
 * after a device-wide privacy reset wipes every grant back to "not asked" —
 * this is that one place, built from the same accounting question a support
 * conversation turned up: "what do I need to redo?"
 *
 * **Apple Health is named but never summarised here.** Its own group already
 * makes the read/write and per-type distinctions carefully (see
 * `HealthSettings.tsx`'s own header comment on why read and write can't share
 * one status), and Health also isn't in the OS's own per-app Settings page at
 * all — fixing it means the Health app, never `Linking.openSettings()`. A
 * rollup here would either repeat that whole ladder or flatten it into
 * something misleading, so the row is a plain link to the real thing instead.
 */
export function PermissionsSettings() {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const navigation = useNavigation();

  const [statuses, setStatuses] = useState<Status[]>(() => PERMISSIONS.map(() => null));
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  const refresh = useCallback(() => {
    PERMISSIONS.forEach((permission, index) => {
      permission.getStatus()
        .then(status => setStatuses(prev => {
          const next = [...prev];
          next[index] = status;
          return next;
        }))
        .catch(() => setStatuses(prev => {
          const next = [...prev];
          next[index] = null;
          return next;
        }));
    });
  }, []);

  // Same reason every per-area screen refreshes here: a denied row's fix is
  // either the OS Settings app or a system sheet, neither of which unfocuses
  // this screen, so a foreground is the only signal that something changed.
  useFocusEffect(
    useCallback(() => {
      refresh();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') refresh();
      });
      return () => sub.remove();
    }, [refresh])
  );

  const openGroup = (groupId: SettingsGroupId) =>
    (navigation as never as { navigate: (n: string, p: object) => void })
      .navigate('SettingsGroup', { groupId });

  const askFor = async (index: number) => {
    haptics.tap();
    setBusyIndex(index);
    try {
      await PERMISSIONS[index].requestAccess();
    } finally {
      setBusyIndex(null);
      refresh();
    }
  };

  return (
    <>
      <SettingsSection
        label="Apple Health"
        footer="Reading steps and nutrition, and writing water, weight and food, are each their own permission. See Apple Health for the full breakdown and how to fix any of them."
      >
        <SettingsRow
          entryId="permHealth"
          icon="heart-outline"
          label="Apple Health"
          hint={isHealthSupported() ? 'Read and write access, and how to fix either' : 'Not available on this device'}
          alwaysShowHint
          chevron={isHealthSupported()}
          onPress={isHealthSupported() ? () => openGroup('health') : undefined}
          accessibilityLabel="Apple Health permissions"
        />
      </SettingsSection>

      <SettingsSection
        label="App permissions"
        footer="What dundundun can read or write on this device, and one tap to fix whichever one needs it. Turning any of these off in the OS doesn't change what the app asks for next time, only what it's allowed to do until you turn it back on."
      >
        {PERMISSIONS
          .map((permission, index) => ({ permission, index }))
          .filter(({ permission }) => !permission.iosOnly || Platform.OS === 'ios')
          .map(({ permission, index }, visibleIndex) => {
            const status = statuses[index];
            const granted = status === 'granted';
            return (
              <React.Fragment key={permission.entryId}>
                {visibleIndex > 0 && <View style={styles.sep} />}
                <SettingsRow
                  entryId={permission.entryId}
                  icon={permission.icon}
                  iconColor={granted ? colors.accent : undefined}
                  label={permission.label}
                  hint={
                    status === 'granted' ? permission.hint
                      : status === 'denied' ? 'Not allowed. ' + permission.hint
                        : status === 'undetermined' ? 'Not asked yet. ' + permission.hint
                          : status === 'unsupported' ? 'Not available on this device'
                            : 'Checking…'
                  }
                  alwaysShowHint
                  busy={busyIndex === index}
                  value={
                    status === 'undetermined' ? 'Allow'
                      : status === 'denied' ? 'Open Settings'
                        : undefined
                  }
                  onPress={
                    status === 'undetermined' ? () => { void askFor(index); }
                      : status === 'denied' ? () => { haptics.tap(); void Linking.openSettings(); }
                        : undefined
                  }
                />
              </React.Fragment>
            );
          })}
      </SettingsSection>
    </>
  );
}
