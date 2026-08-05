import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

interface Props {
  /** Uppercase section label, e.g. "Category". */
  label: string;
  /**
   * The current value, rendered on the header row while collapsed so the
   * field reads as a summary until you actually want to change it.
   * Omit for "nothing chosen yet".
   */
  summary?: string;
  /** Shown in place of the summary when the field has no value. */
  emptySummary?: string;
  /** One-liner explaining what the field does — shown only while expanded. */
  hint?: string;
  expanded: boolean;
  onToggle: () => void;
  /** Extra header content (an AI suggest button, a progress count, …). */
  right?: React.ReactNode;
  /**
   * Renders the field as a read-only summary: no chevron, nothing to open,
   * and `lockedHint` under it saying where the value comes from. For a value
   * that's genuinely owned elsewhere — showing a picker that silently refuses
   * to stick is worse than showing none.
   */
  locked?: boolean;
  /** Required alongside `locked`: one line explaining what owns the value. */
  lockedHint?: string;
  children: React.ReactNode;
}

/**
 * A section of an editor form that collapses to a single "Label … value" row.
 *
 * The editors (task, template item, stack, project, template) each used to
 * render every picker fully expanded, so a screen full of category/tag/
 * priority/effort pill grids buried the handful of fields you actually came
 * to change. Collapsed-by-default turns that into a scannable list where each
 * row states its own name and current value, and only the field you tap opens
 * up. `hint` is the place to explain what a field means — it appears exactly
 * when someone has expressed interest by opening it.
 */
export function CollapsibleField({
  label, summary, emptySummary = 'None', hint, expanded, onToggle, right, locked, lockedHint, children,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handleToggle = () => {
    haptics.tap();
    animateLayout();
    onToggle();
  };

  if (locked) {
    return (
      <View style={styles.section}>
        <View style={styles.header} accessibilityLabel={`${label}: ${summary || emptySummary}. ${lockedHint ?? ''}`}>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.spacer} />
          <Text style={[styles.summary, styles.summaryLocked, !summary && styles.summaryEmpty]} numberOfLines={1}>
            {summary || emptySummary}
          </Text>
        </View>
        {!!lockedHint && <Text style={styles.hint}>{lockedHint}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.header}
        onPress={handleToggle}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${label}${summary ? `: ${summary}` : ''}`}
      >
        <Text style={styles.label}>{label}</Text>
        <View style={styles.spacer} />
        {right}
        {!expanded && (
          <Text style={[styles.summary, !summary && styles.summaryEmpty]} numberOfLines={1}>
            {summary || emptySummary}
          </Text>
        )}
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.textTertiary}
        />
      </TouchableOpacity>
      {expanded && (
        <>
          {!!hint && <Text style={styles.hint}>{hint}</Text>}
          {children}
        </>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  section: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  label: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  spacer: { flex: 1 },
  summary: {
    flexShrink: 1, textAlign: 'right',
    color: colors.accent, fontSize: font.sm, fontWeight: '500',
  },
  summaryEmpty: { color: colors.textTertiary, fontWeight: '400' },
  // Not accent: accent is what "you can change this" looks like everywhere
  // else in these editors.
  summaryLocked: { color: colors.textSecondary },
  hint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 16,
    marginTop: spacing.xs,
  },
});
