import React, { memo, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { WeekPoolEntry } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, iconSize, type Colors } from '../theme';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { describePool } from '../utils/weekPool';

interface Props {
  /** This week's pool, in order. */
  entries: readonly WeekPoolEntry[];
  /** Opens the picker on "this week, no day yet". */
  onAdd: () => void;
  /** A row was tapped: choose its day and meal. */
  onPress: (entry: WeekPoolEntry) => void;
  onRemove: (entry: WeekPoolEntry) => void;
  /** Moves what is left to next week. Omitted when there is nothing to move. */
  onCarryOver?: () => void;
}

/**
 * Meals chosen for the week on screen with no day yet (`WeekPoolEntry`), above
 * the week's days. Always drawn, empty too: an empty pool is how the feature
 * is found. A row's tap places it (`PlanMealSheet` on the screen) rather than
 * opening an editor, because the one thing a pool meal is waiting for is a day.
 */
export const WeekPoolCard = memo(function WeekPoolCard({ entries, onAdd, onPress, onRemove, onCarryOver }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Ionicons name="layers-outline" size={iconSize.xs} color={colors.accent} />
        <Text style={styles.caption}>Not on a day yet</Text>
        {entries.length > 0 && <Text style={styles.count}>{describePool(entries.length)}</Text>}
      </View>
      <View style={styles.card}>
        {entries.map((entry, i) => (
          <View key={entry.id} style={[styles.row, i > 0 && styles.rowRule]}>
            <TouchableOpacity
              style={styles.rowMain}
              onPress={() => onPress(entry)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Choose a day for ${entry.title}`}
            >
              <Text style={styles.title} numberOfLines={2}>{entry.title}</Text>
              <Ionicons name="calendar-outline" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onRemove(entry)}
              hitSlop={8}
              activeOpacity={interaction.activeOpacity}
              style={styles.remove}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.title} from this week`}
            >
              <Ionicons name="close" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ))}
        {entries.length === 0 && (
          <HelpText style={styles.help}>
            Pick the meals you want this week now and give them days later.
          </HelpText>
        )}
        <View style={[styles.actions, entries.length === 0 && styles.actionsFirst]}>
          <InlineAction label="Add meal" icon="add" onPress={onAdd} surface="card" />
          {onCarryOver && (
            <InlineAction label="Move to next week" variant="neutral" onPress={onCarryOver} surface="card" />
          )}
        </View>
      </View>
    </View>
  );
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { marginHorizontal: spacing.md, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm, marginBottom: spacing.xsm },
  caption: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  count: { marginLeft: 'auto', color: colors.textSecondary, fontSize: font.xs },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    minHeight: 48,
    paddingVertical: spacing.smd,
    paddingLeft: spacing.md,
  },
  title: { flex: 1, color: colors.text, fontSize: font.md },
  remove: { paddingHorizontal: spacing.md, minHeight: 48, justifyContent: 'center' },
  help: { color: colors.textSecondary, fontSize: font.sm, padding: spacing.md, paddingBottom: 0 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xsm,
    padding: spacing.smd,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  actionsFirst: { borderTopWidth: 0 },
});
