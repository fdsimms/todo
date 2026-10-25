import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns/format';
import { useShallow } from 'zustand/react/shallow';
import type { Task } from '../types';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { HelpText } from './HelpText';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { useAlarmStore } from '../store/useAlarmStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { alarmAlertTitle, atTime, describeRepeat, describeTimeUntil, isRepeating } from '../utils/alarms';
import { describeSound } from '../utils/alarmSounds';
import { describeMission } from '../utils/missions';
import { NEXT_ALARM_LINK, morningAlarmFor } from '../utils/morningAlarm';
import { formatTimeOfDay } from '../utils/dateUtils';
import { displayTitleFor } from '../utils/visibilityUtils';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  task: Task;
  /**
   * The alarm was kept, changed or left off on purpose. The row checks the
   * task off from here (through its own tick, so a mission or a question is
   * still asked) unless the task says to leave it open.
   */
  onSettled: () => void;
  onClose: () => void;
}

type Scope = 'once' | 'always';

const SCOPE_OPTIONS: SegmentOption<Scope>[] = [
  { value: 'once', label: 'Just tomorrow' },
  { value: 'always', label: 'From now on' },
];

/**
 * Tomorrow's alarm, opened from a task that points at the device's alarms
 * (`Task.alarmLink`, morningAlarm.ts): see it, keep it, or change its time for
 * that morning only or for good. On a morning with no alarm it offers a
 * one-off. A card, since it is one small decision (CLAUDE.md, CardSheet).
 */
export function TomorrowAlarmSheet({ visible, task, onSettled, onClose }: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const alarms = useAlarmStore(useShallow(s => s.alarms));
  const imported = useAlarmStore(useShallow(s => s.sounds));
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const use24 = useSettingsStore(s => s.use24HourTime);
  const [now, setNow] = useState(() => new Date());
  const [changing, setChanging] = useState(false);
  const [time, setTime] = useState(() => new Date(2000, 0, 1, 7, 0));
  const [scope, setScope] = useState<Scope>('once');

  const morning = useMemo(
    () => morningAlarmFor(task.alarmLink ?? NEXT_ALARM_LINK, alarms, now, dayResetTime),
    [task.alarmLink, alarms, now, dayResetTime],
  );
  const ring = morning.ring;

  useEffect(() => {
    if (!visible) return;
    const opened = new Date();
    setNow(opened);
    const m = morningAlarmFor(task.alarmLink ?? NEXT_ALARM_LINK, useAlarmStore.getState().alarms, opened, dayResetTime);
    const seed = m.ring?.at ?? m.next?.at ?? null;
    setTime(new Date(2000, 0, 1, seed?.getHours() ?? 7, seed?.getMinutes() ?? 0));
    setChanging(false);
    setScope('once');
  }, [visible]);

  const clock = (at: Date) => formatTimeOfDay(at, use24);
  const checksOff = !task.alarmLinkLeavesOpen;
  const chosen = atTime(morning.date, time.getHours(), time.getMinutes());
  const dismiss = (after?: () => void) => card.close(() => { onClose(); after?.(); });
  const settle = (change?: () => void) => {
    haptics.success();
    dismiss(() => {
      change?.();
      if (checksOff) onSettled();
    });
  };

  const keep = () => settle();

  const applyChange = () => settle(() => {
    const store = useAlarmStore.getState();
    if (!ring) {
      // No alarm that morning: a one-off, set up like the alarm that rings
      // next, so the morning it fills in for asks the same mission.
      const like = morning.next?.alarm;
      store.addOneOffAlarm(chosen, { mission: like?.mission ?? null, sound: like?.sound ?? null, wakeSong: like?.wakeSong ?? null });
      return;
    }
    const alarm = ring.alarm;
    if (!isRepeating(alarm)) {
      store.saveAlarm({ ...alarm, hour: chosen.getHours(), minute: chosen.getMinutes() });
    } else if (scope === 'once') {
      store.setOverride(alarm.id, morning.date, chosen.getHours(), chosen.getMinutes());
    } else {
      store.saveAlarm({ ...alarm, hour: chosen.getHours(), minute: chosen.getMinutes() });
    }
  });

  const dayLabel = format(morning.date, 'EEEE, MMM d');
  const footer = checksOff
    ? `Either one checks off “${displayTitleFor(task)}”.`
    : null;

  const wheel = (
    <DateTimePicker
      value={time}
      mode="time"
      display="spinner"
      onChange={(_e, d) => { if (d) setTime(d); }}
      themeVariant={isDark ? 'dark' : 'light'}
      style={styles.wheel}
    />
  );

  const repeating = !!ring && isRepeating(ring.alarm);
  const scopeNote = ring && repeating
    ? scope === 'once'
      ? `${alarmAlertTitle(ring.alarm)} rings at ${clock(chosen)} on ${format(morning.date, 'EEEE')}, then goes back to ${clock(atTime(morning.date, ring.alarm.hour, ring.alarm.minute))}.`
      : `${alarmAlertTitle(ring.alarm)} rings at ${clock(chosen)} from now on.`
    : null;

  return (
    <CardSheet name="TomorrowAlarmSheet" visible={visible} controller={card} onRequestClose={() => dismiss()}>
      <View style={styles.header}>
        {changing && ring
          ? <SheetHeaderButton label="Back" role="cancel" onPress={() => setChanging(false)} minWidth={56} />
          : <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss()} minWidth={56} />}
        <Text style={styles.title}>Tomorrow’s alarm</Text>
        <View style={styles.headerSpacer} />
      </View>
      <Text style={styles.day}>{dayLabel}</Text>

      <View style={styles.body}>
        {ring && !changing && (
          <>
            <Text style={styles.hero} accessibilityRole="header">{clock(ring.at)}</Text>
            <Text style={styles.until}>Rings {describeTimeUntil(ring.at, now)}</Text>
            <View style={styles.facts}>
              <View style={styles.fact}>
                <Ionicons name="alarm-outline" size={iconSize.sm} color={colors.accentText} />
                <Text style={styles.factMain} numberOfLines={1}>{alarmAlertTitle(ring.alarm)}</Text>
                <Text style={styles.factSide}>{isRepeating(ring.alarm) ? describeRepeat(ring.alarm.repeatDays, weekStartsOn) : 'Once'}</Text>
              </View>
              {ring.alarm.mission && (
                <View style={[styles.fact, styles.factDivider]}>
                  <Ionicons name="barbell-outline" size={iconSize.sm} color={colors.accentText} />
                  <Text style={styles.factMain} numberOfLines={1}>{describeMission(ring.alarm.mission)}</Text>
                  <Text style={styles.factSide}>{describeSound(ring.alarm.sound, imported)}</Text>
                </View>
              )}
            </View>
            <Primary label={`Keep ${clock(ring.at)}`} onPress={keep} styles={styles} />
            <Secondary label="Change time" onPress={() => { haptics.tap(); setChanging(true); }} styles={styles} />
          </>
        )}

        {ring && changing && (
          <>
            {wheel}
            {repeating && (
              <SegmentedControl options={SCOPE_OPTIONS} value={scope} onChange={setScope} surface="card" />
            )}
            {scopeNote && <Text style={styles.note}>{scopeNote}</Text>}
            <Primary label={`Set for ${clock(chosen)}`} onPress={applyChange} styles={styles} />
          </>
        )}

        {!ring && (
          <>
            <Text style={styles.none}>No alarm</Text>
            {morning.next && (
              <Text style={styles.until}>
                The next one is {alarmAlertTitle(morning.next.alarm)}, {format(morning.next.at, 'EEE')} {clock(morning.next.at)}
              </Text>
            )}
            {wheel}
            <Primary label={`Ring at ${clock(chosen)} ${format(morning.date, 'EEE')}`} onPress={applyChange} styles={styles} />
            <Secondary label="Leave it off" onPress={keep} styles={styles} />
            <HelpText style={styles.note}>A new alarm rings once, then deletes itself.</HelpText>
          </>
        )}

        {footer && <Text style={styles.footer}>{footer}</Text>}
      </View>
    </CardSheet>
  );
}

function Primary({ label, onPress, styles }: { label: string; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <TouchableOpacity style={styles.primary} onPress={onPress} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
      <Text style={styles.primaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

function Secondary({ label, onPress, styles }: { label: string; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <TouchableOpacity style={styles.secondary} onPress={onPress} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
      <Text style={styles.secondaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
  },
  headerSpacer: { minWidth: 56 },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  day: { textAlign: 'center', color: colors.textSecondary, fontSize: font.md, marginTop: spacing.xxs },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  // A hero number, one of the literal sizes the font scale isn't for.
  hero: {
    textAlign: 'center', color: colors.text, fontSize: 56, fontWeight: fontWeight.regular,
    fontVariant: ['tabular-nums'], marginTop: spacing.xsm,
  },
  none: { textAlign: 'center', color: colors.text, fontSize: font.xl, fontWeight: fontWeight.semibold, marginTop: spacing.smd },
  until: { textAlign: 'center', color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  facts: { marginTop: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgTertiary },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.smd, paddingVertical: 10 },
  factDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  factMain: { flex: 1, color: colors.text, fontSize: font.md },
  factSide: { color: colors.textSecondary, fontSize: font.sm },
  wheel: { alignSelf: 'center' },
  note: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm, lineHeight: 18 },
  primary: {
    marginTop: spacing.md, minHeight: 48, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill,
  },
  primaryText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  secondary: {
    marginTop: spacing.sm, minHeight: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSubtle,
  },
  secondaryText: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
  footer: { textAlign: 'center', color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.smd, lineHeight: 18 },
});
