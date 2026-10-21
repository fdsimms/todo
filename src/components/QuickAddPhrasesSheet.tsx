import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { QUICK_ADD_PHRASES } from '../utils/quickAddPhrases';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Runs once the sheet is gone, for a host handing the keyboard back to its field. */
  onDismiss?: () => void;
}

/**
 * Everything quick add reads out of a title, each as an example to type and
 * what it becomes. Opened from the "?" on the keyboard bar. The list is
 * `QUICK_ADD_PHRASES`, whose test runs every example through the parser that
 * reads it, so nothing here promises a phrase the app doesn't understand.
 */
export function QuickAddPhrasesSheet({ visible, onClose, onDismiss }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SheetModal
      name="QuickAddPhrasesSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={styles.root}>
        <SheetHeader
          title="What you can type"
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={56} />}
        />
        <ScrollView contentContainerStyle={styles.content}>
          {QUICK_ADD_PHRASES.map(section => (
            <View key={section.title}>
              <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
              <View style={styles.card}>
                {section.phrases.map((phrase, i) => (
                  <View
                    key={phrase.example}
                    style={[styles.row, i > 0 && styles.rowDivider]}
                    accessible
                    accessibilityLabel={`${phrase.example}. ${phrase.means}`}
                  >
                    <Text style={styles.example}>{phrase.example}</Text>
                    <Text style={styles.means}>{phrase.means}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { minWidth: 56 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, marginBottom: spacing.lg },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  example: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text },
  means: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xxs },
});
