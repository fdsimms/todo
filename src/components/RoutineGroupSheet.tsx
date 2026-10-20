import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { groupNames, resolveGroupName } from '../utils/routineGroups';
import { WORKOUT_NAME_MAX_LENGTH } from '../utils/workoutData';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /**
   * The routine being moved, or null to make a new group. A new group exists
   * only once a routine holds its name, so that mode asks which routines go in.
   */
  routineId: string | null;
  onClose: () => void;
}

/**
 * Files a routine under a heading on the Routines tab ("Move to group"), or
 * makes a new heading from a name and the routines that go under it. Both
 * write `WorkoutRoutine.groupName`; see `routineGroups.ts`.
 */
export function RoutineGroupSheet({ visible, routineId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const routines = useWorkoutStore(s => s.routines);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (visible) { setName(''); setPicked([]); }
  }, [visible]);

  const routine = routineId ? routines.find(r => r.id === routineId) ?? null : null;
  const groups = useMemo(() => groupNames(routines), [routines]);
  const live = useMemo(() => routines.filter(r => !r.archived), [routines]);
  const typed = resolveGroupName(name, routines);

  const fileUnder = (ids: string[], groupName: string | null) => {
    const store = useWorkoutStore.getState();
    for (const id of ids) store.updateRoutine(id, { groupName });
    haptics.success();
    dismiss();
  };

  if (routineId === null) {
    const togglePicked = (id: string) => {
      haptics.tap();
      setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
    };
    const canSave = typed !== null && picked.length > 0;
    return (
      <CardSheet name="RoutineGroupSheet" visible={visible} controller={card} onRequestClose={dismiss}>
        <View style={styles.root}>
          <SheetHeader
            title="New group"
            left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
            right={(
              <SheetHeaderButton
                label={BUTTON_LABEL.save}
                disabled={!canSave}
                onPress={() => canSave && fileUnder(picked, typed)}
              />
            )}
          />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <TextField
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Group name"
              placeholderTextColor={colors.textTertiary}
              maxLength={WORKOUT_NAME_MAX_LENGTH}
              autoFocus
              returnKeyType="done"
              accessibilityLabel="Group name"
            />
            <Text style={styles.label}>Routines in it</Text>
            <View style={styles.card}>
              {live.map((r, i) => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.row, i > 0 && styles.rowRuled]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => togglePicked(r.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: picked.includes(r.id) }}
                  accessibilityLabel={r.name}
                >
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{r.name}</Text>
                    {r.groupName ? <Text style={styles.rowDetail} numberOfLines={1}>{`Now in ${r.groupName}`}</Text> : null}
                  </View>
                  {picked.includes(r.id) && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
                </TouchableOpacity>
              ))}
            </View>
            <HelpText style={styles.hint}>A group shows up once it has a routine in it.</HelpText>
          </ScrollView>
        </View>
      </CardSheet>
    );
  }

  const current = routine?.groupName ?? null;
  return (
    <CardSheet name="RoutineGroupSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title="Move to group"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<View style={styles.headerSpacer} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {(groups.length > 0 || current !== null) && (
            <View style={styles.card}>
              {groups.map((g, i) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.row, i > 0 && styles.rowRuled]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => fileUnder([routineId], g)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: g === current }}
                  accessibilityLabel={`Move to ${g}`}
                >
                  <Text style={styles.rowTitle} numberOfLines={1}>{g}</Text>
                  {g === current && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
                </TouchableOpacity>
              ))}
              {current !== null && (
                <TouchableOpacity
                  style={[styles.row, groups.length > 0 && styles.rowRuled]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => fileUnder([routineId], null)}
                  accessibilityRole="button"
                  accessibilityLabel="Take out of its group"
                >
                  <Text style={[styles.rowTitle, styles.rowOff]}>No group</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={styles.label}>New group</Text>
          <TextField
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Group name"
            placeholderTextColor={colors.textTertiary}
            maxLength={WORKOUT_NAME_MAX_LENGTH}
            returnKeyType="done"
            onSubmitEditing={() => typed && fileUnder([routineId], typed)}
            accessibilityLabel="New group name"
          />
          {typed !== null && typed !== current && (
            <View style={styles.addRow}>
              <InlineAction label={`Move to “${typed}”`} onPress={() => fileUnder([routineId], typed)} />
            </View>
          )}
        </ScrollView>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    flex: { flex: 1 },
    headerSpacer: { minWidth: 40 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { padding: spacing.md },
    card: { backgroundColor: colors.bgTertiary, borderRadius: radius.md, overflow: 'hidden' },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
      paddingHorizontal: spacing.md, paddingVertical: spacing.smd,
    },
    rowRuled: { borderTopWidth: 1, borderTopColor: colors.separator },
    rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
    rowDetail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    rowOff: { color: colors.textSecondary },
    label: {
      color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
      letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: spacing.sm,
    },
    input: {
      color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44,
    },
    addRow: { flexDirection: 'row', marginTop: spacing.sm },
    hint: { marginTop: spacing.md, color: colors.textSecondary, fontSize: font.sm },
  });
}
