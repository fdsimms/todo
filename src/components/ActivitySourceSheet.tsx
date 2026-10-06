import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

export interface ActivitySourceOption {
  key: string;
  label: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The sources that have written something, in the order to list them. */
  options: readonly ActivitySourceOption[];
  /** The chosen source's key, or null for all of them. */
  selected: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * The Activity screen's source filter: one row per generator that has written
 * something, with "All sources" first.
 *
 * A list in a card rather than a row of pills on the screen, because the set
 * runs to a dozen or more and the pills took half the page before the first
 * entry. Picking one applies it and closes, so there is nothing to confirm.
 */
export function ActivitySourceSheet({ visible, onClose, options, selected, onSelect }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const { height } = useWindowDimensions();

  const dismiss = (after?: () => void) => card.close(() => { after?.(); onClose(); });
  const pick = (key: string | null) => {
    haptics.tap();
    dismiss(() => onSelect(key));
  };

  const row = (key: string | null, label: string) => {
    const isSelected = selected === key;
    return (
      <TouchableOpacity
        key={key ?? 'all'}
        style={styles.row}
        activeOpacity={interaction.activeOpacity}
        onPress={() => pick(key)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: isSelected }}
      >
        <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]} numberOfLines={2}>
          {label}
        </Text>
        {isSelected && <Ionicons name="checkmark" size={iconSize.md} color={colors.accent} />}
      </TouchableOpacity>
    );
  };

  return (
    <CardSheet
      name="ActivitySourceSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerSide} />
          <Text style={styles.heading}>Source</Text>
          <SheetHeaderButton label="Done" onPress={() => dismiss()} minWidth={56} style={styles.headerRight} />
        </View>
        <ScrollView style={{ maxHeight: height * 0.6 }} contentContainerStyle={styles.list}>
          {row(null, 'All sources')}
          {options.map(o => row(o.key, o.label))}
        </ScrollView>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerSide: { minWidth: 56 },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  list: { paddingHorizontal: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.smd,
  },
  rowLabel: { flex: 1, color: colors.text, fontSize: font.md },
  rowLabelSelected: { fontWeight: fontWeight.semibold },
});
