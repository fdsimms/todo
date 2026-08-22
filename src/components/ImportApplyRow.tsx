import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, interaction, checkboxRadius,
  type Colors,
} from '../theme';
import { AnimatedCollapsible } from './AnimatedCollapsible';
import { previewToggleLabel, type ImportPreviewLine } from '../utils/recipeImportPreview';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  checked: boolean;
  onToggle: () => void;
  title: string;
  /** The one-line summary under the title: "7 steps", "Serves 4", the site name. */
  meta?: string | null;
  accessibilityLabel: string;
  /**
   * What ticking this row would actually write, unfolded on request. Omit (or
   * pass an empty list) for a row whose whole content already fits in `title`
   * and `meta` — servings and attribution both do — and no disclosure is drawn.
   */
  preview?: ImportPreviewLine[];
  /** Numbered 1..N rather than bulleted. The method is ordered; prep tasks aren't. */
  ordered?: boolean;
  /** What the preview holds, for the disclosure's label: "step", "task". */
  previewNoun?: string;
}

/**
 * One tick-to-apply row of a recipe-import review list — the servings, the
 * method, the prep tasks, where it's from — shared by `RecipeCreateSheet` and
 * `RecipeExtractSheet` alongside the `ExtractedIngredientRow` that handles the
 * ingredients themselves.
 *
 * **The preview is the point of the component** (#1618). These rows used to be
 * a title and a count, so "Method — 7 steps" was the entire review you got of
 * seven paragraphs about to be written into your recipe, and prep tasks were
 * seven words about tasks the app would schedule for you days ahead. The
 * ingredients had been reviewable line by line since #1608; the method and the
 * prep tasks were the two things you had to take on trust.
 *
 * Collapsed by default, because the ingredient list below is the longer half of
 * the sheet and a method expanded on arrival pushes it off screen — the same
 * progressive-disclosure trade every editor here makes. The preview is
 * read-only: correcting a step belongs in the recipe's own editor, where
 * there's room for it, and an import sheet that could also rewrite the method
 * would be two screens wearing one hat.
 *
 * The checkbox and the disclosure are separate tap zones — the same split
 * `ExtractedIngredientRow` makes between ticking a line and editing it, for the
 * same reason: one tap can't mean both "don't add this" and "let me look at
 * it". The row's body toggles the tick, so a row with nothing to unfold
 * behaves exactly as it did before this existed.
 */
export function ImportApplyRow({
  checked, onToggle, title, meta, accessibilityLabel,
  preview, ordered = false, previewNoun = 'line',
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);

  const lines = preview ?? [];
  const hasPreview = lines.length > 0;

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <TouchableOpacity
          style={styles.tapZone}
          activeOpacity={interaction.activeOpacity}
          onPress={() => { haptics.tap(); onToggle(); }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={accessibilityLabel}
        >
          <View style={[styles.checkbox, checked && styles.checkboxOn]}>
            {checked && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
          </View>
          <View style={styles.body}>
            <Text style={styles.name}>{title}</Text>
            {!!meta && <Text style={styles.meta}>{meta}</Text>}
          </View>
        </TouchableOpacity>

        {hasPreview && (
          <TouchableOpacity
            style={styles.disclosure}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); setExpanded(v => !v); }}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={previewToggleLabel(expanded, lines.length, previewNoun)}
          >
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={iconSize.sm}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {hasPreview && (
        <AnimatedCollapsible expanded={expanded}>
          <View style={styles.preview}>
            {lines.map((line, i) => (
              <View key={`${line.text}-${i}`} style={styles.previewLine}>
                <Text style={styles.previewIndex}>{ordered ? `${i + 1}.` : '•'}</Text>
                <View style={styles.previewBody}>
                  <Text style={styles.previewText}>{line.text}</Text>
                  {!!line.lead && <Text style={styles.previewLead}>{line.lead}</Text>}
                </View>
              </View>
            ))}
          </View>
        </AnimatedCollapsible>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    block: { marginVertical: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    // The tick zone takes the whole row bar the chevron, so the target is the
    // width it looks like rather than the checkbox alone.
    tapZone: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    disclosure: { paddingLeft: spacing.sm },
    // Sunken rather than another card: the lines are what the row above would
    // write, not more rows to decide about, and a second card surface under a
    // card reads as a nested list of choices.
    preview: {
      backgroundColor: colors.bgSunken,
      marginHorizontal: spacing.md,
      marginTop: 2,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    previewLine: { flexDirection: 'row', gap: spacing.sm },
    previewIndex: {
      fontSize: font.sm,
      color: colors.textTertiary,
      fontWeight: fontWeight.medium,
      minWidth: 18,
    },
    previewBody: { flex: 1 },
    previewText: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
    previewLead: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
  });
}
