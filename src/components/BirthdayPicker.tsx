import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetScrim } from './SheetScrim';

/**
 * The birthday picker — month, day and an optional year, as three native
 * spinner wheels rather than a calendar grid.
 *
 * This replaced `WhenPicker` here (#2103). `WhenPicker` is built for
 * scheduling a task: it opens on Today/Tomorrow shortcuts that are almost
 * never the right answer for somebody's birthday, and a month calendar grid
 * for a date whose day-of-week and current-year placement mean nothing. A
 * birthday is a month and a day the user already knows, so asking for it as
 * three wheels — spin to the month, spin to the day — answers exactly the
 * question being asked, the way `WhenPicker`'s own Today/Tomorrow shortcuts
 * answer "when should this happen" for a task.
 *
 * **The year is a fourth, separate decision from the month and day, and the
 * toggle below the wheel is what keeps it that way.** The native spinner
 * always shows some concrete year — there is no "blank" wheel position — so
 * without an explicit "Include year" switch there would be no way to tell
 * "this person's year is 1992" apart from "the wheel happened to be sitting
 * on 1992 when Save was tapped". Off by default: a year-less birthday is the
 * common case (see `docs/arch/people.md`), and this is the one field on this
 * sheet where silence is the honest answer, not a gap.
 *
 * **The year is never used to compute an age.** It went through a whole
 * removal (#2083) for exactly that reason — it existed solely to back a
 * "Turning 34" chip, and once that display was gone the field had no
 * purpose left, so it went too. This brings the field back for its own
 * sake, as something worth recording about somebody, with nothing reading
 * it to derive anything.
 */

interface Props {
  visible: boolean;
  month: number | null;
  day: number | null;
  year: number | null;
  onConfirm: (month: number, day: number, year: number | null) => void;
  onClear: () => void;
  onCancel: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 380);

// A neutral, leap-safe placeholder for the wheel's year column when no birth
// year is on file — the same convention `describeBirthday`/`birthdayInYear`
// already use elsewhere, so a February 29 birthday doesn't get silently
// clamped to the 28th just because the year toggle happens to be off.
const PLACEHOLDER_YEAR = 2024;

const MIN_DATE = new Date(1900, 0, 1);

export function BirthdayPicker({ visible, month, day, year, onConfirm, onClear, onCancel }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [date, setDate] = useState(() => new Date());
  const [yearKnown, setYearKnown] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);

  const cardScale = useRef(new Animated.Value(0.92)).current;
  const enterAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      setPickerReady(false);
      cardScale.setValue(0.92);
      enterAnim.setValue(0);
      return;
    }
    const hasMonthDay = month !== null && day !== null;
    setDate(hasMonthDay ? new Date(year ?? PLACEHOLDER_YEAR, month! - 1, day!, 12) : new Date());
    setYearKnown(year !== null);
    cardScale.setValue(0.92);
    enterAnim.setValue(0);
    Animated.parallel([
      Animated.timing(enterAnim, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const confirm = () => {
    haptics.tap();
    onConfirm(date.getMonth() + 1, date.getDate(), yearKnown ? date.getFullYear() : null);
  };

  const toggleYearKnown = () => {
    haptics.tap();
    setYearKnown(v => !v);
  };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={onCancel}
      onShow={() => setPickerReady(true)}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.dim, { opacity: enterAnim }]}
          pointerEvents="none"
        />
        <SheetScrim onPress={onCancel} />
        <Animated.View style={[styles.card, { opacity: enterAnim, transform: [{ scale: cardScale }] }]}>
          <View style={styles.header}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={onCancel} minWidth={28} />
            <Text style={styles.headerTitle}>Birthday</Text>
            <SheetHeaderButton label="Save" onPress={confirm} minWidth={28} />
          </View>

          <Text style={styles.hint}>The year is optional, and it's never used to work out an age.</Text>

          {pickerReady && (
            <DateTimePicker
              value={date}
              mode="date"
              display="spinner"
              minimumDate={MIN_DATE}
              maximumDate={new Date()}
              onChange={(_e, d) => { if (d) setDate(d); }}
              themeVariant={isDark ? 'dark' : 'light'}
              style={styles.wheel}
            />
          )}

          <TouchableOpacity
            style={styles.toggleRow}
            onPress={toggleYearKnown}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="switch"
            accessibilityState={{ checked: yearKnown }}
            accessibilityLabel="Include year"
          >
            <View style={styles.toggleContent}>
              <Text style={styles.toggleLabel}>Include year</Text>
              <Text style={styles.toggleHint}>Off leaves the year blank.</Text>
            </View>
            <View style={[styles.toggle, yearKnown && styles.toggleOn]}>
              <View style={[styles.toggleKnob, yearKnown && styles.toggleKnobOn]} />
            </View>
          </TouchableOpacity>

          <View style={styles.sectionGap} />
          <TouchableOpacity style={styles.clearBtn} onPress={onClear} activeOpacity={interaction.activeOpacity}>
            <Text style={styles.clearLabel}>Clear</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  dim: {
    backgroundColor: colors.backdrop,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  wheel: {
    height: 170,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
  },
  toggleContent: { flex: 1 },
  toggleLabel: { color: colors.text, fontSize: font.sm },
  toggleHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  toggle: {
    width: 44, height: 26, borderRadius: radius.full,
    backgroundColor: colors.bgQuaternary, padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: {
    width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg,
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
  sectionGap: {
    height: spacing.sm,
  },
  clearBtn: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  clearLabel: {
    color: colors.onAccent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
