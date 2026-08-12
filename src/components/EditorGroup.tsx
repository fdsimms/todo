import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { foldRows, moreLabel, moreHint, foldedSummary, type FoldRow } from '../utils/editorFold';

export interface EditorGroupRow {
  key: string;
  /** The row's own name, for the "N more" hint and the folded summary. */
  label: string;
  /** Does it hold a value? A set row is never hidden, and opens its group. */
  set?: boolean;
  /** One of the few shown even when empty. */
  primary?: boolean;
  node: React.ReactNode;
}

interface Props {
  /** Uppercase group heading — SCHEDULE, ORGANIZE, … */
  label: string;
  rows: EditorGroupRow[];
  /**
   * Where the dividers start. `icon` clears the 18pt icon column the
   * `EditorRow` groups have; `full` runs edge to edge, for the cards of
   * `CollapsibleField`s, which have no icon to clear.
   */
  divider?: 'icon' | 'full';
  /**
   * Never fold, even with nothing set. For the one group a task almost always
   * needs something from — you open this sheet to say when a thing happens far
   * more often than to give it an effort rating, and making that group cost a
   * tap would be the change trading one kind of friction for another.
   */
  startOpen?: boolean;
  /**
   * Open for the moment, even with nothing set — for a caller steering the
   * user at a specific row inside a group that would otherwise fold away
   * (e.g. a nudge toward Phone in "More" on a still-empty task). Unlike
   * `startOpen` this is expected to flip back off once its reason is gone.
   */
  forceOpen?: boolean;
}

/**
 * One card of an editor form, which shows as much of itself as the task
 * warrants.
 *
 * The editors already collapsed their *pickers*; what they never did was leave
 * a field out. Every one of the task editor's 23 rows rendered for every task,
 * and since an unset row shows its explanatory hint, a brand-new empty task
 * was the longest form in the app — maximum explanation at the moment there is
 * least to explain.
 *
 * So: a group with nothing set folds to a single line naming what's inside. A
 * group holding something opens, showing the rows that hold it plus the few
 * most tasks want, with the rest behind one "N more". Nothing is more than a
 * tap away and nothing has moved screens — see `editorFold.ts` for the split,
 * which is where the behaviour is actually tested.
 */
export function EditorGroup({ label, rows, divider = 'icon', startOpen, forceOpen }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const fold = useMemo(
    () => foldRows<EditorGroupRow>(
      rows.map(r => ({ key: r.key, set: !!r.set, primary: r.primary, row: r }))
    ),
    [rows]
  );

  // Opened by hand. The group is otherwise open exactly while it holds
  // something, so a task that gains a value opens its group on the spot and
  // one that's cleared folds back — the card tracks the task rather than
  // remembering a tap.
  const [openedByHand, setOpenedByHand] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const open = startOpen || forceOpen || !fold.folded || openedByHand;

  const toggle = (fn: () => void) => {
    haptics.tap();
    animateLayout();
    fn();
  };

  if (!open) {
    return (
      <TouchableOpacity
        style={styles.folded}
        onPress={() => toggle(() => setOpenedByHand(true))}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        accessibilityLabel={`${label}. Nothing set. ${foldedSummary(rows.map(r => r.label))}`}
      >
        <Text style={styles.foldedLabel}>{label}</Text>
        <Text style={styles.foldedSummary} numberOfLines={1}>
          {foldedSummary(rows.map(r => r.label))}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
      </TouchableOpacity>
    );
  }

  const hiddenLabels = fold.hidden.map(r => r.row.label);
  const shown = showMore ? [...fold.visible, ...fold.hidden] : fold.visible;
  const sep = divider === 'full' ? styles.sepFull : styles.sep;

  return (
    <>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.card}>
        {shown.map((r, i) => (
          <React.Fragment key={r.key}>
            {i > 0 && <View style={sep} />}
            {r.row.node}
          </React.Fragment>
        ))}

        {!showMore && fold.hidden.length > 0 && (
          <>
            {shown.length > 0 && <View style={sep} />}
            <TouchableOpacity
              style={styles.moreRow}
              onPress={() => toggle(() => setShowMore(true))}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityState={{ expanded: false }}
              accessibilityLabel={`${moreLabel(fold.hidden.length)}: ${moreHint(hiddenLabels)}`}
            >
              {/* Sits in the icon column so the control lines up with the rows
                  above it. An ellipsis rather than an outlined shape, which at
                  this size reads as an unchecked box — i.e. as a control you
                  could set, which this isn't. */}
              <Ionicons
                name="ellipsis-horizontal"
                size={18}
                color={colors.textSecondary}
                style={styles.moreIcon}
              />
              <View style={styles.moreContent}>
                <Text style={styles.moreLabel}>{moreLabel(fold.hidden.length)}</Text>
                <Text style={styles.moreHint} numberOfLines={2}>{moreHint(hiddenLabels)}</Text>
              </View>
              <Ionicons name="chevron-down" size={14} color={colors.accent} />
            </TouchableOpacity>
          </>
        )}
      </View>
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  groupLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.bold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.xs,
  },
  card: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  // Matches the separator inset the rows use, so the divider starts at the
  // label rather than under the icon column.
  sep: {
    height: StyleSheet.hairlineWidth, backgroundColor: colors.separator,
    marginLeft: spacing.md + 18 + spacing.md,
  },
  sepFull: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },

  folded: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2,
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  foldedLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.bold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  foldedSummary: { flex: 1, color: colors.textSecondary, fontSize: font.sm },

  moreRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 11,
  },
  moreIcon: { width: 18, textAlign: 'center' },
  moreContent: { flex: 1 },
  moreLabel: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  moreHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1, lineHeight: 15 },
});
