import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export interface ActionMenuChoice {
  key: string;
  label: string;
  onPress: () => void;
}

export interface ActionMenuAction {
  key: string;
  label: string;
  /** Omitted for a plain list of choices, which then has no icon column. */
  icon?: IconName;
  /** Runs once the menu has finished closing. Omit when `choices` is given. */
  onPress?: () => void;
  /** Opens a second list inside the same card, with a back row, instead of acting. */
  choices?: ActionMenuChoice[];
  /** Drawn in red in its own group below the others. */
  destructive?: boolean;
}

interface Props {
  visible: boolean;
  /** What the menu is about; shown at the top and kept while the card fades out. */
  title: string;
  /** A line under the title saying what the options will do. */
  message?: string;
  actions: ActionMenuAction[];
  /** Where the "…" or the row was tapped, so the menu opens from it; null centers it. */
  anchor?: CardAnchor | null;
  onClose: () => void;
}

/**
 * A row's "…" menu: a short list of actions in a popover, in place of the
 * system alert a list of buttons used to be. An action runs after the card has
 * left (so a sheet it opens never shares a commit with this one), and an action
 * with `choices` swaps the card's content for that list rather than raising a
 * second dialog. Destructive actions sit in their own group at the bottom.
 */
export function ActionMenu({ visible, title, message, actions, anchor, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setOpenKey(null);
  }, [visible]);

  const submenu = openKey ? actions.find(a => a.key === openKey) : undefined;
  const regular = actions.filter(a => !a.destructive);
  const destructive = actions.filter(a => a.destructive);

  const run = (action: ActionMenuAction) => {
    if (action.choices) {
      haptics.tap();
      setOpenKey(action.key);
      return;
    }
    if (action.destructive) haptics.warning();
    else haptics.tap();
    card.close(action.onPress);
  };

  const renderRow = (action: ActionMenuAction, first: boolean) => (
    <React.Fragment key={action.key}>
      {!first && <View style={styles.sep} />}
      <TouchableOpacity
        style={styles.row}
        onPress={() => run(action)}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={action.label}
      >
        {action.icon && <Ionicons name={action.icon} size={18} color={action.destructive ? colors.red : colors.accent} />}
        <Text style={[styles.label, action.destructive && styles.labelDestructive]}>{action.label}</Text>
        {action.choices && <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} style={styles.chevron} />}
      </TouchableOpacity>
    </React.Fragment>
  );

  return (
    <CardSheet
      name="ActionMenu"
      visible={visible}
      controller={card}
      onClose={onClose}
      anchor={anchor}
      popoverWidth={300}
      scrimLabel="Close menu"
    >
      {submenu?.choices ? (
        <ScrollView style={styles.scroll} bounces={false}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => { haptics.tap(); setOpenKey(null); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={18} color={colors.accent} />
            <Text style={styles.label}>{submenu.label}</Text>
          </TouchableOpacity>
          {submenu.choices.map(choice => (
            <React.Fragment key={choice.key}>
              <View style={styles.sep} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => { haptics.tap(); card.close(choice.onPress); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
              >
                <Text style={[styles.label, styles.choiceLabel]}>{choice.label}</Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </ScrollView>
      ) : (
        <ScrollView style={styles.scroll} bounces={false}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.sep} />
          {regular.map((action, i) => renderRow(action, i === 0))}
          {destructive.length > 0 && (
            <View style={styles.destructiveGroup}>
              {destructive.map((action, i) => renderRow(action, i === 0))}
            </View>
          )}
        </ScrollView>
      )}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  scroll: { flexShrink: 1 },
  title: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
  },
  message: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.smd,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  label: {
    flex: 1,
    color: colors.accent,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  // A slot choice has no icon, so it lines up with the labels above it.
  choiceLabel: { paddingLeft: spacing.lg - spacing.xsm },
  labelDestructive: { color: colors.redText },
  chevron: { marginLeft: 'auto' },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  // Same group break `LogbookEntryMenu` draws before its Delete.
  destructiveGroup: { borderTopWidth: spacing.xsm, borderTopColor: colors.separator + '66' },
});
