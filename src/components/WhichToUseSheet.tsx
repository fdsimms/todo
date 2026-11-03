import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { BUTTON_LABEL } from '../copy/shared';
import { useSettingsStore } from '../store/useSettingsStore';
import { WHICH_TO_USE_LABEL, organizeGuideEntries } from '../utils/organizeGuide';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Category, tag, project, stack and template side by side, in one line each.
 *
 * Each has its own screen and none of those screens says what the other four
 * are, so someone with a new idea picked whichever they opened first. This is
 * reached from the header and the empty state of all five. It is read-only
 * (nothing typed, nothing to lose), so a swipe down is as good as Done and
 * there is no unsaved-changes guard to write. The entries and their wording
 * are `ORGANIZE_GUIDE`, which the Projects empty state reads too.
 */
export function WhichToUseSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const entries = useMemo(() => organizeGuideEntries(simpleMode), [simpleMode]);

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title={WHICH_TO_USE_LABEL}
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={64} />}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            {entries.map((entry, i) => (
              <View key={entry.kind} style={[styles.row, i > 0 && styles.rowDivider]}>
                <View style={styles.tile}>
                  <Ionicons name={entry.icon} size={iconSize.sm} color={colors.accentText} />
                </View>
                <View style={styles.text}>
                  <Text style={styles.title}>{entry.title}</Text>
                  <Text style={styles.body}>{entry.body}</Text>
                  <Text style={styles.examples}>{entry.examples}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { width: 64 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: spacing.smd, padding: spacing.smd },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  tile: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.accentSubtle, alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing.xxs },
  title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  body: { color: colors.textSecondary, fontSize: font.sm },
  examples: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.xxs },
});
