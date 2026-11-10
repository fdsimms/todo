import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

export interface AllFieldsOption {
  id: string;
  label: string;
  /** How many rows are missing this field. A field with none is shown but can't be picked. */
  count: number;
}

interface Props {
  visible: boolean;
  /** "task", "recipe": what one stop in the walk is, for the Start button. */
  rowNoun: string;
  fields: AllFieldsOption[];
  /** How many rows a given choice of fields would visit, for the Start button. */
  rowCountFor: (fieldIds: string[]) => number;
  onStart: (fieldIds: string[]) => void;
  onClose: () => void;
}

/**
 * Which fields Backfill's "All fields" walk covers. Every field with a gap is
 * on when the card opens, so starting straight away walks everything, and a
 * field is turned off to leave it out of this walk. Nothing here is saved: it
 * is a choice about one sitting, not a setting. A short card because it is a
 * closed set of toggles and one button.
 */
export function AllFieldsSheet({ visible, rowNoun, fields, rowCountFor, onStart, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height } = useWindowDimensions();
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const initial = () => new Set(fields.filter(f => f.count > 0).map(f => f.id));
  const [chosen, setChosen] = useState<Set<string>>(initial);
  // Reseed on each opening, so a field turned off last time doesn't stay off.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setChosen(initial());
  }

  const picked = fields.filter(f => chosen.has(f.id) && f.count > 0).map(f => f.id);
  const rows = picked.length > 0 ? rowCountFor(picked) : 0;

  const toggle = (id: string) => {
    haptics.tap();
    setChosen(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  return (
    <CardSheet name="AllFieldsSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} minWidth={56} />
          <Text style={styles.heading}>All fields</Text>
          <View style={styles.headerSpacer} />
        </View>
        <HelpText style={styles.sub}>Asks about each of these on a {rowNoun} before moving to the next one.</HelpText>

        <ScrollView style={{ maxHeight: height * 0.5 }} contentContainerStyle={styles.list}>
          {fields.map(field => {
            const empty = field.count === 0;
            const on = !empty && chosen.has(field.id);
            return (
              <TouchableOpacity
                key={field.id}
                style={styles.row}
                activeOpacity={interaction.activeOpacity}
                onPress={() => toggle(field.id)}
                disabled={empty}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: empty }}
                accessibilityLabel={`${field.label}, ${empty ? 'nothing to fill in' : `${field.count} to fill in`}`}
              >
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={iconSize.md}
                  color={on ? colors.accent : colors.controlBorder}
                />
                <Text style={[styles.label, empty && styles.dim]} numberOfLines={2}>{field.label}</Text>
                <Text style={styles.count}>{empty ? 'None missing' : field.count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.actions}>
          <InlineAction
            label={rows > 0 ? `Start with ${rows} ${rows === 1 ? rowNoun : pluralOf(rowNoun)}` : 'Pick a field'}
            disabled={rows === 0}
            onPress={() => { haptics.tap(); card.close(() => { onStart(picked); onClose(); }); }}
            accessibilityLabel={rows > 0 ? `Start the walk through ${rows} ${rows === 1 ? rowNoun : pluralOf(rowNoun)}` : 'Pick at least one field to start'}
          />
        </View>
      </View>
    </CardSheet>
  );
}

function pluralOf(noun: string): string {
  return noun === 'category' ? 'categories' : noun === 'person' ? 'people' : `${noun}s`;
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  headerSpacer: { minWidth: 56 },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  sub: { color: colors.textTertiary, fontSize: font.xs, paddingHorizontal: spacing.md, paddingTop: spacing.xs, textAlign: 'center' },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    minHeight: 44,
    paddingVertical: spacing.xsm,
    borderRadius: radius.sm,
  },
  label: { flex: 1, color: colors.text, fontSize: font.md },
  dim: { color: colors.textTertiary },
  count: { color: colors.textSecondary, fontSize: font.sm },
  actions: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md },
});
