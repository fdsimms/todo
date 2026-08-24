import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, interaction, checkboxRadius,
  type Colors,
} from '../theme';
import { TITLE_MAX_LENGTH } from '../types';
import { AnimatedCollapsible } from './AnimatedCollapsible';
import { CountStepper } from './CountStepper';
import { InlineEditableText } from './InlineEditableText';
import { previewToggleLabel, type ImportPreviewLine } from '../utils/recipeImportPreview';
import { PREP_OFFSET_MIN, PREP_OFFSET_MAX } from '../utils/recipeUtils';
import { formatOffsetLabel } from '../utils/templateUtils';
import { type PendingEdits } from '../hooks/usePendingEdits';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;
const LINE_CHECKBOX_SIZE = 18;

interface Props {
  checked: boolean;
  onToggle: () => void;
  /** The row's heading. Static ("Method"); the editable values live in `children`. */
  title: string;
  /** The one-line summary under the title: "5 of 7 steps", "Serves 4". */
  meta?: string | null;
  accessibilityLabel: string;
  /**
   * Fields belonging to the row itself rather than to its preview — the
   * servings text, the site name. Rendered in place of `title`'s subtitle, so
   * a row whose whole content is two editable values needs no preview at all.
   */
  children?: React.ReactNode;
  /**
   * What ticking this row would write, unfolded on request and correctable in
   * place. Omit for a row that has no list behind it.
   */
  preview?: ImportPreviewLine[];
  /** Which preview lines are ticked. Unticked ones are left out of the import. */
  acceptedLines?: Set<number>;
  onToggleLine?: (index: number) => void;
  onEditLine?: (index: number, text: string) => void;
  /** Only for prep tasks; a method step has no timing to change. */
  onEditLead?: (index: number, offsetDays: number) => void;
  /** Numbered 1..N rather than bulleted. The method is ordered; prep tasks aren't. */
  ordered?: boolean;
  /** What the preview holds, for the disclosure's label: "step", "task". */
  previewNoun?: string;
  edits?: PendingEdits;
  /** Namespaces this row's fields in the `PendingEdits` registry. */
  editKeyPrefix?: string;
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
 * ingredients had been correctable line by line since #1608; the method and
 * the prep tasks were the two things you had to take on trust.
 *
 * So every line is now the same kind of thing an ingredient row already was:
 * tap it to retype it, untick it to leave it out. A model's read of a page is
 * a first draft in both directions — it invents a step's wording *and* it
 * picks up "Print this recipe" as if it were one — and a review list that can
 * only accept or reject the whole method makes you choose between a bad step
 * and no method.
 *
 * Collapsed by default, because the ingredient list below is the longer half of
 * the sheet and a method expanded on arrival pushes it off screen — the same
 * progressive-disclosure trade every editor here makes.
 *
 * The checkbox and the disclosure are separate tap zones — the same split
 * `ExtractedIngredientRow` makes between ticking a line and editing it, for the
 * same reason: one tap can't mean both "don't add this" and "let me look at
 * it". The row's body toggles the tick, so a row with nothing to unfold
 * behaves exactly as it did before any of this existed.
 */
export function ImportApplyRow({
  checked, onToggle, title, meta, accessibilityLabel, children,
  preview, acceptedLines, onToggleLine, onEditLine, onEditLead,
  ordered = false, previewNoun = 'line', edits, editKeyPrefix = 'row',
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
          onPress={() => { haptics.tap(); onToggle(); }}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel={accessibilityLabel}
        >
          <View style={[styles.checkbox, checked && styles.checkboxOn]}>
            {checked && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
          </View>
        </TouchableOpacity>

        {/* The heading and its summary toggle the tick; the editable fields
            below them don't — a tap meant for the servings box must not be
            read as "leave the servings out". That's why `children` sits
            outside the touchable rather than the whole body being one. */}
        <View style={styles.body}>
          <TouchableOpacity
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); onToggle(); }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={accessibilityLabel}
          >
            <Text style={styles.name}>{title}</Text>
            {!!meta && <Text style={styles.meta}>{meta}</Text>}
          </TouchableOpacity>
          {children}
        </View>

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
            {lines.map((line, i) => {
              const lineChecked = acceptedLines?.has(i) ?? true;
              return (
                <View key={`${editKeyPrefix}-${i}`} style={styles.previewLine}>
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); onToggleLine?.(i); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: lineChecked }}
                    accessibilityLabel={line.text}
                  >
                    <View style={[styles.lineCheckbox, lineChecked && styles.checkboxOn]}>
                      {lineChecked && (
                        <Ionicons name="checkmark" size={12} color={colors.onAccent} />
                      )}
                    </View>
                  </TouchableOpacity>

                  {ordered && <Text style={styles.previewIndex}>{i + 1}.</Text>}

                  <View style={styles.previewBody}>
                    {edits ? (
                      <InlineEditableText
                        edits={edits}
                        editKey={`${editKeyPrefix}:${i}:text`}
                        value={line.text}
                        onCommit={text => onEditLine?.(i, text)}
                        textStyle={[styles.previewText, !lineChecked && styles.dropped]}
                        accessibilityLabel={previewNoun === 'step' ? `step ${i + 1}` : line.text}
                        maxLength={TITLE_MAX_LENGTH}
                        multiline={ordered}
                      />
                    ) : (
                      <Text style={[styles.previewText, !lineChecked && styles.dropped]}>
                        {line.text}
                      </Text>
                    )}

                    {line.offsetDays !== null && (
                      onEditLead ? (
                        <CountStepper
                          value={line.offsetDays}
                          onChange={n => onEditLead(i, n ?? -1)}
                          min={PREP_OFFSET_MIN}
                          max={PREP_OFFSET_MAX}
                          format={n => formatOffsetLabel(n)}
                          label={`Days before the meal for ${line.text}`}
                          style={styles.leadStepper}
                        />
                      ) : (
                        <Text style={styles.previewLead}>{formatOffsetLabel(line.offsetDays)}</Text>
                      )
                    )}
                  </View>
                </View>
              );
            })}
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
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      borderRadius: radius.md,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
    },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lineCheckbox: {
      width: LINE_CHECKBOX_SIZE,
      height: LINE_CHECKBOX_SIZE,
      borderRadius: checkboxRadius(LINE_CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    checkboxOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    body: { flex: 1, gap: 2 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary },
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
    previewLine: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
    previewIndex: {
      fontSize: font.sm,
      lineHeight: 20,
      color: colors.textTertiary,
      fontWeight: fontWeight.medium,
      minWidth: 16,
    },
    previewBody: { flex: 1, gap: spacing.xs },
    previewText: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
    // A line that won't be added, still legible so it can be turned back on.
    dropped: { color: colors.textTertiary, textDecorationLine: 'line-through' },
    previewLead: { fontSize: font.xs, color: colors.textTertiary },
    leadStepper: { alignSelf: 'flex-start' },
  });
}
