import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ChoiceGroup } from '../utils/recipeComponents';
import { useColors } from '../theme/ThemeContext';
import Ionicons from '@expo/vector-icons/Ionicons';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { HelpText } from './HelpText';

interface Props {
  group: ChoiceGroup;
  /** The option to draw as chosen, or null while none of them should read as picked. */
  activeOptionId: string | null;
  onPick: (optionId: string) => void;
  /** A chip after the recipe's own options — RecipeToListSheet's "Decide at the store". */
  extraChip?: React.ReactNode;
  hint?: string | null;
  /**
   * What the chips sit on. `'page'` (the default) is the screen background, so
   * an unpicked chip is a `bgSecondary` card; `'card'` is for chips inside a
   * `bgSecondary` surface already (cook mode's ingredient panel), where that
   * same fill would vanish into it.
   */
  surface?: 'page' | 'card';
  /** Makes the group's name a button that renames it. Omitted where the group isn't editable. */
  onRename?: () => void;
}

/**
 * One recipe choice group as a label and a row of tappable chips, the active
 * option filled. Shared between `RecipeToListSheet` (paired with a "Decide at
 * the store" chip) and `RecipeDetailScreen`'s own cost/nutrition picker, so
 * the two don't drift into two chip treatments for the one either/or concept.
 */
export function RecipeChoiceChips({
  group, activeOptionId, onPick, extraChip, hint, surface = 'page', onRename,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.group, surface === 'page' && styles.groupCard]}>
      {onRename ? (
        <TouchableOpacity
          style={styles.labelRow}
          activeOpacity={interaction.activeOpacity}
          onPress={onRename}
          accessibilityRole="button"
          accessibilityLabel={`Group name, ${group.label}`}
          accessibilityHint="Double tap to rename this group"
        >
          <Text style={[styles.sectionLabel, styles.labelText]}>{group.label}</Text>
          <Ionicons name="create-outline" size={iconSize.xs} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : (
        <Text style={styles.sectionLabel}>{group.label}</Text>
      )}
      <Text style={styles.prompt}>Pick one</Text>
      <View style={styles.chips}>
        {group.options.map(option => {
          const on = option.id === activeOptionId;
          const name = option.name || 'Deleted recipe';
          return (
            <TouchableOpacity
              key={option.id}
              style={[styles.chip, surface === 'card' && styles.chipOnCard, on && styles.chipOn]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); onPick(option.id); }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${group.label}: ${name}`}
            >
              <Ionicons
                name={on ? 'radio-button-on' : 'radio-button-off'}
                size={iconSize.xs}
                color={on ? colors.onAccent : colors.controlBorder}
              />
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
            </TouchableOpacity>
          );
        })}
        {extraChip}
      </View>
      {!!hint && <HelpText style={styles.hint}>{hint}</HelpText>}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    group: { gap: spacing.xs },
    // On the page the group is its own card, so the question and its answers
    // read as one thing; inside cook mode's panel the panel is already the card.
    groupCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.smd,
      gap: spacing.xsm,
    },
    prompt: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
    labelText: { flexShrink: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bg,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chipOnCard: { backgroundColor: colors.bgTertiary },
    chipOn: { backgroundColor: colors.accentFill },
    chipText: { color: colors.textSecondary, fontSize: font.sm },
    chipTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
    hint: { color: colors.textTertiary, fontSize: font.xs },
  });
}
