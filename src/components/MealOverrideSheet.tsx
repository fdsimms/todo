import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { PillGroup } from './PillGroup';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { MealPlanEntry, Recipe, RecipeOverride } from '../types';
import { entryResolution } from '../utils/recipeComponents';
import {
  OVERRIDE_NOTE_MAX_LENGTH,
  overrideFromInput,
  overrideTargets,
  withOverride,
} from '../utils/mealOverrides';

interface Props {
  visible: boolean;
  /** The meal being changed. Read live; the sheet holds the last one while it fades. */
  entry: MealPlanEntry | null;
  recipe: Recipe | null;
  recipesById: ReadonlyMap<string, Recipe>;
  /** The pantry opinion the meal's own either/or defaults read, so the lines offered are the ones it cooks. */
  onHand?: ReadonlySet<string>;
  /** The meal's whole new list of replacements: this one added to (or replacing) what it had. */
  onSave: (overrides: RecipeOverride[]) => void;
  onClose: () => void;
}

type Mode = 'replace' | 'omit';

/** What a replacement reads back as in the text box: "8 oz vegan fish fillets". */
function replacementText(o: RecipeOverride): string {
  const r = o.replacement;
  return r ? [r.quantity, r.name, r.prep].filter(Boolean).join(' ') : '';
}

/**
 * Use something else in place of one line, or one used recipe, of a planned
 * meal's recipe, for this cooking only (`MealPlanEntry.recipeOverrides`).
 *
 * A short card with a pick and two fields, so it is a `CardSheet` rather than a
 * bottom sheet. It stages typed text before an explicit Save, so a swipe or a
 * tap outside asks before discarding, the same guard every staged sheet has.
 * Choosing a line the meal already replaces loads that replacement for editing,
 * and saving puts the new one in its place.
 */
export function MealOverrideSheet({ visible, entry: liveEntry, recipe: liveRecipe, recipesById, onHand, onSave, onClose }: Props) {
  // Held past the host clearing them on close, so the `return null` below can't
  // unmount the presented card mid-dismiss.
  const entry = useSheetSubject(liveEntry);
  const recipe = useSheetSubject(liveRecipe);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [targetId, setTargetId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('replace');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const card = useCardSheet();
  const finish = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const targets = useMemo(
    () => (entry && recipe ? overrideTargets(recipe, recipesById, entryResolution(entry, { onHand })) : []),
    [entry, recipe, recipesById, onHand]
  );

  // Blank each time the card opens, so a half-finished change never leaks into
  // the next one.
  useEffect(() => {
    if (!visible) return;
    setTargetId(null);
    setMode('replace');
    setText('');
    setNote('');
  }, [visible, entry?.id]);

  const pick = (id: string) => {
    haptics.tap();
    setTargetId(id);
    const existing = entry?.recipeOverrides.find(o => o.targetId === id);
    if (existing) {
      setMode(existing.replacement ? 'replace' : 'omit');
      setText(replacementText(existing));
      setNote(existing.note ?? '');
    } else {
      setMode('replace');
      setText('');
      setNote('');
    }
  };

  const built = targetId ? overrideFromInput(targetId, { mode, text, note }) : null;

  const save = () => {
    if (!entry || !built) return;
    haptics.success();
    finish(() => onSave(withOverride(entry.recipeOverrides, built)));
  };

  const dirty = targetId !== null && (text.trim() !== '' || note.trim() !== '' || mode === 'omit');
  const handleCancel = (close: (after?: () => void) => void) => {
    if (!dirty) { close(onClose); return; }
    Alert.alert(
      'Discard changes?',
      'Your changes haven’t been saved yet. If you leave now, they’ll be lost.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => close(onClose) },
      ],
    );
  };

  if (!entry || !recipe) return null;

  return (
    <CardSheet
      name="MealOverrideSheet"
      visible={visible}
      controller={card}
      onRequestClose={handleCancel}
    >
      <View style={styles.header}>
        <SheetHeaderButton label="Cancel" role="cancel" onPress={() => handleCancel(card.close)} />
        <Text style={styles.headerTitle}>Change for this meal</Text>
        <SheetHeaderButton label="Save" onPress={save} disabled={!built} />
      </View>

      <View style={styles.body}>
        <Text style={styles.fieldLabel}>WHAT TO CHANGE</Text>
        <PillGroup
          noun="ingredient"
          surface="card"
          filterPlaceholder="Find an ingredient…"
          options={targets.map(t => ({
            key: t.id,
            label: t.label,
            suffix: t.replaced
              ? '· changed'
              : t.kind === 'dish' ? '· recipe' : t.recipeName ? `· ${t.recipeName}` : undefined,
            selected: targetId === t.id,
            onPress: () => pick(t.id),
          }))}
        />

        {targetId !== null && (
          <>
            <View style={styles.segmentWrap}>
              <SegmentedControl<Mode>
                label="Change"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'replace', label: 'Use instead' },
                  { value: 'omit', label: 'Leave out' },
                ]}
              />
            </View>

            {mode === 'replace' && (
              <>
                <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>USE INSTEAD</Text>
                <TextField
                  style={styles.input}
                  value={text}
                  onChangeText={setText}
                  placeholder="e.g. 8 oz vegan fish fillets"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  returnKeyType="next"
                  accessibilityLabel="What to use instead"
                />
              </>
            )}

            <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>NOTE</Text>
            <TextField
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Cook per the package first"
              placeholderTextColor={colors.textTertiary}
              maxLength={OVERRIDE_NOTE_MAX_LENGTH}
              returnKeyType="done"
              accessibilityLabel="Note on this change"
            />
          </>
        )}

        <Text style={styles.hint}>
          This applies to this meal only. The recipe is not changed, and it is not copied when
          the meal or week is.
        </Text>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.smd,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  body: { padding: spacing.md },
  fieldLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.xs, marginBottom: spacing.sm,
  },
  fieldLabelSpaced: { marginTop: spacing.lg },
  segmentWrap: { marginTop: spacing.lg },
  input: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.lg,
  },
});
