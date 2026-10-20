import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Linking, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, iconSize, type Colors } from '../theme';
import { useNotificationPermission } from '../hooks/useNotificationPermission';
import { InlineAction } from './InlineAction';

interface Props {
  /** Reads "these reminders" rather than "this reminder" (the Reminders screen). */
  plural?: boolean;
  /** Skip the permission read, for a host with no reminder set. */
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Says, wherever a reminder is set, that it won't ring because notifications
 * are off for the app. Without it a refused permission is invisible: the
 * reminder saves, the Reminders screen lists it as upcoming, and it never
 * arrives.
 *
 * A note rather than an alert. NotificationSettings explains why setting a
 * reminder never raises a permission alert (it's set long before it fires),
 * and a note asks nothing of anyone. Renders nothing unless the permission was
 * refused outright: one never asked is still asked when it's needed
 * (`askForReminderPermissionIfNeeded`), and asking would work.
 *
 * Not `HelpText`: this is a warning about this reminder, not an explanation of
 * the control, so Hide help text must not hide it.
 */
export function RemindersOffNote({ plural = false, enabled = true, style }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const status = useNotificationPermission(enabled);
  if (!enabled || status !== 'denied') return null;

  return (
    <View style={[styles.note, style]}>
      <Ionicons name="warning-outline" size={iconSize.sm} color={colors.warningText} style={styles.icon} />
      <View style={styles.body}>
        <Text style={styles.text}>
          {plural
            ? 'Notifications are off for dundundun, so these reminders won’t ring.'
            : 'Notifications are off for dundundun, so this reminder won’t ring.'}
        </Text>
        <View style={styles.actions}>
          <InlineAction
            label="Open Settings"
            variant="neutral"
            onPress={() => { void Linking.openSettings(); }}
            accessibilityLabel="Open Settings to turn on notifications"
          />
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.smd,
  },
  // Optically on the first line's cap height rather than the line box.
  icon: { marginTop: 2 },
  body: { flex: 1, gap: spacing.sm },
  text: { fontSize: font.sm, color: colors.text },
  actions: { flexDirection: 'row' },
});
