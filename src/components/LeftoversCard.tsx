import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Leftover, LeftoverFreshness } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { InlineAction } from './InlineAction';
import { describeFridge, describeLeftover, freshnessOf, liveLeftovers } from '../utils/leftovers';

interface Props {
  /** Every leftover the store holds; the card takes the live ones itself. */
  leftovers: readonly Leftover[];
  onPress: (leftover: Leftover) => void;
  onAdd: () => void;
  /** Opens FridgeHistorySheet. Offered only once something has been closed out. */
  onHistory: () => void;
}

/**
 * "In the fridge" — the live leftovers, most urgent first, above the week.
 *
 * **This is the nudge**, and it deliberately isn't a notification or an
 * auto-created Task. A reminder *Task* for a perishable is #1106's job and does
 * not exist yet; building a second mechanism here is exactly what that issue
 * asks not to happen, and this row already lands in front of the user at the
 * moment they're deciding what to eat — which is the moment the nudge is
 * actionable rather than merely noisy.
 *
 * It renders nothing at all when the fridge is empty *and* nothing has been
 * closed out. An empty state here would be a permanent block of chrome on the
 * meal plan for everyone who never uses the feature, and unlike a screen with
 * nothing on it, this one has a whole week underneath it that wants the space.
 *
 * **History is the one thing that keeps it on screen with an empty fridge**,
 * and only for someone who has actually used the feature inside the last
 * `LEFTOVER_RETENTION_DAYS`. That's a deliberate narrowing of the rule above
 * rather than an exception to it: the objection was to chrome for people who
 * never use this, and a closed-out row is proof they do. It self-clears when
 * the purge takes the last one, so it can't become permanent for someone who
 * has moved on — and the moment the fridge empties is exactly when "did we eat
 * it or bin it" gets asked, which is precisely when the old rule hid the
 * answer. With nothing live it shrinks to its caption and its two actions,
 * not to a full empty state.
 */
export function LeftoversCard({ leftovers, onPress, onAdd, onHistory }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const live = useMemo(() => liveLeftovers(leftovers), [leftovers]);
  const hasHistory = useMemo(() => leftovers.some(l => !!l.finishedAt), [leftovers]);
  if (live.length === 0 && !hasHistory) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Ionicons name="snow-outline" size={iconSize.sm} color={colors.textTertiary} />
        <Text style={styles.headerText}>{describeFridge(leftovers)}</Text>
      </View>

      {live.length > 0 && (
      <View style={styles.card}>
        {live.map((leftover, i) => {
          const freshness = freshnessOf(leftover);
          const tint = freshnessColor(freshness, colors);
          return (
            <TouchableOpacity
              key={leftover.id}
              style={[styles.row, i > 0 && styles.rowDivided]}
              onPress={() => { haptics.tap(); onPress(leftover); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${leftover.title}, ${describeLeftover(leftover)}`}
            >
              {/* The dot carries the whole freshness signal, so the caption is
                  never the only thing saying it — a colour nobody can see is
                  still legible as "there is a state here" next to text that
                  spells it out. */}
              <View style={[styles.dot, { backgroundColor: tint }]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{leftover.title}</Text>
                <Text style={[styles.rowCaption, { color: tint }]}>
                  {describeLeftover(leftover)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          );
        })}
      </View>
      )}

      {/* A row rather than the single stretched pill this used to be — two
          actions side by side, each sized to its label. */}
      <View style={styles.actions}>
        <InlineAction label="Log a leftover" icon="add" onPress={onAdd} variant="neutral" />
        {hasHistory && (
          <InlineAction
            label="History"
            icon="time-outline"
            onPress={onHistory}
            variant="neutral"
            accessibilityLabel="What happened to past leftovers"
          />
        )}
      </View>
    </View>
  );
}

/**
 * The colour a freshness state reads in.
 *
 * Three levels for four states, on purpose. `fresh` is the ordinary tertiary
 * text colour rather than green — most of the fridge is fine most of the time,
 * and a card of green dots makes the one orange one harder to find, not easier.
 * `soon` and `due` share orange because the caption beside them already says
 * which ("Use by tomorrow" / "Use by today"); the alternative was yellow for
 * `soon`, which is `colors.warning` and is a banner fill, not a text colour —
 * it fails on the light theme's white card the moment it's used for the caption
 * rather than only the dot.
 */
export function freshnessColor(freshness: LeftoverFreshness, colors: Colors): string {
  switch (freshness) {
    case 'over': return colors.red;
    case 'due':
    case 'soon': return colors.orange;
    default: return colors.textTertiary;
  }
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: 2,
  },
  headerText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  rowCaption: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
