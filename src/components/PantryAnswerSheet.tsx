import React, { Fragment, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, border, iconSize, lineHeight, type Colors } from '../theme';

/** One answer: what it's called, what it does, and the haptic that goes with it. */
export interface PantryAnswerRow<K extends string> {
  key: K;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** `red` is for the answer that takes the item out of the pantry. */
  tone: 'accent' | 'red';
  label: string;
  detail: string;
  feedback: () => void;
}

interface Props<K extends string> {
  visible: boolean;
  /** Names the sheet for `SheetModal`'s development warnings. */
  name: string;
  title: string;
  subtitle?: string | null;
  rows: readonly PantryAnswerRow<K>[];
  /** Runs after the card has finished leaving, with the row that was tapped. */
  onAnswer: (key: K) => void;
  /** Runs once the card has left, whichever way it left (an answer or a dismissal). */
  onClose: () => void;
}

/**
 * The card both pantry questions about an item are asked in: "Do you still
 * have it?" (`PantryCheckSheet`) and "Used it up, froze it, or went bad?"
 * (`UseUpResolveSheet`). They ask different things and write through different
 * calls, so each keeps its own rows; what they share is the shape, a title, an
 * optional line under it and one row per answer (icon, label, one-line detail),
 * so a new pantry question reuses this instead of copying either one.
 *
 * Dismissing the card writes nothing. An answer closes the card first and
 * writes after it has gone, so the content stays put while it fades.
 */
export function PantryAnswerSheet<K extends string>({
  visible, name, title, subtitle, rows, onAnswer, onClose,
}: Props<K>) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  return (
    <CardSheet
      name={name}
      visible={visible}
      controller={card}
      onClose={onClose}
      onRequestClose={() => card.close()}
      scrimLabel="Close"
    >
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rows.map(row => (
        <Fragment key={row.key}>
          <View style={styles.sep} />
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => { row.feedback(); card.close(() => onAnswer(row.key)); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${row.label}. ${row.detail}`}
          >
            <Ionicons
              name={row.icon}
              size={iconSize.md}
              color={row.tone === 'red' ? colors.redText : colors.accent}
              style={styles.icon}
            />
            <View style={styles.text}>
              <Text style={[styles.label, row.tone === 'red' && styles.redLabel]}>{row.label}</Text>
              <Text style={styles.detail}>{row.detail}</Text>
            </View>
          </TouchableOpacity>
        </Fragment>
      ))}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.smd,
  },
  title: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    marginTop: spacing.xxs,
    fontWeight: fontWeight.regular,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smd,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  icon: { marginTop: spacing.xxs },
  text: { flex: 1 },
  label: {
    color: colors.text,
    fontSize: font.lg,
  },
  redLabel: { color: colors.redText },
  detail: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    marginTop: spacing.xxs,
    fontWeight: fontWeight.regular,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
  },
});
