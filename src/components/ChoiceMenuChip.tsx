import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { CardSheet, type CardAnchor } from './CardSheet';

export interface ChoiceOption {
  key: string;
  label: string;
}

export interface ChoiceGroup {
  /** Uppercase caption over the group. Omit for a group that needs none. */
  heading?: string;
  options: ChoiceOption[];
}

interface Props {
  groups: ChoiceGroup[];
  /** The chosen option's key, or null while nothing is. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** What the control picks ("Unit", "Nutrient"), for the screen reader. */
  noun: string;
  /** For `SheetModal`'s development warnings. */
  name: string;
  /** What the chip says when `selectedKey` matches no option. Defaults to `noun`. */
  fallbackLabel?: string;
  /** Overrides the chip's text, for a state no option names ("Other"). */
  labelOverride?: string;
  /**
   * `chip` is a small pill that sits inside or beside a field. `field` is a
   * full-width select row, for a pick that has no number to sit beside.
   */
  variant?: 'chip' | 'field';
  /** The fill, one step off the surface it sits on. Defaults to a card's `bgSecondary` for a chip and `bgTertiary` for a field. */
  background?: string;
}

/**
 * One value out of a long or mixed set, chosen from a popover menu opened by a
 * chip or a select row. The shape the unit beside an amount (`UnitMenuChip`),
 * a dose's unit, and a metric picker share: a segmented track or a wrapping
 * grid makes a set of ten or thirteen read as that many equal choices and is
 * heavier than the field it sits beside. Small closed sets (three or four) stay
 * in a `SegmentedControl`, where seeing every option is the point.
 *
 * The menu is a popover `CardSheet`, so a caller renders this inside its own
 * sheet's children, which is what lets one Modal present from the other.
 */
export function ChoiceMenuChip({
  groups, selectedKey, onSelect, noun, name, fallbackLabel, labelOverride, variant = 'chip', background,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CardAnchor | null>(null);

  const selected = groups.flatMap(g => g.options).find(o => o.key === selectedKey);
  const label = labelOverride ?? selected?.label ?? fallbackLabel ?? noun;
  const isField = variant === 'field';

  return (
    <>
      <TouchableOpacity
        style={[isField ? styles.field : styles.chip, background ? { backgroundColor: background } : null]}
        activeOpacity={interaction.activeOpacity}
        onPress={e => {
          haptics.tap();
          setAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${noun}: ${label}. Change ${noun.toLowerCase()}`}
      >
        <Text style={isField ? styles.fieldText : styles.chipText}>{label}</Text>
        <Ionicons name="chevron-down" size={iconSize.sm} color={colors.textSecondary} />
      </TouchableOpacity>
      <CardSheet
        name={name}
        visible={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        popoverWidth={220}
        scrimLabel={`Close ${noun.toLowerCase()} menu`}
      >
        {close => (
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <View style={styles.menu}>
              {groups.map((group, i) => (
                <React.Fragment key={group.heading ?? `group-${i}`}>
                  {!!group.heading && <Text style={styles.header}>{group.heading}</Text>}
                  {group.options.map(option => {
                    const on = selectedKey === option.key;
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={styles.row}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => {
                          haptics.tap();
                          close(() => onSelect(option.key));
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={option.label}
                      >
                        <Text style={[styles.rowText, on && styles.rowTextOn]}>{option.label}</Text>
                        {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accentText} />}
                      </TouchableOpacity>
                    );
                  })}
                </React.Fragment>
              ))}
            </View>
          </ScrollView>
        )}
      </CardSheet>
    </>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
      backgroundColor: colors.bgSecondary,
    },
    chipText: { color: colors.text, fontSize: font.sm },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
      borderRadius: radius.md,
      backgroundColor: colors.bgTertiary,
    },
    fieldText: { color: colors.text, fontSize: font.md, flexShrink: 1 },
    menu: { paddingVertical: spacing.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    rowText: { color: colors.text, fontSize: font.md },
    rowTextOn: { color: colors.accentText, fontWeight: fontWeight.semibold },
    header: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.smd,
      paddingBottom: spacing.xs,
    },
  });
}
