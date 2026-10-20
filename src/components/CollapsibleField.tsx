import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, interaction, type Colors } from '../theme';
import { disclosureValue } from '../theme/textStyles';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { useSettingsStore } from '../store/useSettingsStore';
import { RotatingChevron } from './RotatingChevron';

interface Props {
  /** Uppercase section label, e.g. "Category". */
  label: string;
  /**
   * Draws the header as an `EditorRow` does (an icon, the label in sentence
   * case, the value in accent) instead of the uppercase label, so a form can
   * mix the two without two looks for one kind of row. With it, the hint sits
   * under the label whenever nothing is shown on the right, as EditorRow's
   * does, and `emptySummary` shows only when the caller passes one: a bare
   * "None" beside an icon row says nothing a missing value doesn't.
   */
  icon?: string;
  /**
   * The current value, rendered on the header row while collapsed so the
   * field reads as a summary until you actually want to change it.
   * Omit for "nothing chosen yet".
   */
  summary?: string;
  /** Shown in place of the summary when the field has no value. Defaults to "None" without `icon`. */
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
  label, icon, summary, emptySummary, hint, expanded, onToggle, right, locked, lockedHint, children,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hideHelpText = useSettingsStore(s => s.hideHelpText);

  const handleToggle = () => {
    haptics.tap();
    animateLayout();
    onToggle();
  };

  if (icon) {
    const shown = expanded ? undefined : (summary || emptySummary);
    const showHint = !!hint && !hideHelpText && (expanded || !shown);
    const iconColor = summary ? colors.accent : colors.textSecondary;
    if (locked) {
      return (
        <View
          style={[styles.iconSection, styles.iconHeader]}
          accessibilityLabel={`${label}: ${summary || emptySummary || 'None'}. ${lockedHint ?? ''}`}
        >
          <Ionicons name={icon as never} size={18} color={colors.textSecondary} />
          <View style={styles.iconContentShrink}>
            <Text style={styles.iconLabel}>{label}</Text>
            {!!lockedHint && <Text style={styles.iconHint}>{lockedHint}</Text>}
          </View>
          <Text style={[styles.summary, styles.summaryLocked, !summary && styles.summaryEmpty]} numberOfLines={1}>
            {summary || emptySummary}
          </Text>
        </View>
      );
    }
    // The content gives way only while it holds a hint, which has to wrap to
    // the row's width. Beside a value the label keeps its natural width and the
    // value truncates instead, the same split EditorRow makes.
    return (
      <View style={styles.iconSection}>
        <TouchableOpacity
          style={[styles.iconHeader, expanded && styles.headerExpanded]}
          onPress={handleToggle}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${label}${summary ? `: ${summary}` : ''}`}
        >
          <Ionicons name={icon as never} size={18} color={iconColor} />
          <View style={showHint ? styles.iconContentShrink : styles.iconContent}>
            <Text style={styles.iconLabel}>{label}</Text>
            {showHint && <Text style={styles.iconHint}>{hint}</Text>}
          </View>
          <View style={styles.iconValueRow}>
            {right}
            {!!shown && (
              <Text style={[styles.summary, !summary && styles.summaryEmpty]} numberOfLines={1}>
                {shown}
              </Text>
            )}
            <RotatingChevron open={expanded} size={14} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
        {expanded && children}
      </View>
    );
  }

  const emptyText = emptySummary ?? 'None';

  if (locked) {
    // Label, value, then hint, each on its own full-width line. Beside the
    // value the hint was left a narrow column and wrapped to six lines, and
    // the value floated at a different height in every row.
    return (
      <View style={styles.section}>
        <View
          style={styles.lockedRow}
          accessibilityLabel={`${label}: ${summary || emptyText}. ${lockedHint ?? ''}`}
        >
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.summary, styles.summaryLocked, styles.lockedValue, !summary && styles.summaryEmpty]}>
            {summary || emptyText}
          </Text>
          {!!lockedHint && <Text style={[styles.hint, styles.lockedHint]}>{lockedHint}</Text>}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={[styles.header, expanded && styles.headerExpanded]}
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
            {summary || emptyText}
          </Text>
        )}
        <RotatingChevron open={expanded} size={14} color={colors.textSecondary} />
      </TouchableOpacity>
      {expanded && (
        <>
          {!!hint && !hideHelpText && <Text style={[styles.hint, styles.hintSpaced]}>{hint}</Text>}
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
  // Only while something renders below the header — the hint, or straight to
  // the controls when there's no hint (or it's hidden). Applying this
  // unconditionally would also pad a collapsed field's bottom, stacking with
  // `section`'s own paddingVertical.
  headerExpanded: { marginBottom: spacing.sm },
  lockedRow: { gap: spacing.xs },
  lockedValue: { textAlign: 'left' },
  lockedHint: { marginTop: spacing.xxs },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  spacer: { flex: 1 },
  summary: {
    ...disclosureValue(colors),
    flexShrink: 1, textAlign: 'right',
  },
  summaryEmpty: { color: colors.textTertiary, fontWeight: '400' },
  // Not accent: accent is what "you can change this" looks like everywhere
  // else in these editors.
  summaryLocked: { color: colors.textSecondary },
  hint: {
    color: colors.textSecondary, fontSize: font.xs, lineHeight: 16,
  },
  /**
   * Only when something follows it. An expanded field is always hint-then-
   * controls, and with no gap the sentence explaining the field reads as a
   * caption on the first pill instead of on the group. `lockedHint` is the
   * last thing in its section, so it takes the bare style.
   */
  hintSpaced: { marginBottom: spacing.sm },
  // The `icon` header, measured off EditorRow's row so the two line up: the
  // same 13pt of vertical padding, 16pt gaps, 18pt icon, and so the same 50pt
  // separator inset EditorGroup draws between them.
  iconSection: { paddingHorizontal: spacing.md, paddingVertical: 13 },
  iconHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconContent: { flexGrow: 1, flexShrink: 0 },
  iconContentShrink: { flexGrow: 1, flexShrink: 1 },
  iconLabel: { color: colors.text, fontSize: font.md },
  iconHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: 1 },
  iconValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
});
