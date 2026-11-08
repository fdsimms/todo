import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CardSheet, type CardAnchor } from './CardSheet';
import { RecordBadge } from './RecordBadge';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, spacing, type Colors } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Where the trophy was tapped, so the card opens from it. See `CardSheet`. */
  anchor: CardAnchor | null;
  /** One row per record the set broke (`recordLines`). */
  lines: { key: string; label: string; detail: string }[];
}

/**
 * What a set's trophy stands for, as a popover off the trophy. The badge itself
 * stays icon-only (its row has no width to spare), so this is where the record's
 * name and the figure it replaced are read.
 */
export function RecordsCard({ visible, onClose, anchor, lines }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <CardSheet
      name="RecordsCard"
      visible={visible}
      onClose={onClose}
      anchor={anchor}
      popoverWidth={290}
      scrimLabel="Close"
    >
      <Text style={styles.label}>Personal records</Text>
      {lines.map(line => (
        <View key={line.key} style={styles.row} accessible accessibilityLabel={`${line.label}. ${line.detail}`}>
          <RecordBadge />
          <View style={styles.text}>
            <Text style={styles.name}>{line.label}</Text>
            <Text style={styles.detail}>{line.detail}</Text>
          </View>
        </View>
      ))}
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.md, paddingTop: spacing.smd, paddingBottom: spacing.xsm,
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
    borderTopWidth: border.hairline, borderTopColor: colors.separator,
  },
  text: { flex: 1 },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  detail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
});
