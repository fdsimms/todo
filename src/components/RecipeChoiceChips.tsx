import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ChoiceGroup } from '../utils/recipeComponents';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  group: ChoiceGroup;
  /** The option to draw as chosen, or null while none of them should read as picked. */
  activeOptionId: string | null;
  onPick: (optionId: string) => void;
  /** A chip after the recipe's own options — RecipeToListSheet's "Decide at the store". */
  extraChip?: React.ReactNode;
  hint?: string | null;
}

/**
 * One recipe choice group as a label and a row of tappable chips, the active
 * option filled. Shared between `RecipeToListSheet` (paired with a "Decide at
 * the store" chip) and `RecipeDetailScreen`'s own cost/nutrition picker, so
 * the two don't drift into two chip treatments for the one either/or concept.
 */
export function RecipeChoiceChips({ group, activeOptionId, onPick, extraChip, hint }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.group}>
      <Text style={styles.sectionLabel}>{group.label}</Text>
      <View style={styles.chips}>
        {group.options.map(option => {
          const on = option.id === activeOptionId;
          const name = option.name || 'Deleted recipe';
          return (
            <TouchableOpacity
              key={option.id}
              style={[styles.chip, on && styles.chipOn]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); onPick(option.id); }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${group.label}: ${name}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{name}</Text>
            </TouchableOpacity>
          );
        })}
        {extraChip}
      </View>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    group: { gap: spacing.xs },
    sectionLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chipOn: { backgroundColor: colors.accentFill },
    chipText: { color: colors.textSecondary, fontSize: font.sm },
    chipTextOn: { color: colors.onAccent, fontWeight: fontWeight.medium },
    hint: { color: colors.textTertiary, fontSize: font.xs },
  });
}
