import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { InlineAction } from './InlineAction';
import { TextField } from './TextField';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { FieldLabel } from './FieldLabel';

/**
 * The gym's parts of workout mode (docs/arch/workouts.md, "Gyms"): which gym
 * the workout is at, an exercise the gym can't do with a replacement proposed,
 * and the note kept for an exercise at this gym. Each is a plain presentation
 * of what `WorkoutModeSheet` works out, since that sheet owns the session and
 * every write.
 */

/**
 * The gym the workout is at, a quiet line above the exercise ("Planet Fitness"
 * with a chevron), opening the chooser. With two or more exercises the gym
 * can't do, "Swap all" proposes the best replacement for every one.
 */
export function GymLine({ name, unavailableCount, onChoose, onSwapAll }: {
  name: string | null;
  unavailableCount: number;
  onChoose: () => void;
  onSwapAll: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.lineRow}>
      <TouchableOpacity
        style={styles.line}
        onPress={() => { haptics.tap(); onChoose(); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={name ? `Gym: ${name}. Change it.` : 'No gym chosen. Choose one.'}
      >
        <Ionicons name="location-outline" size={iconSize.sm} color={colors.textSecondary} />
        <Text style={styles.lineText} numberOfLines={1}>{name ?? 'Choose a gym'}</Text>
        <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
      {unavailableCount >= 2 && (
        <InlineAction label={`Swap all unavailable (${unavailableCount})`} surface="page" onPress={onSwapAll} />
      )}
    </View>
  );
}

/**
 * "Not at this gym" on the shown exercise, with the closest match the gym has
 * and what it was last: Swap takes it, Other opens the picker over the gym's
 * own candidates, and Keep dismisses the notice for this workout. Keep leaves
 * nothing behind, so the exercise is flagged again in the next workout here.
 */
export function GymUnavailableBanner({ gymName, candidateName, candidateDetail, onSwap, onOther, onKeep }: {
  gymName: string;
  /** The best replacement, or null when the gym has nothing that works the same muscles. */
  candidateName: string | null;
  /** What it was last time ("last 100 kg × 5"), when it has history. */
  candidateDetail: string | null;
  onSwap: () => void;
  onOther: () => void;
  onKeep: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerTitle}>{`Not at ${gymName}`}</Text>
      {candidateName ? (
        <>
          <Text style={styles.bannerHint}>Closest match here, working the same muscles:</Text>
          <Text style={styles.candidate}>
            {candidateName}
            {candidateDetail ? <Text style={styles.candidateDetail}>{` · ${candidateDetail}`}</Text> : null}
          </Text>
        </>
      ) : (
        <Text style={styles.bannerHint}>Nothing here works the same muscles. You can pick another or keep it.</Text>
      )}
      <View style={styles.actions}>
        {candidateName && <InlineAction label="Swap" onPress={onSwap} accessibilityLabel={`Swap for ${candidateName}`} />}
        <InlineAction label="Select new exercise" variant="neutral" onPress={onOther} accessibilityLabel="Select new exercise" />
        <InlineAction label="Keep" variant="neutral" onPress={onKeep} accessibilityLabel="Keep this exercise and dismiss the notice" />
      </View>
    </View>
  );
}

/**
 * The note kept for this exercise at this gym, under the exercise's own. Shown
 * as text, or as a field while it is being written. Writing happens in the
 * sheet, which owns the draft the way it does the exercise's own note.
 */
export function GymNoteBox({ gymName, note, editing, draft, onChangeDraft, onCommit }: {
  gymName: string;
  note: string;
  editing: boolean;
  draft: string;
  onChangeDraft: (text: string) => void;
  onCommit: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (editing) {
    return (
      <>
        <FieldLabel>Note</FieldLabel>
        <TextField
          style={styles.noteInput}
          value={draft}
          onChangeText={onChangeDraft}
          onBlur={onCommit}
          onSubmitEditing={onCommit}
          placeholder="e.g. Seat 4, handle on the second hole"
          placeholderTextColor={colors.textTertiary}
          multiline
          autoFocus
          accessibilityLabel={`Note on this exercise at ${gymName}`}
        />
      </>
    );
  }
  if (!note) return null;
  return (
    <View style={styles.noteBox}>
      <Text style={styles.noteLabel}>{`At ${gymName}`}</Text>
      <Text style={styles.noteText}>{note}</Text>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1, minHeight: 32 },
  lineText: { color: colors.textSecondary, fontSize: font.sm, flexShrink: 1 },
  banner: {
    backgroundColor: colors.bgTertiary, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: colors.orangeText,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, marginTop: spacing.sm,
  },
  bannerTitle: { color: colors.orangeText, fontSize: font.sm, fontWeight: fontWeight.semibold },
  bannerHint: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xs },
  candidate: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold, marginTop: spacing.xs },
  candidateDetail: { color: colors.textSecondary, fontWeight: fontWeight.regular },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.smd },
  noteBox: { backgroundColor: colors.bgTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm },
  noteLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: spacing.xxs,
  },
  noteText: { color: colors.text, fontSize: font.md },
  noteInput: {
    color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 48, marginTop: spacing.sm,
  },
});
