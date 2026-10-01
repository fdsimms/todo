import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { SegmentedControl } from './SegmentedControl';
import { PressableScale } from './PressableScale';
import {
  writeExportFile, shareCsvFile, discardBackupFile, canShare,
} from '../utils/backupFile';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';

/** How far back an export reaches. Days, so the cutoff is one subtraction. */
type ExportRange = 30 | 90 | 365 | null;

const RANGES: { value: ExportRange; label: string }[] = [
  { value: 30, label: '30 days' },
  { value: 90, label: '3 months' },
  { value: 365, label: '1 year' },
  { value: null, label: 'Everything' },
];

/**
 * Sharing a log as a CSV file: the mood log and the food log both use it.
 *
 * A range picker, a line saying what is in the file, and the share sheet. The
 * file is written to the cache and deleted again the moment the share sheet
 * closes, exactly as the backup export does — a health record that also
 * accumulated silently in the app's own storage would be a second copy of the
 * most sensitive thing here, sitting somewhere nobody would think to look for
 * it.
 *
 * The range defaults to 3 months rather than to everything, because the common
 * reason to want this file is an appointment about the last little while, and
 * a year of entries in a spreadsheet is harder to read than the fortnight the
 * question was actually about. Every option including "Everything" is one tap
 * away.
 *
 * Nothing is staged that a swipe-down could lose: the range is a choice about
 * a file that does not exist until Share is tapped, so this needs no
 * unsaved-changes guard.
 */
export function CsvExportSheet<T>({
  visible, onClose, hint, dialogTitle, select, toCsv, fileName, summary,
}: {
  visible: boolean;
  onClose: () => void;
  /** What the file holds, in words, above the range picker. */
  hint: string;
  /** The share sheet's title ("Share your mood log"). */
  dialogTitle: string;
  /**
   * The rows on or after `fromDayKey`, or every row when it is null. Called
   * only while the sheet is open, so a caller may read the database here.
   */
  select: (fromDayKey: string | null) => readonly T[];
  toCsv: (rows: readonly T[]) => string;
  fileName: (exportedAt: Date) => string;
  summary: (rows: readonly T[]) => string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();

  const [range, setRange] = useState<ExportRange>(90);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (visible) {
      setRange(90);
    }
  }, [visible]);

  const dismiss = () => {
    card.close(onClose);
  };

  const selected = useMemo(() => {
    if (!visible) return [];
    if (range === null) return select(null);
    const from = new Date(getCurrentDayStart());
    from.setDate(from.getDate() - (range - 1));
    return select(dayKeyOf(from));
    // `select` is usually an inline arrow; re-reading on every parent render
    // while open is cheap, but keying on it would re-read on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, range]);

  const share = async () => {
    if (selected.length === 0 || sharing) return;
    haptics.tap();
    setSharing(true);
    let uri: string | null = null;
    try {
      if (!(await canShare())) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
      uri = writeExportFile(toCsv(selected), fileName(new Date()));
      await shareCsvFile(uri, dialogTitle);
    } catch {
      Alert.alert('Export failed', 'The file could not be written. Try again.');
    } finally {
      if (uri) discardBackupFile(uri);
      setSharing(false);
    }
  };

  return (
    <CardSheet name="CsvExportSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.sheet}>
        <SheetHeader
          size="lg"
          title="Export"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={dismiss} minWidth={64} />}
          right={<View style={styles.headerSpacer} />}
        />

        <View style={styles.body}>
          <Text style={styles.hint}>{hint}</Text>

          <SegmentedControl
            label="Range"
            options={RANGES.map(r => ({ value: r.value, label: r.label }))}
            value={range}
            onChange={setRange}
            columns={2}
          />

          <Text style={styles.summary}>{summary(selected)}</Text>

          <PressableScale
            style={[styles.shareButton, selected.length === 0 && styles.shareButtonDisabled]}
            onPress={share}
            disabled={selected.length === 0 || sharing}
            accessibilityLabel="Share the file"
          >
            {sharing
              ? <ActivityIndicator color={colors.onAccent} />
              : <Text style={styles.shareLabel}>Share</Text>}
          </PressableScale>
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  sheet: {
    paddingBottom: spacing.xs,
  },
  headerSpacer: { minWidth: 64 },
  body: { padding: spacing.md, gap: spacing.md },
  hint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  summary: { fontSize: font.sm, color: colors.text, fontWeight: fontWeight.medium },
  shareButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  shareButtonDisabled: { opacity: 0.4 },
  shareLabel: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
