import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AlarmMission, WakeSong } from '../types';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { MissionPicker } from './MissionPicker';
import { AlarmSoundRows } from './AlarmSoundRows';
import { RingtonePickerSheet } from './RingtonePickerSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { formatTimeOfDay } from '../utils/dateUtils';
import { QUICK_ALARM_CHOICES, formatAlarmMinutes } from '../utils/alarms';
import { useAlarmStore } from '../store/useAlarmStore';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The length it opens on: the quick button tapped, or 30 minutes for Other. */
  initialMinutes: number;
  onClose: () => void;
}

const MINUTE_OPTIONS: SegmentOption<number>[] = QUICK_ALARM_CHOICES.map(m => ({ value: m, label: formatAlarmMinutes(m) }));

/**
 * A one-off alarm a set time from now, with a mission if it should take one
 * to stop ("a 30-minute nap I have to do pushups to wake up from"). A card,
 * since it is one small decision (CLAUDE.md, CardSheet).
 *
 * The mission, ringtone and song it opens with are the last ones used here,
 * so a nap alarm that always takes pushups doesn't ask to be set up again
 * each time.
 */
export function QuickAlarmSheet({ visible, initialMinutes, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const [minutes, setMinutes] = useState(initialMinutes);
  const [mission, setMission] = useState<AlarmMission | null>(null);
  const [sound, setSound] = useState<string | null>(null);
  const [wakeSong, setWakeSong] = useState<WakeSong | null>(null);
  const [ringtonesOpen, setRingtonesOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const last = useAlarmStore.getState().lastQuickSetup();
    setMinutes(initialMinutes);
    setMission(last.mission);
    setSound(last.sound);
    setWakeSong(last.wakeSong);
    setRingtonesOpen(false);
  }, [visible, initialMinutes]);

  const ringsAt = new Date(Date.now() + minutes * 60_000);
  const dismiss = (after?: () => void) => card.close(() => { onClose(); after?.(); });

  const start = () => {
    haptics.success();
    dismiss(() => { useAlarmStore.getState().addQuickAlarm(minutes, { mission, sound, wakeSong }); });
  };

  return (
    <CardSheet
      name="QuickAlarmSheet"
      visible={visible}
      controller={card}
      onRequestClose={() => dismiss()}
      overlays={(
        <RingtonePickerSheet
          visible={visible && ringtonesOpen}
          value={sound}
          onChange={setSound}
          onClose={() => setRingtonesOpen(false)}
        />
      )}
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss()} minWidth={56} />
          <View style={styles.headingWrap}>
            <Text style={styles.heading}>Alarm in {formatAlarmMinutes(minutes)}</Text>
            <Text style={styles.when}>Rings at {formatTimeOfDay(ringsAt)}</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.body}>
          <SegmentedControl
            label="Length"
            options={MINUTE_OPTIONS}
            value={minutes}
            onChange={setMinutes}
            columns={3}
            surface="card"
          />
          <Text style={styles.label}>Mission</Text>
          <MissionPicker value={mission} onChange={setMission} />
          <View style={styles.rows}>
            <AlarmSoundRows
              sound={sound}
              wakeSong={wakeSong}
              hasMission={mission !== null}
              onOpenRingtones={() => setRingtonesOpen(true)}
              onWakeSong={setWakeSong}
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.start}
          onPress={start}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
        >
          <Text style={styles.startText}>Start alarm</Text>
        </TouchableOpacity>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
  },
  headingWrap: { flex: 1, alignItems: 'center' },
  heading: { textAlign: 'center', color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  when: { textAlign: 'center', color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  headerSpacer: { minWidth: 56 },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.smd },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xs,
  },
  rows: { marginTop: spacing.xs, borderRadius: radius.md, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
  start: {
    marginTop: spacing.md, marginHorizontal: spacing.md, minHeight: 48, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentFill,
  },
  startText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
