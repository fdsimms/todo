import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Where the "..." was tapped, so the menu opens from it. See `CardSheet`. */
  anchor?: CardAnchor | null;
  isList: boolean;
  onConvert: () => void;
}

/**
 * The project page's overflow ("...") menu. Today it holds one row: changing
 * the page between a project and a list. The kind is chosen when one is made
 * (quick add's Project/List control), so converting is a rare action and lives
 * behind a menu rather than as a header toggle that made a list look like a
 * project with a switch on.
 */
export function ProjectPageMenu({ visible, onClose, anchor, isList, onConvert }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  return (
    <CardSheet
      name="ProjectPageMenu"
      visible={visible}
      onClose={onClose}
      controller={card}
      anchor={anchor}
      popoverWidth={300}
      scrimLabel="Close menu"
    >
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          haptics.tap();
          card.close(onConvert);
        }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={isList ? 'Convert to project' : 'Convert to list'}
      >
        <Ionicons name={isList ? 'briefcase-outline' : 'list-outline'} size={18} color={colors.textSecondary} />
        <View style={styles.content}>
          <Text style={styles.label}>{isList ? 'Convert to project' : 'Convert to list'}</Text>
          <Text style={styles.hint}>
            {isList
              ? 'Adds a finish line and a progress bar'
              : 'No finish line or progress bar. Items are checked off and reused'}
          </Text>
        </View>
      </TouchableOpacity>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  content: { flex: 1 },
  label: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  hint: { color: colors.textTertiary, fontSize: font.sm, marginTop: spacing.xxs },
});
