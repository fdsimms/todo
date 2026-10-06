import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { settingsGroup, type SettingsEntry } from '../utils/settingsIndex';
import { navigateToSettingsEntry } from '../navigation/openSettings';

export interface ScreenSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  anchor: CardAnchor | null;
  /** "Calendar settings", shown above the rows. */
  title: string;
  /** From `screenSettingsEntries`, in the order they're listed. */
  entries: SettingsEntry[];
  /**
   * Rows that open one of the screen's own sheets rather than a Settings row,
   * listed above `entries`. For a screen whose list settings live in a sheet
   * (Groceries: aisles, stores, sorting) so the gear is the one way in.
   */
  extraRows?: { id: string; label: string; hint: string; onPress: () => void }[];
}

/**
 * A screen's own settings, named, from its gear: each row opens that exact
 * row in Settings, highlighted, and "All settings" opens the top of Settings.
 *
 * A list rather than one jump because most screens have two or three settings
 * that belong to them, and a gear that opens one of them hides the rest. The
 * subtitle is the group the row lives in, which is also where it can be found
 * again without this.
 */
export function ScreenSettingsSheet({ visible, onClose, anchor, title, entries, extraRows }: ScreenSettingsSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();
  const card = useCardSheet();

  const open = (entryId: string | null) => {
    haptics.tap();
    card.close(() => {
      if (entryId) navigateToSettingsEntry(navigation, entryId);
      else (navigation as never as { navigate: (name: string) => void }).navigate('Settings');
    });
  };

  return (
    <CardSheet
      name="ScreenSettingsSheet"
      visible={visible}
      onClose={onClose}
      controller={card}
      anchor={anchor}
      popoverWidth={300}
      scrimLabel="Close settings"
    >
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{title}</Text>
        {(extraRows ?? []).map(row => (
          <React.Fragment key={row.id}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => { haptics.tap(); card.close(row.onPress); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}, ${row.hint}`}
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowHint}>{row.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
            <View style={styles.sep} />
          </React.Fragment>
        ))}
        {entries.map(entry => {
          const group = settingsGroup(entry.groupId)?.title ?? 'Settings';
          return (
            <React.Fragment key={entry.id}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => open(entry.id)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${entry.label}, in ${group}`}
                accessibilityHint="Opens it in Settings"
              >
                <View style={styles.rowBody}>
                  <Text style={styles.rowLabel}>{entry.label}</Text>
                  <Text style={styles.rowHint}>In {group}</Text>
                </View>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
              <View style={styles.sep} />
            </React.Fragment>
          );
        })}
        <TouchableOpacity
          style={styles.row}
          onPress={() => open(null)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="All settings"
        >
          <Text style={[styles.rowLabel, styles.allLabel]}>All settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  title: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.smd,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 44,
  },
  rowBody: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: font.md },
  rowHint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  allLabel: { color: colors.accent },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
});
