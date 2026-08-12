import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, iconSize, type Colors } from '../theme';
import { PressableScale } from './PressableScale';

export interface PostponeCheckAction {
  key: string;
  label: string;
  onPress: () => void;
}

interface Props {
  /** How many times the task has been pushed (Task.postponeCount). */
  count: number;
  /** The prominent way out — "Do it today". */
  primary: PostponeCheckAction;
  /** The quieter row beneath it. Any of these may be absent. */
  secondary: PostponeCheckAction[];
}

/**
 * "You've pushed this five times — want to just get it over with?"
 *
 * Shown at the top of WhenPicker when the task being rescheduled has been
 * pushed past the user's threshold (see utils/postpone.ts, and the
 * postponeCheckEnabled setting that gates the whole thing).
 *
 * Tinted accentSubtle rather than warningBg, following the split
 * ProjectNudgeBanner documents: accentSubtle is *an offer*, warningBg is
 * *something arrived that you may have missed*. This is an offer. The tone
 * matters more here than in most places — the feature is one prompt away from
 * reading as nagging, which is how it would get switched off.
 *
 * It deliberately does not block: the calendar below it still works exactly as
 * it always did, and picking a date is always one tap away. The way out is
 * offered, never required.
 *
 * Every action is a callback rather than a store write, because the two hosts
 * commit differently — TaskItem's picker writes immediately, TaskEditor's only
 * stages local state until the sheet is saved.
 */
export function PostponeCheckBanner({ count, primary, secondary }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.banner}>
      <View style={styles.headline}>
        <Ionicons name="repeat" size={iconSize.sm} color={colors.accent} />
        <Text style={styles.headlineText}>
          {/* The count is the whole message — it's the thing the app knows and
              the user has lost track of. */}
          <Text style={styles.count}>Pushed {count} times.</Text>
          {' '}Want to just get it over with?
        </Text>
      </View>

      {/* One wrapping row rather than a full-width primary above a second row
          of pills. The picker's card is centered with no scroll view, and on a
          small phone a six-week month plus the Time of day section already
          fills it — a two-row banner was enough to push the calendar off the
          bottom. Weight and fill carry the hierarchy instead of size. */}
      <View style={styles.actionRow}>
        <PressableScale
          style={[styles.action, styles.primaryAction]}
          onPress={primary.onPress}
          accessibilityLabel={primary.label}
        >
          <Text style={styles.primaryLabel}>{primary.label}</Text>
        </PressableScale>
        {secondary.map(action => (
          <PressableScale
            key={action.key}
            style={styles.action}
            onPress={action.onPress}
            accessibilityLabel={action.label}
          >
            <Text style={styles.secondaryLabel}>{action.label}</Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  banner: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accentSubtle,
    gap: spacing.sm,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  headlineText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
  },
  count: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  action: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bgQuaternary,
  },
  primaryAction: {
    backgroundColor: colors.accent,
  },
  primaryLabel: {
    color: colors.onAccent,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },
  secondaryLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
});
