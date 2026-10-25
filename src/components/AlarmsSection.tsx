import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Alarm } from '../types';
import { Toggle } from './Toggle';
import { InlineAction } from './InlineAction';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { useAlarmStore } from '../store/useAlarmStore';
import { useMissionStore } from '../store/useMissionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatTimeOfDay } from '../utils/dateUtils';
import {
  QUICK_ALARM_MINUTES,
  alarmMissionLine,
  alarmSubtitle,
  formatAlarmMinutes,
  isSpent,
  sortAlarms,
} from '../utils/alarms';
import { describeMission, missionKeyForAlarm } from '../utils/missions';
import { haptics } from '../utils/haptics';

interface Props {
  /** Opens the alarm editor on an alarm, or on a new one. */
  onEditAlarm: (alarm: Alarm | null) => void;
  /** Opens the quick alarm card on a length, in minutes. */
  onQuickAlarm: (minutes: number) => void;
}

/** How often the "in 28 min" lines are brought up to date while on screen. */
const REFRESH_MS = 30_000;

/**
 * The alarms half of the Alarms & Reminders screen, drawn as the reminder
 * list's header: a banner for each mission owed now, the quick alarm buttons,
 * and every alarm with its switch. The task reminders follow it, under their
 * own label.
 */
export function AlarmsSection({ onEditAlarm, onQuickAlarm }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const alarms = useAlarmStore(useShallow(s => s.alarms));
  const owed = useMissionStore(useShallow(s => s.owed));
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const sorted = useMemo(() => sortAlarms(alarms, now), [alarms, now]);
  const owedAlarmIds = useMemo(() => new Set(owed.filter(o => o.source === 'alarm').map(o => o.id)), [owed]);

  return (
    <View>
      {owed.map(o => (
        <View key={o.key} style={styles.banner}>
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle} numberOfLines={2}>{o.title}</Text>
            <Text style={styles.bannerBody}>Rings until you do {describeMission(o.mission)}</Text>
          </View>
          <TouchableOpacity
            style={styles.bannerButton}
            onPress={() => { haptics.tap(); useMissionStore.getState().show(o.key); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Start the mission for ${o.title}`}
          >
            <Text style={styles.bannerButtonText}>Start</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={styles.label}>Quick alarm</Text>
      <View style={[styles.card, styles.quick]}>
        {QUICK_ALARM_MINUTES.map(m => (
          <InlineAction key={m} label={formatAlarmMinutes(m)} onPress={() => onQuickAlarm(m)} />
        ))}
        <InlineAction label="Other…" variant="neutral" onPress={() => onQuickAlarm(30)} />
      </View>

      <Text style={styles.label}>Alarms</Text>
      {sorted.length > 0 && (
        <View style={styles.card}>
          {sorted.map((alarm, i) => (
            <AlarmRow
              key={alarm.id}
              alarm={alarm}
              now={now}
              owed={owedAlarmIds.has(alarm.id)}
              use24Hour={use24Hour}
              weekStartsOn={weekStartsOn}
              first={i === 0}
              onPress={onEditAlarm}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>
      )}
      <View style={styles.addRow}>
        <InlineAction label="New alarm" icon="add" onPress={() => onEditAlarm(null)} />
      </View>

      <Text style={styles.label}>Upcoming reminders</Text>
    </View>
  );
}

interface RowProps {
  alarm: Alarm;
  now: Date;
  /** Its mission is owed right now, so the switch gives way to the mission. */
  owed: boolean;
  use24Hour: boolean;
  weekStartsOn: 0 | 1;
  first: boolean;
  onPress: (alarm: Alarm) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}

function AlarmRow({ alarm, now, owed, use24Hour, weekStartsOn, first, onPress, styles, colors }: RowProps) {
  const clock = formatTimeOfDay(new Date(2000, 0, 1, alarm.hour, alarm.minute), use24Hour);
  // "7:00 AM" is drawn as a large time with a small meridiem, the way the
  // Clock app draws it; a 24-hour time is one piece.
  const split = clock.match(/^(.*\d)\s*([^\d\s]+)$/);
  const live = alarm.enabled && !isSpent(alarm, now);
  const subtitle = alarmSubtitle(alarm, now, weekStartsOn);
  const missionLine = alarmMissionLine(alarm, now);

  // While its mission is owed the row opens the mission rather than the
  // editor, and has no switch: Give up is the way out (missions.ts).
  const press = () => {
    haptics.tap();
    if (owed) useMissionStore.getState().show(missionKeyForAlarm(alarm.id));
    else onPress(alarm);
  };
  const toggle = () => {
    haptics.tap();
    useAlarmStore.getState().setEnabled(alarm.id, !live);
  };

  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <TouchableOpacity
        style={styles.rowMain}
        onPress={press}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={[clock, subtitle, missionLine].filter(Boolean).join(', ')}
        accessibilityHint={owed ? 'Opens its mission' : 'Edits the alarm'}
      >
        <Text style={[styles.time, !live && styles.dim]}>
          {split ? split[1] : clock}
          {split && <Text style={styles.meridiem}> {split[2]}</Text>}
        </Text>
        {subtitle !== '' && <Text style={[styles.subtitle, !live && styles.dimSecondary]}>{subtitle}</Text>}
        {missionLine && (
          <View style={styles.missionRow}>
            <Ionicons name="barbell-outline" size={iconSize.xs} color={live ? colors.accentText : colors.textTertiary} />
            <Text style={[styles.mission, !live && styles.dimSecondary]}>{missionLine}</Text>
          </View>
        )}
      </TouchableOpacity>
      {owed ? (
        <View style={styles.ringing}>
          <Text style={styles.ringingText}>Ringing</Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={toggle}
          activeOpacity={interaction.activeOpacity}
          hitSlop={8}
          accessibilityRole="switch"
          accessibilityState={{ checked: live }}
          accessibilityLabel={`Alarm at ${clock}`}
        >
          <Toggle value={live} look="settings" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg + spacing.xs,
  },
  card: {
    marginHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  quick: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.smd,
  },
  addRow: { marginHorizontal: spacing.md, marginTop: spacing.sm, alignItems: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowMain: { flex: 1, minWidth: 0 },
  // A hero number, one of the literal sizes the font scale isn't for.
  time: { color: colors.text, fontSize: 34, fontWeight: fontWeight.regular, fontVariant: ['tabular-nums'] },
  meridiem: { fontSize: font.lg },
  dim: { color: colors.textTertiary },
  subtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  dimSecondary: { color: colors.textTertiary },
  missionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xxs },
  mission: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
  ringing: {
    borderRadius: radius.full,
    backgroundColor: colors.warningBg,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xs,
  },
  ringingText: { color: colors.warningText, fontSize: font.sm, fontWeight: fontWeight.semibold },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: colors.warningBg,
  },
  bannerText: { flex: 1, minWidth: 0 },
  bannerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  bannerBody: { color: colors.text, fontSize: font.sm, marginTop: spacing.xxs },
  bannerButton: {
    borderRadius: radius.sm,
    backgroundColor: colors.accentFill,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: 'center',
  },
  bannerButtonText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
