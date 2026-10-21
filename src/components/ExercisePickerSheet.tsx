import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SearchField } from './SearchField';
import { HighlightedText } from './HighlightedText';
import { InlineAction } from './InlineAction';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { PillGroup } from './PillGroup';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { EmptyNote } from './EmptyNote';
import { ExerciseFilterBar, useExerciseFilters } from './ExerciseFilterBar';
import type { ExerciseEquipment, ExerciseKind, MuscleGroup } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useFilterField } from '../hooks/useFilterField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { describeExercise, searchExercises, type ExerciseSearchResult } from '../utils/exerciseCatalog';
import {
  EQUIPMENT_LABELS, EXERCISE_EQUIPMENT, MUSCLE_GROUPS, MUSCLE_LABELS, WORKOUT_NAME_MAX_LENGTH, cleanWorkoutName
} from '../utils/workoutData';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with the exercise picked, or the one just made. The sheet closes itself after. */
  onPick: (exerciseId: string) => void;
  /** Exercises already in the routine or the workout: shown, but not offered twice. */
  addedIds?: readonly string[];
  /** What the list says they are already in: "In routine", "In workout". */
  addedLabel?: string;
  /** Exercises to list first while nothing is typed, in order: what a swap offers in place of the one shown. */
  suggestedIds?: readonly string[];
}

/** What a set records, as the create form and the exercise editor offer it. */
export const KIND_OPTIONS: SegmentOption<ExerciseKind>[] = [
  { value: 'weight_reps', label: 'Weight and reps' },
  { value: 'bodyweight_reps', label: 'Reps only' },
  { value: 'assisted_reps', label: 'Assisted' },
  { value: 'duration', label: 'Time' },
  { value: 'distance', label: 'Distance' },
  { value: 'weight_distance', label: 'Weight, distance' },
];

/** What a refused name means, in the sheet's own words. */
const NAME_REFUSED: Record<string, string> = {
  blank: 'Give the exercise a name.',
  taken: 'That name is taken. Go back and search for the exercise instead.',
};

/**
 * Pick an exercise from the library and the person's own, or make a new one.
 * See the mock at docs/arch/workouts-mocks (exercise picker).
 *
 * **Picking commits on the tap**, so the list has nothing staged to lose. The
 * create form does stage what it is typed into, so it is the half the swipe
 * and the Cancel guard ask about (`confirmDiscard`), the pageSheet rule in
 * CLAUDE.md. It is a second view of the same sheet rather than a sheet over
 * this one, because two sheets up at once is the thing iOS refuses.
 *
 * Search is `searchExercises`, so "dumbbell chest" means dumbbell exercises for
 * the chest. The field's own text is offered as the new exercise's name, the
 * way a `PillGroup`'s filter offers to create what it can't find.
 */
export function ExercisePickerSheet({ visible, onClose, onPick, addedIds = [], addedLabel = 'Added', suggestedIds }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const exercises = useWorkoutStore(s => s.exercises);
  const addExercise = useWorkoutStore(s => s.addExercise);
  const search = useFilterField();
  const added = useMemo(() => new Set(addedIds), [addedIds]);
  const filter = useExerciseFilters();
  const narrowed = filter.narrowed;
  const results = useMemo(() => {
    if (!visible) return [];
    const found = searchExercises(exercises, search.query, filter.filters);
    if (!suggestedIds || suggestedIds.length === 0 || search.query.trim() !== '' || narrowed) return found;
    const rank = new Map(suggestedIds.map((id, i) => [id, i]));
    // Suggested first, in the order given; the rest keep the catalog's.
    return [
      ...found.filter(r => rank.has(r.exercise.id)).sort((a, b) => rank.get(a.exercise.id)! - rank.get(b.exercise.id)!),
      ...found.filter(r => !rank.has(r.exercise.id)),
    ];
  }, [visible, exercises, search.query, suggestedIds, filter.filters, narrowed]);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ExerciseKind>('weight_reps');
  const [equipment, setEquipment] = useState<ExerciseEquipment>('barbell');
  const [muscles, setMuscles] = useState<MuscleGroup[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const resetForm = () => {
    setCreating(false);
    setName('');
    setKind('weight_reps');
    setEquipment('barbell');
    setMuscles([]);
    setRefusal(null);
  };

  const close = () => {
    resetForm();
    search.clear();
    filter.clear();
    onClose();
  };

  const formDirty = creating && (cleanWorkoutName(name) !== '' || muscles.length > 0);
  const handleCancel = () => {
    if (!formDirty) { close(); return; }
    confirmDiscard(close, { title: 'Discard this exercise?', message: 'It hasn’t been saved yet. If you leave now, it will be lost.' });
  };

  const pick = (id: string) => {
    haptics.tap();
    onPick(id);
    close();
  };

  const openCreate = () => {
    haptics.tap();
    setName(search.query.trim());
    setCreating(true);
  };

  const save = () => {
    const result = addExercise({ name, kind, equipment, primaryMuscles: muscles });
    if (typeof result === 'string') {
      haptics.warning();
      setRefusal(NAME_REFUSED[result] ?? 'This exercise could not be saved.');
      return;
    }
    haptics.success();
    onPick(result.id);
    close();
  };

  const renderRow = useCallback(({ item }: { item: ExerciseSearchResult }) => {
    const e = item.exercise;
    const isAdded = added.has(e.id);
    return (
      <TouchableOpacity
        style={[styles.row, isAdded && styles.rowAdded]}
        onPress={() => pick(e.id)}
        disabled={isAdded}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityState={{ disabled: isAdded }}
        accessibilityLabel={`${e.name}, ${describeExercise(e)}${isAdded ? `, ${addedLabel.toLowerCase()}` : ''}`}
      >
        <View style={styles.rowText}>
          <HighlightedText text={e.name} ranges={item.nameMatches} style={styles.rowName} highlightStyle={styles.rowNameHit} numberOfLines={2} />
          <Text style={styles.rowMeta} numberOfLines={1}>{describeExercise(e, item.viaOtherName)}</Text>
        </View>
        {isAdded && <Text style={styles.addedTag}>{addedLabel}</Text>}
      </TouchableOpacity>
    );
    // `pick` closes over onPick and the field, which are stable for a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styles, added, addedLabel, onPick]);

  const typed = search.query.trim();

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel} name="ExercisePickerSheet">
      <View style={styles.root}>
        {creating ? (
          <>
            <SheetHeader
              title="New exercise"
              left={<SheetHeaderButton label="Back" role="cancel" onPress={() => (formDirty ? confirmDiscard(resetForm, { title: 'Discard this exercise?', message: 'It hasn’t been saved yet. If you go back now, it will be lost.' }) : resetForm())} minWidth={64} />}
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
                value={name}
                onChangeText={t => { setName(t); setRefusal(null); }}
                placeholder="Exercise name"
                placeholderTextColor={colors.textTertiary}
                maxLength={WORKOUT_NAME_MAX_LENGTH}
                autoFocus
                returnKeyType="done"
                accessibilityLabel="Exercise name"
              />
              {refusal && <Text style={styles.refusal}>{refusal}</Text>}
              <Text style={styles.label}>What a set records</Text>
              <SegmentedControl options={KIND_OPTIONS} value={kind} onChange={setKind} columns={3} label="What a set records" surface="page" />
              <Text style={styles.label}>Equipment</Text>
              <PillGroup
                noun="piece of equipment"
                pluralNoun="pieces of equipment"
                surface="page"
                filterPlaceholder="Find equipment…"
                options={EXERCISE_EQUIPMENT.map(q => ({
                  key: q,
                  label: EQUIPMENT_LABELS[q],
                  selected: q === equipment,
                  onPress: () => { haptics.tap(); setEquipment(q); },
                }))}
              />
              <Text style={styles.label}>Muscles it works</Text>
              <PillGroup
                noun="muscle"
                surface="page"
                options={MUSCLE_GROUPS.map(m => ({
                  key: m,
                  label: MUSCLE_LABELS[m],
                  selected: muscles.includes(m),
                  onPress: () => {
                    haptics.tap();
                    setMuscles(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]));
                  },
                }))}
              />
              <HelpText style={styles.hint}>Pick the muscles that do most of the work. Search finds the exercise by them.</HelpText>
            </ScrollView>
          </>
        ) : (
          <>
            <SheetHeader
              title="Add exercise"
              left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
              right={<View style={styles.headerSpacer} />}
            />
            <SearchField
              field={search}
              placeholder="Search by name, muscle or equipment"
              style={styles.search}
              accessibilityLabel="Search exercises"
            />
            <ExerciseFilterBar
              state={filter}
              exercises={exercises}
              leading={
                <InlineAction
                  icon="add"
                  label={typed ? `Create “${typed.length > 28 ? `${typed.slice(0, 27)}…` : typed}”` : 'Create an exercise'}
                  variant="neutral"
                  surface="page"
                  onPress={openCreate}
                />
              }
            />
            <FlatList
              data={results}
              keyExtractor={r => r.exercise.id}
              renderItem={renderRow}
              style={styles.flex}
              contentContainerStyle={results.length === 0 ? styles.emptyList : styles.list}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              initialNumToRender={20}
              ListEmptyComponent={
                <EmptyNote icon="search-outline">
                  {narrowed
                    ? 'No exercise matches these filters. Remove one to see more.'
                    : `No exercise matches “${typed}”. Create it with the button above.`}
                </EmptyNote>
              }
            />
          </>
        )}
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  headerSpacer: { minWidth: 64 },
  search: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  emptyList: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    backgroundColor: colors.bgSecondary, paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
    minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  rowAdded: { opacity: 0.6 },
  rowText: { flex: 1 },
  rowName: { color: colors.text, fontSize: font.md },
  rowNameHit: { color: colors.accentText, fontWeight: fontWeight.semibold },
  rowMeta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  addedTag: { color: colors.textTertiary, fontSize: font.sm },
  form: { padding: spacing.md, paddingBottom: spacing.xl },
  nameInput: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, color: colors.text,
    fontSize: font.lg, paddingHorizontal: spacing.md, minHeight: 48,
  },
  refusal: { color: colors.redText, fontSize: font.sm, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
  hint: { color: colors.textTertiary, fontSize: font.xs, marginTop: spacing.sm, marginHorizontal: spacing.xs },
});
