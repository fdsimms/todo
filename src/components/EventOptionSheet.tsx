import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CardSheet, useCardSheet } from './CardSheet';

export interface EventOption {
  key: string;
  label: string;
  /** A calendar's color, drawn as a dot before the label. */
  color?: string;
}

interface Props {
  visible: boolean;
  title: string;
  options: readonly EventOption[];
  selectedKey: string | null;
  /** Shown instead of the list when there are no options to pick. */
  emptyText?: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

/**
 * A short pick-one list in a card: which calendar a quick-add event goes into,
 * and how long before it the alert fires. Both are a closed set the person
 * chooses once and then leaves alone (the choice is remembered), which is the
 * "one small decision" a `CardSheet` is for. Its calendar-picking sibling,
 * `CalendarChoiceSheet`, is written around a task's mirror setting (an "Off"
 * row, copy about every task), so it isn't reused here.
 */
export function EventOptionSheet({ visible, title, options, selectedKey, emptyText, onSelect, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);

  return (
    <CardSheet name="EventOptionSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title={title}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={dismiss} />}
          right={<View style={styles.headerSpacer} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {options.length === 0 ? (
            <Text style={styles.empty}>{emptyText ?? 'Nothing to pick.'}</Text>
          ) : (
            <View style={styles.card}>
              {options.map((option, index) => (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.row, index > 0 && styles.rowRuled]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); onSelect(option.key); dismiss(); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.key === selectedKey }}
                  accessibilityLabel={option.label}
                >
                  {option.color ? <View style={[styles.dot, { backgroundColor: option.color }]} /> : null}
                  <Text style={styles.rowTitle} numberOfLines={1}>{option.label}</Text>
                  {option.key === selectedKey && (
                    <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    headerSpacer: { minWidth: 40 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { padding: spacing.md },
    card: { backgroundColor: colors.bgTertiary, borderRadius: radius.md, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
    },
    rowRuled: { borderTopWidth: 1, borderTopColor: colors.separator },
    dot: { width: 10, height: 10, borderRadius: 5 },
    rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
    empty: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
  });
}
