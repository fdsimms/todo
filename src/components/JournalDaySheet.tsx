import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { format } from 'date-fns/format';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { JournalText } from './JournalText';
import type { JournalEntry, JournalKind } from '../types';
import { useJournalStore } from '../store/useJournalStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { JOURNAL_KIND_COPY, entriesOnDay, openEntries } from '../utils/journal';
import { journalPlainText } from '../utils/journalMarkdown';

interface Props {
  visible: boolean;
  kind: JournalKind;
  /** The `yyyy-MM-dd` day to show, or null while the sheet is closed. */
  dayKey: string | null;
  /** Opens one of the day's entries for editing. */
  onEdit: (entry: JournalEntry) => void;
  /** Shows another random page; omit where the page was picked, not drawn. */
  onAnother?: () => void;
  onClose: () => void;
}

/**
 * One day of the journal or dream log, read as a page: what the month grid
 * opens on a tapped day, and what "a random page" lands on. Read only, with
 * a tap on an entry handing it to the editor. Sealed notes are left out
 * (`openEntries`), like every other reader.
 */
export function JournalDaySheet({ visible, kind, dayKey, onEdit, onAnother, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const all = useJournalStore(s => s.entries);
  const copy = JOURNAL_KIND_COPY[kind];

  const entries = useMemo(
    () => (dayKey ? entriesOnDay(openEntries(all, dayKeyOf(getCurrentDayStart())), kind, dayKey) : []),
    [all, kind, dayKey],
  );
  const title = dayKey ? format(new Date(`${dayKey}T12:00:00`), 'EEEE, MMMM d, yyyy') : copy.title;

  return (
    <SheetModal name="JournalDaySheet" visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <SheetHeader
          title={title}
          left={<View style={styles.headerSpacer} />}
          right={<SheetHeaderButton label="Done" onPress={onClose} minWidth={56} />}
        />
        <ScrollView contentContainerStyle={styles.content}>
          {entries.length === 0 ? (
            <Text style={styles.empty}>Nothing was written on this day.</Text>
          ) : (
            <View style={styles.card}>
              {entries.map((entry, index) => (
                <TouchableOpacity
                  key={entry.id}
                  style={index > 0 && styles.gap}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); onEdit(entry); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${copy.one} from ${format(new Date(entry.loggedAt), 'h:mm a')}: ${journalPlainText(entry.text)}`}
                >
                  <Text style={styles.time}>{format(new Date(entry.loggedAt), 'h:mm a')}</Text>
                  <JournalText text={entry.text} textStyle={styles.text} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          {onAnother && (
            <InlineAction
              label="Another page"
              icon="shuffle"
              variant="neutral"
              style={styles.another}
              onPress={() => { haptics.tap(); onAnother(); }}
            />
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { minWidth: 56 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.lg, padding: spacing.md },
  gap: { marginTop: spacing.md },
  time: { fontSize: font.xs, color: colors.textSecondary, marginBottom: spacing.xxs },
  text: { fontSize: font.md, color: colors.text },
  empty: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center', paddingVertical: spacing.xl },
  another: { alignSelf: 'center', marginTop: spacing.md },
});
