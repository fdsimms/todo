import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyNote } from './EmptyNote';
import { GymEditorSheet } from './GymEditorSheet';
import { useGymStore } from '../store/useGymStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import type { Gym } from '../types';
import { haptics } from '../utils/haptics';
import { EQUIPMENT_LABELS } from '../utils/workoutData';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Set to choose a gym for the workout in progress: a row then picks and closes
   * rather than opening the editor (its chevron still does), and a "No gym" row
   * appears. Absent for the plain list, where a row opens the editor.
   */
  onPick?: (gymId: string | null) => void;
  /** The gym ticked in pick mode. */
  currentId?: string | null;
}

/** "Barbell, Dumbbell and 3 more", or "No equipment listed". */
export function describeGymEquipment(gym: Pick<Gym, 'equipment'>): string {
  const names = gym.equipment.map(e => EQUIPMENT_LABELS[e]);
  if (names.length === 0) return 'No equipment listed';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/**
 * The person's gyms: the list (from the Workouts menu) and, with `onPick`, the
 * chooser a workout in progress changes its gym from. A page sheet with nothing
 * staged, so there is no discard guard; the editor is nested inside this
 * sheet's Modal (two sheets presented side by side never both appear).
 */
export function GymsSheet({ visible, onClose, onPick, currentId = null }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const gyms = useGymStore(s => s.gyms);
  const [subject, setSubject] = useState<string | 'new' | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const active = gyms.filter(g => !g.archived);
  const archived = gyms.filter(g => g.archived);

  const open = (id: string | 'new') => { haptics.tap(); setSubject(id); setEditorOpen(true); };

  const row = (gym: Gym, i: number) => (
    <View key={gym.id} style={[styles.row, i > 0 && styles.ruled]}>
      <TouchableOpacity
        style={styles.rowMain}
        onPress={() => { if (onPick) { haptics.tap(); onPick(gym.id); onClose(); } else open(gym.id); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={onPick ? `Use ${gym.name}` : `Edit ${gym.name}`}
        accessibilityState={onPick ? { selected: gym.id === currentId } : undefined}
      >
        <View style={styles.rowText}>
          <Text style={styles.name}>{gym.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>{describeGymEquipment(gym)}</Text>
        </View>
        {onPick && gym.id === currentId && <Ionicons name="checkmark" size={iconSize.md} color={colors.accent} />}
      </TouchableOpacity>
      {onPick && (
        <TouchableOpacity
          onPress={() => open(gym.id)}
          hitSlop={8}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${gym.name}`}
        >
          <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} name="GymsSheet">
      <View style={styles.root}>
        <SheetHeader
          title={onPick ? 'Gym' : 'Gyms'}
          left={<View style={styles.spacer} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} minWidth={64} />}
        />
        <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
          {onPick && (
            <View style={[styles.card, styles.gap]}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => { haptics.tap(); onPick(null); onClose(); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="No gym"
                accessibilityState={{ selected: currentId === null }}
              >
                <Text style={styles.name}>No gym</Text>
                {currentId === null && <Ionicons name="checkmark" size={iconSize.md} color={colors.accent} />}
              </TouchableOpacity>
            </View>
          )}
          {active.length > 0 ? (
            <View style={styles.card}>{active.map(row)}</View>
          ) : (
            <EmptyNote icon="barbell-outline">
              No gyms yet. Add the places you train and what each one has, and a workout can flag what a gym can’t do.
            </EmptyNote>
          )}
          <View style={styles.addRow}>
            <InlineAction icon="add" label="New gym" surface="page" onPress={() => open('new')} />
          </View>
          {archived.length > 0 && (
            <>
              <Text style={styles.label}>Archived</Text>
              <View style={styles.card}>{archived.map(row)}</View>
            </>
          )}
        </ScrollView>
      </View>
      <GymEditorSheet visible={visible && editorOpen} subject={subject} onClose={() => setEditorOpen(false)} />
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  spacer: { minWidth: 64 },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl * 2, paddingTop: spacing.sm },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  gap: { marginBottom: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    paddingHorizontal: spacing.md, minHeight: 56,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 56 },
  rowText: { flex: 1 },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  addRow: { flexDirection: 'row', marginTop: spacing.md },
  label: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: spacing.xs,
  },
});
