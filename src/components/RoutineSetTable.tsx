// One routine item's planned sets as a table, the way workout mode lays them
// out: a row per set, its badge (W, 1, 2, D, F) and its values. Nothing in
// the table expands. Tapping a badge opens the set's type, Duplicate and
// Remove; tapping a value opens a small card with its stepper, anchored to
// the cell, so the other sets stay in view while one changes. Mock:
// docs/arch/workouts-mocks/routine-sets.png.
//
// The rules (what each edit changes, warm-ups first, the last set that isn't a
// warm-up never going) live in src/utils/workoutRoutine.ts; this file draws them.
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, type CardAnchor } from './CardSheet';
import { CountStepper } from './CountStepper';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import type { ExerciseKind, RoutineSetTarget, WorkoutRoutineItem, WorkoutSetKind } from '../types';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { useTextScale } from '../hooks/useTextScale';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  WEIGHT_PLACES, WEIGHT_STEP, formatRestSeconds, formatWeightNumber, weightFromDisplay, weightToDisplay,
} from '../utils/workoutData';
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

/** The card open over the table: a set's type menu, or one of its values. */
interface Editing {
  field: 'kind' | 'weight' | 'reps' | 'duration';
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

  const open = (field: Editing['field'], index: number) => (e: GestureResponderEvent) => {
    haptics.tap();
    setEditing({ field, index, anchor: anchorOf(e) });
  };

  const cellText = (t: RoutineSetTarget, field: SetField): string | null => {
    if (field === 'weight') {
      if (t.weightKg != null) return formatWeightNumber(t.weightKg, unit);
      return t.pctOfTm != null ? `${t.pctOfTm}%` : null;
    }
    if (field === 'reps') return describeTargetReps(t);
    if (field === 'duration') return t.durationSeconds != null ? formatRestSeconds(t.durationSeconds) : null;
    return null;
  };

  const editingTarget = editing ? item.targets[editing.index] : undefined;
  const editingName = editing && editingTarget ? setName(editingTarget.kind, labels[editing.index] ?? '') : '';

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
                onPress={open('kind', index)}
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
              return (
                <View key={f} style={styles.colValue}>
                  <TouchableOpacity
                    style={styles.cell}
                    onPress={open(f as Editing['field'], index)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${name} ${fieldLabel(f, kind).toLowerCase()}, ${text ?? 'from last time'}`}
                  >
                    <Text style={text ? styles.cellText : styles.cellEmpty} numberOfLines={1}>{text ?? '–'}</Text>
                  </TouchableOpacity>
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
        expectedHeight={editing?.field === 'kind' ? 340 : 200}
        name="RoutineSetEdit"
      >
        {close => {
          if (!editing || !editingTarget) return null;
          const index = editing.index;
          if (editing.field === 'kind') {
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
          }
          return (
            <View style={styles.pop}>
              <Text style={styles.popTitle}>{editingName}</Text>
              {editing.field === 'weight' && (
                <>
                  <View style={styles.popRow}>
                    <Text style={styles.popLabel}>{fieldLabel('weight', kind)}</Text>
                    <CountStepper
                      value={editingTarget.weightKg != null ? weightToDisplay(editingTarget.weightKg, unit) : null}
                      onChange={n => onChange(i => withSetWeight(i, index, n === null ? null : weightFromDisplay(n, unit)))}
                      min={WEIGHT_STEP[unit]}
                      max={unit === 'kg' ? 500 : 1100}
                      step={WEIGHT_STEP[unit]}
                      places={WEIGHT_PLACES[unit]}
                      allowNull
                      emptyLabel="Last time"
                      format={n => `${n} ${unit}`}
                      label={`${editingName} ${fieldLabel('weight', kind).toLowerCase()}`}
                    />
                  </View>
                  <HelpText style={styles.popHint}>Leave it on Last time to start from the weight you lifted before.</HelpText>
                </>
              )}
              {editing.field === 'reps' && editingTarget.kind === 'amrap' && (
                <View style={styles.popRow}>
                  <Text style={styles.popLabel}>At least</Text>
                  <CountStepper
                    value={editingTarget.repsMin ?? editingTarget.repsMax ?? null}
                    onChange={n => onChange(i => withSetReps(i, index, n, n))}
                    min={1}
                    max={100}
                    allowNull
                    emptyLabel="Max"
                    label={`${editingName}, at least`}
                  />
                </View>
              )}
              {editing.field === 'reps' && editingTarget.kind !== 'amrap' && (
                <>
                  <View style={styles.popRow}>
                    <Text style={styles.popLabel}>From</Text>
                    <CountStepper
                      value={editingTarget.repsMin ?? null}
                      // Stepping one end past the other takes the other along,
                      // so the end being pressed is always the one that moves;
                      // either end stepped down to Any clears the range, which
                      // is a set that starts from last time's reps.
                      onChange={n => onChange(i => (n === null
                        ? withSetReps(i, index, null, null)
                        : withSetReps(i, index, n, Math.max(n, editingTarget.repsMax ?? n))))}
                      min={1}
                      max={100}
                      allowNull
                      emptyLabel="Any"
                      label={`${editingName}, fewest reps`}
                    />
                  </View>
                  <View style={styles.popRow}>
                    <Text style={styles.popLabel}>To</Text>
                    <CountStepper
                      value={editingTarget.repsMax ?? null}
                      onChange={n => onChange(i => (n === null
                        ? withSetReps(i, index, null, null)
                        : withSetReps(i, index, Math.min(n, editingTarget.repsMin ?? n), n)))}
                      min={1}
                      max={100}
                      allowNull
                      emptyLabel="Any"
                      label={`${editingName}, most reps`}
                    />
                  </View>
                </>
              )}
              {editing.field === 'duration' && (
                <View style={styles.popRow}>
                  <Text style={styles.popLabel}>Time</Text>
                  <CountStepper
                    value={editingTarget.durationSeconds ?? null}
                    onChange={n => onChange(i => withSetDuration(i, index, n))}
                    min={5}
                    max={3600}
                    step={5}
                    allowNull
                    emptyLabel="Any"
                    format={formatRestSeconds}
                    label={`${editingName} time`}
                  />
                </View>
              )}
            </View>
          );
        }}
      </CardSheet>
    </View>
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
  cellText: { color: colors.text, fontSize: font.lg, fontVariant: ['tabular-nums'] },
  cellEmpty: { color: colors.textTertiary, fontSize: font.lg },
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
  pop: { padding: spacing.md, gap: spacing.smd },
  popTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  popRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  popLabel: { color: colors.textSecondary, fontSize: font.md },
  popHint: { color: colors.textTertiary, fontSize: font.xs },
});
