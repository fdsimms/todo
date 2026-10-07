import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, interaction, border, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** Where the "…" button was clicked, so the card opens from it. */
  anchor?: CardAnchor | null;
  /** The row's swipe-right "when" action. Omitted where the row has none. */
  onWhen?: () => void;
  /** The row's swipe-left action: enter bulk editing with this row selected. */
  onSelect?: () => void;
  /** A list line's swipe-right delete, offered in place of `onWhen`. */
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * What a row's swipes do, as a menu behind a "…" button, for iPhone Mirroring
 * (`mirroringMode`). From a Mac a swipe is a click-drag on a trackpad or mouse,
 * which works but is clumsy and announced nowhere, and the select swipe is the
 * only way into bulk editing from a row. Offers exactly what `SwipeableRow`
 * would for the same row and nothing more, so the two can't disagree: the
 * caller passes the same handlers and the same conditions.
 */
export function SwipeActionsMenu({ visible, anchor, onWhen, onSelect, onDelete, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const options: { key: string; icon: keyof typeof Ionicons.glyphMap; color: string; label: string; run: () => void }[] = [];
  if (onDelete) options.push({ key: 'delete', icon: 'trash-outline', color: colors.redText, label: 'Delete', run: onDelete });
  else if (onWhen) options.push({ key: 'when', icon: 'time-outline', color: colors.orangeText, label: 'Reschedule', run: onWhen });
  if (onSelect) options.push({ key: 'select', icon: 'checkmark-circle-outline', color: colors.accent, label: 'Select', run: onSelect });

  return (
    <CardSheet
      name="SwipeActionsMenu"
      visible={visible}
      controller={card}
      onClose={onClose}
      onRequestClose={() => card.close()}
      anchor={anchor}
      popoverWidth={220}
      scrimLabel="Close menu"
    >
      {options.map((option, i) => (
        <React.Fragment key={option.key}>
          {i > 0 && <View style={styles.sep} />}
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { haptics.tap(); card.close(option.run); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={option.label}
          >
            <Ionicons name={option.icon} size={iconSize.md} color={option.color} />
            <Text style={[styles.label, option.key === 'delete' && { color: colors.redText }]}>{option.label}</Text>
          </TouchableOpacity>
        </React.Fragment>
      ))}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  label: {
    flex: 1,
    color: colors.text,
    fontSize: font.lg,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
});
