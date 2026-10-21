import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PillGroup } from './PillGroup';
import { CountStepper } from './CountStepper';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TextField } from './TextField';
import { PlaceAddressField } from './SavedEntrySheets';
import { ExercisePickerSheet } from './ExercisePickerSheet';
import { useGymStore } from '../store/useGymStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import type { ExerciseEquipment } from '../types';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { alertPermissionOff } from '../utils/permissionAlert';
import { getCurrentLocation, requestLocationPermission } from '../utils/weatherLocation';
import { exerciseName } from '../utils/exerciseCatalog';
import {
  ACCESSORY_EQUIPMENT, CARDIO_MACHINES, EQUIPMENT_LABELS, FREE_EQUIPMENT, STRENGTH_MACHINES, WORKOUT_NAME_MAX_LENGTH,
} from '../utils/workoutData';
import { GYM_DEFAULT_RADIUS_M, GYM_MAX_RADIUS_M, GYM_MIN_RADIUS_M, GYM_RADIUS_STEP_M } from '../utils/gyms';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The gym being edited, or `'new'`. Kept by the host through the close, so the sheet doesn't empty while it slides away. */
  subject: string | 'new' | null;
  onClose: () => void;
}

/**
 * What a gym can have, in three groups so the machines don't bury the free
 * weights. Bodyweight and Other need nothing from a gym, so they aren't offered.
 * The catch-all ends each machine group, for a machine with no chip of its own.
 */
const GYM_EQUIPMENT_GROUPS: { title: string; items: readonly ExerciseEquipment[] }[] = [
  { title: 'Free weights', items: FREE_EQUIPMENT },
  { title: 'Bars and accessories', items: ACCESSORY_EQUIPMENT },
  { title: 'Strength machines', items: [...STRENGTH_MACHINES, 'machine'] },
  { title: 'Cardio', items: [...CARDIO_MACHINES, 'cardio_machine'] },
];

const REFUSED: Record<string, string> = {
  blank: 'Give the gym a name.',
  taken: 'Another gym has that name.',
  notFound: 'This gym no longer exists.',
};

interface Staged {
  name: string;
  equipment: ExerciseEquipment[];
  placeText: string;
  pin: { latitude: number; longitude: number } | null;
  radiusM: number;
}

const EMPTY: Staged = { name: '', equipment: [], placeText: '', pin: null, radiusM: GYM_DEFAULT_RADIUS_M };

const snapshotOf = (v: Staged) => JSON.stringify([v.name.trim(), v.equipment, v.placeText.trim(), v.pin, v.radiusM]);

/**
 * Add or edit a gym: its name, where it is, and the equipment it has
 * (docs/arch/workouts.md, "Gyms"). A page sheet with staged state, so Cancel
 * and the swipe-down both go through `handleCancel`.
 *
 * The exercise notes under it commit as they are typed, like the notes on a
 * routine's exercises: they need a saved gym to hang off, so they only show for
 * a gym that exists. Rendered inside the list sheet's own Modal, since two
 * sheets presented side by side never both appear.
 */
export function GymEditorSheet({ visible, subject, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  const gyms = useGymStore(s => s.gyms);
  const settings = useGymStore(s => s.settings);
  const exerciseRows = useWorkoutStore(s => s.exercises);
  const existing = subject && subject !== 'new' ? gyms.find(g => g.id === subject) ?? null : null;
  const isNew = subject === 'new';

  const [v, setV] = useState<Staged>(EMPTY);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [picking, setPicking] = useState(false);
  // Exercises picked for a note not yet typed. A note with no text is no row,
  // so these are rows on screen only until one is written.
  const [drafts, setDrafts] = useState<string[]>([]);
  const baseline = useRef('');

  useEffect(() => {
    if (!visible || !subject) return;
    const next: Staged = existing
      ? {
        name: existing.name,
        equipment: [...existing.equipment],
        placeText: existing.placeText,
        pin: existing.latitude !== null && existing.longitude !== null
          ? { latitude: existing.latitude, longitude: existing.longitude }
          : null,
        radiusM: existing.radiusM,
      }
      : EMPTY;
    setV(next);
    setRefusal(null);
    setPicking(false);
    setDrafts([]);
    baseline.current = snapshotOf(next);
    // On open only: a sync landing mid-edit must not overwrite what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, subject]);

  const patch = (change: Partial<Staged>) => { setV(prev => ({ ...prev, ...change })); setRefusal(null); };
  const toggle = (e: ExerciseEquipment) => {
    haptics.tap();
    setV(prev => ({ ...prev, equipment: prev.equipment.includes(e) ? prev.equipment.filter(x => x !== e) : [...prev.equipment, e] }));
  };

  const dirty = visible && snapshotOf(v) !== baseline.current;
  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const useHere = async () => {
    haptics.tap();
    if (locating) return;
    setLocating(true);
    try {
      if (!(await requestLocationPermission())) {
        alertPermissionOff('Location is off', 'Allow Location for dundundun in Settings to find this gym when you start a workout.');
        return;
      }
      const fix = await getCurrentLocation({ accuracy: 'balanced' });
      if (!fix) {
        Alert.alert('Couldn’t find your location', 'Try again in a moment, or search for the address instead.');
        return;
      }
      patch({ pin: { latitude: fix.latitude, longitude: fix.longitude }, placeText: '' });
    } finally {
      setLocating(false);
    }
  };

  const save = () => {
    const input = {
      name: v.name,
      equipment: v.equipment,
      placeText: v.placeText,
      latitude: v.pin?.latitude ?? null,
      longitude: v.pin?.longitude ?? null,
      radiusM: v.radiusM,
    };
    const store = useGymStore.getState();
    const result = existing ? store.updateGym(existing.id, input) : store.addGym(input);
    if (typeof result === 'string') {
      haptics.warning();
      setRefusal(REFUSED[result] ?? 'This gym could not be saved.');
      return;
    }
    haptics.success();
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(
      'Delete this gym?',
      'Its exercise notes are deleted too. Past workouts stay in your history.',
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        { text: BUTTON_LABEL.delete, style: 'destructive', onPress: () => { useGymStore.getState().deleteGym(existing.id); onClose(); } },
      ],
    );
  };

  const notes = useMemo(() => {
    const saved = (existing ? settings.filter(s => s.gymId === existing.id) : []).map(s => ({ exerciseId: s.exerciseId, text: s.notes }));
    const pending = drafts.filter(id => !saved.some(n => n.exerciseId === id)).map(exerciseId => ({ exerciseId, text: '' }));
    return [...saved, ...pending]
      .map(n => ({ ...n, name: exerciseName(exerciseRows, n.exerciseId) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [existing, settings, drafts, exerciseRows]);

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel} name="GymEditorSheet">
      <View style={styles.root}>
        <SheetHeader
          title={isNew ? 'New gym' : 'Edit gym'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} minWidth={64} />}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
          ref={keyboardScroll.ref}
        >
          <TextField
            style={styles.nameInput}
            value={v.name}
            onChangeText={t => patch({ name: t })}
            placeholder="Gym name"
            placeholderTextColor={colors.textTertiary}
            maxLength={WORKOUT_NAME_MAX_LENGTH}
            autoCapitalize="words"
            returnKeyType="done"
            accessibilityLabel="Gym name"
          />
          {refusal && <Text style={styles.refusal}>{refusal}</Text>}

          <Text style={styles.label}>Location</Text>
          {v.pin ? (
            <>
              <View style={styles.card}>
                <View style={styles.row}>
                  <Ionicons name="location" size={iconSize.md} color={colors.accentText} />
                  <Text style={[styles.rowLabel, styles.grow]} numberOfLines={2}>{v.placeText.trim() || 'Current location'}</Text>
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); patch({ pin: null, placeText: '' }); }}
                    hitSlop={8}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel="Clear the location"
                  >
                    <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.row, styles.ruled]}>
                  <Text style={styles.rowLabel}>Within</Text>
                  <CountStepper
                    value={v.radiusM}
                    onChange={n => patch({ radiusM: n ?? GYM_DEFAULT_RADIUS_M })}
                    min={GYM_MIN_RADIUS_M}
                    max={GYM_MAX_RADIUS_M}
                    step={GYM_RADIUS_STEP_M}
                    format={n => `${n} m`}
                    label="Distance from the location"
                    describeValue={n => `${n ?? GYM_DEFAULT_RADIUS_M} meters`}
                  />
                </View>
              </View>
              <HelpText style={styles.hint}>Starting a workout inside this distance picks this gym.</HelpText>
            </>
          ) : (
            <>
              <PlaceAddressField
                text={v.placeText}
                onChangeText={t => patch({ placeText: t })}
                onPickPlace={pin => { if (pin) patch({ pin }); }}
                picked={false}
                placeholder="Search for an address or place"
                accessibilityLabel="Gym address"
              />
              <TouchableOpacity
                style={[styles.card, styles.row, styles.actionRow]}
                onPress={() => { void useHere(); }}
                disabled={locating}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Use my current location for this gym"
              >
                <Ionicons name="navigate" size={iconSize.md} color={colors.accentText} />
                <Text style={styles.actionText}>{locating ? 'Finding…' : 'Use my current location'}</Text>
              </TouchableOpacity>
              <HelpText style={styles.hint}>Used to pick this gym when you start a workout.</HelpText>
            </>
          )}

          <Text style={styles.label}>Equipment here</Text>
          {GYM_EQUIPMENT_GROUPS.map(group => (
            <View key={group.title}>
              <Text style={styles.subLabel}>{group.title}</Text>
              <PillGroup
                noun="piece of equipment"
                pluralNoun="pieces of equipment"
                surface="page"
                limit={group.items.length}
                options={group.items.map(e => ({
                  key: e,
                  label: EQUIPMENT_LABELS[e],
                  selected: v.equipment.includes(e),
                  onPress: () => toggle(e),
                }))}
              />
            </View>
          ))}
          <HelpText style={styles.hint}>
            Exercises that need something this gym doesn’t have are flagged during a workout. Leave all of it off if you’d rather not say.
          </HelpText>

          {existing && (
            <>
              <Text style={styles.label}>Exercise notes here</Text>
              {notes.length > 0 && (
                <View style={styles.card}>
                  {notes.map(({ exerciseId, text, name }, i) => (
                    <View key={exerciseId} style={[styles.noteRow, i > 0 && styles.ruled]}>
                      <Text style={styles.noteName}>{name}</Text>
                      <TextField
                        style={styles.noteInput}
                        defaultValue={text}
                        autoFocus={text === ''}
                        onEndEditing={e => {
                          useGymStore.getState().setGymExercise(existing.id, exerciseId, { notes: e.nativeEvent.text });
                          setDrafts(prev => prev.filter(id => id !== exerciseId));
                        }}
                        placeholder="e.g. Seat 4"
                        placeholderTextColor={colors.textTertiary}
                        multiline
                        accessibilityLabel={`Note on ${name} at ${existing.name}`}
                      />
                    </View>
                  ))}
                </View>
              )}
              <View style={styles.addRow}>
                <InlineAction icon="add" label="Add a note" variant="neutral" surface="page" onPress={() => { haptics.tap(); setPicking(true); }} />
              </View>
              <HelpText style={styles.hint}>A note shows under the exercise when you work out here. You can also add one during a workout.</HelpText>
              <TouchableOpacity
                style={styles.deleteRow}
                onPress={remove}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${existing.name}`}
              >
                <Text style={styles.deleteText}>Delete gym</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
      {/* Inside this Modal, not beside it: a second sheet presented from the
          same view controller as this one never appears. */}
      <ExercisePickerSheet
        visible={visible && picking}
        onClose={() => setPicking(false)}
        onPick={exerciseId => {
          setPicking(false);
          setDrafts(prev => (prev.includes(exerciseId) ? prev : [...prev, exerciseId]));
        }}
        addedIds={notes.map(n => n.exerciseId)}
        addedLabel="Has a note"
      />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  form: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl * 2 },
  nameInput: {
    color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold, backgroundColor: colors.bgSecondary,
    borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 52, marginTop: spacing.xs,
  },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  subLabel: {
    color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.semibold,
    marginTop: spacing.md, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  // Every row of the card is the same height, whatever its control, so the
  // lines sit at an even interval.
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd,
    paddingHorizontal: spacing.md, minHeight: 52,
  },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowLabel: { color: colors.text, fontSize: font.md, flexShrink: 1 },
  grow: { flex: 1 },
  actionRow: { justifyContent: 'flex-start', marginTop: spacing.sm },
  actionText: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
  noteRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  noteName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  noteInput: { color: colors.textSecondary, fontSize: font.md, marginTop: spacing.xs, minHeight: 28, padding: 0 },
  addRow: { flexDirection: 'row', marginTop: spacing.sm },
  deleteRow: {
    marginTop: spacing.xl, backgroundColor: colors.bgSecondary, borderRadius: radius.md, minHeight: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteText: { color: colors.redText, fontSize: font.md },
});
