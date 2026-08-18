import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Task } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, radius, interaction, type Colors } from '../theme';
import { formatTaskDeliverable } from '../utils/deliverables';
import { displayTitleFor } from '../utils/visibilityUtils';

interface Props {
  /** Already collapsed to one row per member — see projectDecisions. */
  decisions: Task[];
  /** Opens the answer for correction. Omitted while the screen is selecting rows. */
  onPress?: (task: Task) => void;
}

/**
 * What a project has decided, above the work it still has to do.
 *
 * Reference material rather than a to-do list: these rows are answered
 * questions ("the tile is matte white", "the budget is 2,400"), which is why
 * the block sits at the top of the screen and why the answer is the loud half
 * of the row while the question that produced it is the quiet half.
 *
 * The answer is rendered through `formatTaskDeliverable` and wears the same
 * tinted pill the Logbook row gives it — one formatter and one treatment, so a
 * decision reads identically wherever it's read. No "?" in the pill (#1735):
 * these rows are already-answered questions, and a question mark on one reads
 * as the decision still being open.
 */
export function ProjectDecisions({ decisions, onPress }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (decisions.length === 0) return null;

  return (
    <View style={styles.block}>
      <Text style={styles.label}>Decisions</Text>
      {decisions.map(task => {
        const answer = formatTaskDeliverable(task);
        const title = displayTitleFor(task);
        return (
          <TouchableOpacity
            key={task.id}
            style={styles.row}
            onPress={() => onPress?.(task)}
            disabled={!onPress}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${title}, answered ${answer}`}
            accessibilityHint={onPress ? 'Double tap to change the answer' : undefined}
          >
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <View style={styles.answerPill}>
              <Text style={styles.answer} numberOfLines={1}>{answer}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Margin on both sides: the list's own rows start immediately below with no
  // top margin of their own (see CLAUDE.md on stacked blocks).
  block: {
    paddingBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    // spacing.xs under the label is what every section header in the app uses;
    // the top pad brings the gap above it up to the same 12 a Today section
    // header gets, since the list's own paddingTop is all that sits above.
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  // The same inset-grouped card every list row on this screen wears, so the
  // block reads as part of the same list rather than as a foreign panel.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  // Basis 0, so the question gives up its width to a long answer before the
  // answer starts truncating — the answer is what someone came here to read.
  title: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: font.sm,
  },
  answerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    flexShrink: 1,
  },
  answer: {
    color: colors.accent,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
});
