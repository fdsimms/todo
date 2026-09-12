import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, Animated, Alert, ActivityIndicator } from 'react-native';
import type { MoodLog } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { SheetScrim } from './SheetScrim';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetHeader } from './SheetHeader';
import { SegmentedControl } from './SegmentedControl';
import { PressableScale } from './PressableScale';
import { logsInDayRange } from '../utils/moodHistory';
import { moodExportCsv, moodExportFileName, moodExportSummary } from '../utils/moodExport';
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
 * Sharing the mood log as a CSV file.
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
export function MoodExportSheet({ visible, logs, onClose }: {
  visible: boolean;
  logs: readonly MoodLog[];
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hiddenY = useSheetHiddenOffset();

  const [range, setRange] = useState<ExportRange>(90);
  const [sharing, setSharing] = useState(false);

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRange(90);
      translateY.setValue(hiddenY);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  const selected = useMemo(() => {
    if (range === null) return [...logs];
    const from = new Date(getCurrentDayStart());
    from.setDate(from.getDate() - (range - 1));
    return logsInDayRange(logs, dayKeyOf(from), null);
  }, [logs, range]);

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
      uri = writeExportFile(moodExportCsv(selected), moodExportFileName(new Date()));
      await shareCsvFile(uri, 'Share your mood log');
    } catch {
      Alert.alert('Export failed', 'The file could not be written. Try again.');
    } finally {
      if (uri) discardBackupFile(uri);
      setSharing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: backdropOpacity }]}>
          <SheetScrim onPress={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <SheetHeader
            size="lg"
            title="Export"
            left={<SheetHeaderButton label="Cancel" role="cancel" onPress={dismiss} minWidth={64} />}
            right={<View style={styles.headerSpacer} />}
          />

          <View style={styles.body}>
            <Text style={styles.hint}>
              A spreadsheet file of your entries: the day, the time, your mood, any symptoms and
              their severity, your context tags and your notes. Nothing else from the app is
              included.
            </Text>

            <SegmentedControl
              label="Range"
              options={RANGES.map(r => ({ value: r.value, label: r.label }))}
              value={range}
              onChange={setRange}
              columns={2}
            />

            <Text style={styles.summary}>{moodExportSummary(selected)}</Text>

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
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: 40,
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
