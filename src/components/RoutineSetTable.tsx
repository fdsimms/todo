// One routine item's planned sets as a table, the way workout mode lays them
// out: a row per set, its badge (W, 1, 2, D, F) and its values. Nothing in
// the table expands. Tapping a badge opens the set's type, Duplicate and
// Remove in a small card anchored to it; the values are fields typed in place,
// like workout mode's. Mock: docs/arch/workouts-mocks/routine-sets.png.
//
// The rules (what each edit changes, warm-ups first, the last set that isn't a
// warm-up never going) live in src/utils/workoutRoutine.ts; this file draws them.
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, type CardAnchor } from './CardSheet';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';
import type { ExerciseKind, RoutineSetTarget, WorkoutRoutineItem, WorkoutSetKind } from '../types';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { useTextScale } from '../hooks/useTextScale';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { formatRestSeconds, formatWeightNumber } from '../utils/workoutData';
import { parseRepsTarget, parseSetCell } from '../utils/workoutCell';
import { columnLabel, fieldLabel, setBadge, setFieldsFor, setName, type SetField } from '../utils/workoutSession';
import {
  MAX_ROUTINE_SETS, MAX_WARMUP_SETS, SET_KIND_LABELS, addSet, addWarmup, canDuplicateSet, canRemoveSet,
  describeTargetReps, duplicateSet, kindsFor, removeSet, routineSetLabels, withSetDuration, withSetKind,
  withSetReps, withSetWeight,
} from '../utils/workoutRoutine';
import type { WeightUnit } from '../utils/weightLog';

interface Props {
  item: WorkoutRoutineItem;
  kind: ExerciseKind;
  unit: WeightUnit;
  /** "32.5, 50 and 65 kg": what a ramp lays out from the target weight, or null with none to ramp from. */
  rampLoads: string | null;
  onChange: (change: (item: WorkoutRoutineItem) => WorkoutRoutineItem) => void;
}

/** The card open over the table: a set's type menu. */
interface Editing {
  index: number;
  anchor: CardAnchor;
}

/** The value columns a routine can plan. Distance has no target control, as before. */
const EDITABLE: readonly SetField[] = ['weight', 'reps', 'duration'];

const anchorOf = (e: GestureResponderEvent): CardAnchor => ({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });

export function RoutineSetTable({ item, kind, unit, rampLoads, onChange }: Props) {
  const colors = useColors();
  const textScale = useTextScale();
  const styles = useMemo(() => makeStyles(colors, textScale), [colors, textScale]);
  const [editing, setEditing] = useState<Editing | null>(null);

  const fields = setFieldsFor(kind).filter(f => EDITABLE.includes(f));
  const labels = routineSetLabels(item.targets);
  const warmups = item.targets.filter(t => t.kind === 'warmup').length;
  const work = item.targets.length - warmups;
  // Warm-ups are for a lift with a weight, as the ramp is; the ramp itself is
  // laid out from a plain weight, so only that kind gets one.
  const takesWarmups = fields.includes('weight');

  const open = (index: number) => (e: GestureResponderEvent) => {
    haptics.tap();
    setEditing({ index, anchor: anchorOf(e) });
  };

  // What the field holds while it is typed in, which for a reps range is the
  // text it was read from ("8–12"), and for an AMRAP the floor without its "+".
  const cellText = (t: RoutineSetTarget, field: SetField): string | null => {
    if (field === 'weight') return t.weightKg != null ? formatWeightNumber(t.weightKg, unit) : null;
    if (field === 'reps') return describeTargetReps(t);
    if (field === 'duration') return t.durationSeconds != null ? formatRestSeconds(t.durationSeconds) : null;
    return null;
  };

  const commitCell = (index: number, field: SetField, text: string) => {
    if (field === 'reps') {
      const reps = parseRepsTarget(text);
      if (reps) onChange(i => withSetReps(i, index, reps.min, reps.max));
      return;
    }
    const patch = parseSetCell(field, text, unit);
    if (!patch) return;
    if (field === 'weight') onChange(i => withSetWeight(i, index, patch.weightKg ?? null));
    else if (field === 'duration') onChange(i => withSetDuration(i, index, patch.durationSeconds ?? null));
  };

  const placeholderFor = (t: RoutineSetTarget, field: SetField): string => {
    if (field === 'weight') return 'Last time';
    if (field === 'reps' && t.kind === 'amrap') return 'Max';
    return 'Any';
  };

  const editingTarget = editing ? item.targets[editing.index] : undefined;

  return (
    <View>
      <View style={styles.head} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={[styles.headCell, styles.colBadge, styles.headSet]}>Set</Text>
        {fields.map(f => (
          <Text key={f} style={[styles.headCell, styles.colValue, styles.headValue]}>{columnLabel(f, kind, unit)}</Text>
        ))}
      </View>

      {item.warmupRamp && (
        <View style={styles.row}>
          <View style={styles.colBadge}>
            <View style={styles.badgeBox}><Text style={styles.badgeLetter}>W</Text></View>
          </View>
          <Text style={styles.rampText}>
            {rampLoads ? `Ramp: ${rampLoads}` : 'Ramp from last time’s working weight'}
          </Text>
        </View>
      )}

      {item.targets.map((t, index) => {
        const label = labels[index];
        const lettered = setBadge(t.kind) !== null;
        const name = setName(t.kind, label);
        return (
          <View key={index} style={styles.row}>
            <View style={styles.colBadge}>
              <TouchableOpacity
                style={styles.badgeBox}
                onPress={open(index)}
                activeOpacity={interaction.activeOpacity}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`${name}. Change its type, duplicate or remove it`}
              >
                <Text style={lettered ? styles.badgeLetter : styles.badgeNumber}>{label}</Text>
              </TouchableOpacity>
            </View>
            {fields.map(f => {
              const text = cellText(t, f);
              // A set planned as a percentage of a training max has no weight
              // to type; it reads as the percentage and the program owns it.
              if (f === 'weight' && t.weightKg == null && t.pctOfTm != null) {
                return (
                  <View key={f} style={styles.colValue}>
                    <View style={styles.cell}><Text style={styles.cellText} numberOfLines={1}>{`${t.pctOfTm}%`}</Text></View>
                  </View>
                );
              }
              return (
                <View key={f} style={styles.colValue}>
                  <CellInput
                    value={text ?? ''}
                    field={f}
                    placeholder={placeholderFor(t, f)}
                    onCommit={v => commitCell(index, f, v)}
                    styles={styles}
                    placeholderColor={colors.textTertiary}
                    accessibilityLabel={`${name} ${fieldLabel(f, kind).toLowerCase()}`}
                  />
                </View>
              );
            })}
          </View>
        );
      })}

      <View style={styles.adds}>
        {work < MAX_ROUTINE_SETS && (
          <InlineAction
            icon="add"
            label="Add set"
            onPress={() => { haptics.tap(); animateLayout(); onChange(addSet); }}
          />
        )}
        {takesWarmups && warmups < MAX_WARMUP_SETS && (
          <InlineAction
            icon="add"
            label="Warm-up"
            variant="neutral"
            onPress={() => { haptics.tap(); animateLayout(); onChange(addWarmup); }}
            accessibilityLabel="Add a warm-up set"
          />
        )}
      </View>

      <CardSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        anchor={editing?.anchor ?? null}
        expectedHeight={340}
        name="RoutineSetEdit"
      >
        {close => {
          if (!editing || !editingTarget) return null;
          const index = editing.index;
          const numberIfWorking = String(item.targets.slice(0, index).filter(x => x.kind === 'working').length + 1);
          const act = (change: (i: WorkoutRoutineItem) => WorkoutRoutineItem) => close(() => {
            animateLayout();
            onChange(change);
          });
          return (
            <View>
              {kindsFor(item, index).map((k: WorkoutSetKind) => {
                const current = k === editingTarget.kind;
                return (
                  <TouchableOpacity
                    key={k}
                    style={styles.menuRow}
                    onPress={() => { haptics.tap(); act(i => withSetKind(i, index, k)); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityState={{ selected: current }}
                  >
                    <Text style={[styles.menuBadge, setBadge(k) ? styles.badgeLetter : styles.badgeNumber]}>
                      {setBadge(k) ?? numberIfWorking}
                    </Text>
                    <Text style={styles.menuLabel}>{SET_KIND_LABELS[k]}</Text>
                    {current && <Ionicons name="checkmark" size={iconSize.md} color={colors.accentText} />}
                  </TouchableOpacity>
                );
              })}
              {(canDuplicateSet(item, index) || canRemoveSet(item, index)) && <View style={styles.menuGap} />}
              {canDuplicateSet(item, index) && (
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => { haptics.tap(); act(i => duplicateSet(i, index)); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                >
                  <Ionicons name="copy-outline" size={iconSize.md} color={colors.textSecondary} style={styles.menuIcon} />
                  <Text style={styles.menuLabel}>Duplicate set</Text>
                </TouchableOpacity>
              )}
              {canRemoveSet(item, index) && (
                <TouchableOpacity
                  style={styles.menuRow}
                  onPress={() => { haptics.tap(); act(i => removeSet(i, index)); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                >
                  <Ionicons name="trash-outline" size={iconSize.md} color={colors.redText} style={styles.menuIcon} />
                  <Text style={[styles.menuLabel, styles.menuDanger]}>Remove set</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      </CardSheet>
    </View>
  );
}

/**
 * One value cell, typed in place. The text is a draft held here until the field
 * loses focus, because `TextField` takes a `value` only when it differs from
 * what the field last reported, so writing each keystroke through would turn
 * "10." into "10" under the person's finger (workout mode's `SetInput` does the
 * same). A blank cell is "from last time", which the placeholder says.
 */
function CellInput({ value, field, placeholder, onCommit, styles, placeholderColor, accessibilityLabel }: {
  value: string;
  field: SetField;
  placeholder: string;
  onCommit: (text: string) => void;
  styles: ReturnType<typeof makeStyles>;
  placeholderColor: string;
  accessibilityLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    if (text.trim() !== value) onCommit(text);
  };
  return (
    <TextField
      style={styles.cellInput}
      value={draft ?? value}
      onChangeText={setDraft}
      onFocus={() => setDraft(value)}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder={placeholder}
      placeholderTextColor={placeholderColor}
      keyboardType={field === 'weight' ? 'decimal-pad' : 'numbers-and-punctuation'}
      selectTextOnFocus
      returnKeyType="done"
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const makeStyles = (colors: Colors, textScale: number) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.xsm },
  headCell: {
    color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.semibold, letterSpacing: 0.8, textTransform: 'uppercase',
  },
  // An alignment column, so it grows with the text it holds (see textScale in
  // src/theme/index.ts).
  colBadge: { width: 44 * textScale, alignItems: 'center' },
  colValue: { flex: 1, alignItems: 'flex-start' },
  headSet: { textAlign: 'center' },
  // In line with the text inside the cells below, not with their edges.
  headValue: { paddingLeft: spacing.smd },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xsm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  badgeBox: {
    minWidth: 36, minHeight: 32, paddingHorizontal: spacing.xsm, borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  // The letters are workout mode's, in its colour, so a routine reads the way its workout will.
  badgeLetter: { color: colors.orangeText, fontSize: font.md, fontWeight: fontWeight.bold },
  badgeNumber: { color: colors.textSecondary, fontSize: font.md, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  cell: {
    minWidth: 72, minHeight: 36, paddingHorizontal: spacing.smd, borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary, justifyContent: 'center',
  },
  cellInput: {
    minWidth: 72, minHeight: 36, paddingHorizontal: spacing.smd, borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
    color: colors.text, fontSize: font.lg, fontVariant: ['tabular-nums'],
  },
  cellText: { color: colors.text, fontSize: font.lg, fontVariant: ['tabular-nums'] },
  rampText: { flex: 1, color: colors.textSecondary, fontSize: font.md },
  adds: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator,
  },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: 48,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
  },
  menuBadge: { width: 22, textAlign: 'center' },
  menuIcon: { width: 22, textAlign: 'center' },
  menuLabel: { flex: 1, color: colors.text, fontSize: font.lg },
  menuDanger: { color: colors.redText },
  menuGap: { height: spacing.sm, backgroundColor: colors.separator, opacity: 0.5 },
});
