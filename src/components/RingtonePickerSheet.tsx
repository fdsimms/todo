import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { useAlarmStore } from '../store/useAlarmStore';
import { useDemoStore } from '../store/useDemoStore';
import { BUILT_IN_SOUNDS, DEFAULT_SOUND_LABEL, customSoundRef } from '../utils/alarmSounds';
import { playSoundPreview, stopSoundPreview, subscribeSoundPreview } from '../utils/alarmSoundDevice';
import { confirmDelete } from '../utils/confirmDelete';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

type Props = {
  visible: boolean;
  onClose: () => void;
} & (
  | {
    multiple?: false;
    /** The sound picked now. */
    value: string | null;
    /** A row was picked. The sheet stays open, so a few can be heard before Done. */
    onChange: (sound: string | null) => void;
  }
  | {
    /** Rows toggle, and two or more picked make an alarm choose between them (`Alarm.soundPool`). */
    multiple: true;
    /** The sounds picked now; empty is the default sound. */
    values: string[];
    onChangeValues: (sounds: string[]) => void;
  }
);

/**
 * Picks what an alarm rings with: the system's sound, one of the built-in
 * tones, or a sound imported from Files (alarmSounds.ts). Tapping a row picks
 * it and plays it; Done closes. With `multiple`, a row toggles instead, and
 * picking none is the default. A card, since it is one small decision
 * (CLAUDE.md, CardSheet), raised from the alarm editor or the quick alarm and
 * rendered inside that sheet, never beside it ("Two sibling Modals").
 */
export function RingtonePickerSheet(props: Props) {
  const { visible, onClose } = props;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const imported = useAlarmStore(useShallow(s => s.sounds));
  const demo = useDemoStore(s => s.active);
  const [importing, setImporting] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const selected = props.multiple ? props.values : (props.value === null ? [] : [props.value]);

  useEffect(() => subscribeSoundPreview(setPlaying), []);

  useEffect(() => {
    if (!visible) stopSoundPreview();
    return () => stopSoundPreview();
  }, [visible]);

  const dismiss = () => card.close(() => { stopSoundPreview(); onClose(); });

  const pick = (sound: string | null) => {
    haptics.tap();
    const adding = sound !== null && !selected.includes(sound);
    if (props.multiple) {
      props.onChangeValues(sound === null ? [] : adding ? [...selected, sound] : selected.filter(s => s !== sound));
    } else {
      props.onChange(sound);
    }
    if (sound === null || !adding && props.multiple) stopSoundPreview();
    else void playSoundPreview(sound, imported);
  };

  const importSound = async () => {
    stopSoundPreview();
    setImporting(true);
    const result = await useAlarmStore.getState().importSound();
    setImporting(false);
    if (result.status === 'ok') {
      pick(customSoundRef(result.sound.id));
    } else if (result.status === 'failed') {
      Alert.alert('Couldn’t import that sound', 'It may be protected, like a song bought from iTunes, or not a sound file. Try another one.');
    }
  };

  const remove = (id: string, name: string) => {
    confirmDelete({
      title: `Delete “${name}”?`,
      message: 'Alarms that ring with it will ring with the default sound.',
      onConfirm: () => {
        stopSoundPreview();
        const ref = customSoundRef(id);
        if (props.multiple) props.onChangeValues(selected.filter(s => s !== ref));
        else if (props.value === ref) props.onChange(null);
        useAlarmStore.getState().deleteSound(id);
      },
    });
  };

  const row = (sound: string | null, label: string, first: boolean, onDelete?: () => void) => {
    const on = sound === null ? selected.length === 0 : selected.includes(sound);
    return (
      <View key={sound ?? 'default'} style={[styles.row, !first && styles.rowDivider]}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => pick(sound)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole={props.multiple ? 'checkbox' : 'radio'}
          accessibilityState={{ checked: on }}
          accessibilityHint={sound === null ? undefined : props.multiple ? 'Adds or removes it, and plays it' : 'Picks it and plays it'}
        >
          <View style={styles.check}>
            {on && <Ionicons name="checkmark" size={iconSize.md} color={colors.accentText} />}
          </View>
          <Text style={[styles.rowLabel, on && styles.rowLabelSelected]} numberOfLines={1}>{label}</Text>
        </TouchableOpacity>
        {sound !== null && (
          <TouchableOpacity
            onPress={() => {
              haptics.tap();
              if (playing === sound) stopSoundPreview();
              else void playSoundPreview(sound, imported);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={playing === sound ? `Pause ${label}` : `Play ${label}`}
          >
            <Ionicons name={playing === sound ? 'pause-circle-outline' : 'play-circle-outline'} size={iconSize.lg} color={colors.accentText} />
          </TouchableOpacity>
        )}
        {onDelete && (
          <TouchableOpacity onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${label}`}>
            <Ionicons name="trash-outline" size={iconSize.md} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <CardSheet name="RingtonePickerSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text style={styles.title}>Ringtone</Text>
        <SheetHeaderButton label={BUTTON_LABEL.done} onPress={dismiss} minWidth={56} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <View style={styles.group}>
          {row(null, DEFAULT_SOUND_LABEL, true)}
          {BUILT_IN_SOUNDS.map(s => row(s.id, s.label, false))}
        </View>

        {imported.length > 0 && (
          <>
            <Text style={styles.label}>Your sounds</Text>
            <View style={styles.group}>
              {imported.map((s, i) => row(customSoundRef(s.id), s.name, i === 0, () => remove(s.id, s.name)))}
            </View>
          </>
        )}

        {props.multiple && selected.length >= 2 && (
          <HelpText style={styles.poolHint}>
            Picks one of these {selected.length} at random. It changes after each ring, the next time the app opens.
          </HelpText>
        )}

        {!demo && (
          <View style={styles.importRow}>
            {importing
              ? <ActivityIndicator color={colors.accent} />
              : <InlineAction label="Import a sound…" icon="add" onPress={() => void importSound()} />}
            <HelpText style={styles.hint}>
              Any sound file from Files. Only the first 30 seconds are used.
            </HelpText>
          </View>
        )}
      </ScrollView>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
  },
  headerSpacer: { minWidth: 56 },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  scroll: { maxHeight: 460 },
  body: { padding: spacing.md, paddingBottom: spacing.lg },
  group: { borderRadius: radius.md, backgroundColor: colors.bgTertiary },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: spacing.sm, marginLeft: spacing.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    paddingRight: spacing.md, minHeight: 48,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingLeft: spacing.smd },
  check: { width: 28, alignItems: 'center' },
  rowLabel: { flex: 1, color: colors.text, fontSize: font.md, marginLeft: spacing.xs },
  rowLabelSelected: { fontWeight: fontWeight.semibold },
  importRow: { marginTop: spacing.md, alignItems: 'flex-start', gap: spacing.sm },
  poolHint: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.smd, marginHorizontal: spacing.xs },
  hint: { color: colors.textSecondary, fontSize: font.sm },
});
