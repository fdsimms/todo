import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Recipe } from '../types';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { CountStepper } from './CountStepper';
import { EditorRow } from './EditorRow';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EditorSheet } from './EditorSheet';

interface Props {
  visible: boolean;
  recipe: Recipe | null;
  onClose: () => void;
  /** Fired after a confirmed delete, so the detail screen can pop itself. */
  onDeleted: () => void;
}

/**
 * Everything about a recipe that isn't its ingredient list: the name, what it
 * serves, where it came from, and the notes. Same progressive-disclosure shape
 * as TemplateEditor — the rarely-changed rows sit under the name.
 */
export function RecipeEditor({ visible, recipe, onClose, onDeleted }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const renameRecipe = useRecipeStore(s => s.renameRecipe);
  const setNotes = useRecipeStore(s => s.setNotes);
  const setSourceUrl = useRecipeStore(s => s.setSourceUrl);
  const setServings = useRecipeStore(s => s.setServings);
  const deleteRecipe = useRecipeStore(s => s.deleteRecipe);

  const [name, setName] = useState('');
  const [notes, setNotesDraft] = useState('');
  const [url, setUrl] = useState('');
  const [servings, setServingsDraft] = useState<number | null>(null);
  const [servingsOpen, setServingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  useEffect(() => {
    if (!recipe) return;
    setName(recipe.name);
    setNotesDraft(recipe.notes);
    setUrl(recipe.sourceUrl ?? '');
    setServingsDraft(recipe.servings);
    setServingsOpen(false);
    setSourceOpen(false);
  }, [recipe]);

  const saveAndClose = () => {
    if (!recipe) { onClose(); return; }
    // renameRecipe refuses an empty name or a collision, and says so by
    // returning false — surfacing it here rather than silently discarding the
    // edit, which is what a plain `if (trimmed)` would do.
    if (name.trim() && name.trim() !== recipe.name && !renameRecipe(recipe.id, name)) {
      Alert.alert('That name is taken', 'Another recipe already goes by that name.');
      return;
    }
    setNotes(recipe.id, notes);
    setSourceUrl(recipe.id, url);
    setServings(recipe.id, servings);
    onClose();
  };

  const handleDelete = () => {
    if (!recipe) return;
    haptics.warning();
    Alert.alert(
      'Delete Recipe',
      `Delete “${recipe.name}”? Anything already on your grocery list stays there.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            deleteRecipe(recipe.id);
            onDeleted();
          },
        },
      ]
    );
  };

  if (!recipe) return null;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={saveAndClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={saveAndClose} minWidth={40} />
          <Text style={styles.headerTitle}>Edit Recipe</Text>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete recipe ${recipe.name}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </>
      }
    >
      <TextInput
        style={styles.titleInput}
        value={name}
        onChangeText={setName}
        placeholder="Recipe name"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={RECIPE_NAME_MAX_LENGTH}
        accessibilityLabel="Recipe name"
      />

      <View style={styles.sectionCard}>
        <EditorRow
          icon="people-outline"
          label="Serves"
          value={servings !== null ? String(servings) : undefined}
          hint="How many the quantities below are written for."
          expanded={servingsOpen}
          onPress={() => { animateLayout(); setServingsOpen(v => !v); }}
          onClear={servings !== null ? () => { setServingsDraft(null); setServingsOpen(false); } : undefined}
        />
        {servingsOpen && (
          <View style={styles.stepperRow}>
            <CountStepper
              value={servings}
              onChange={setServingsDraft}
              min={1}
              max={99}
              // The floor clears it, so the row's × isn't the only way back to
              // "no serving size".
              allowNull
              emptyLabel="—"
              label="Servings"
              describeValue={n => (n === null ? 'not set' : `serves ${n}`)}
            />
          </View>
        )}
        <EditorRow
          icon="link-outline"
          label="Source"
          value={url.trim() || undefined}
          expanded={sourceOpen}
          onPress={() => { animateLayout(); setSourceOpen(v => !v); }}
        />
        {sourceOpen && (
          <TextInput
            style={styles.urlInput}
            value={url}
            onChangeText={setUrl}
            placeholder="Where it came from"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Recipe source"
          />
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.groupLabel}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          value={notes}
          onChangeText={setNotesDraft}
          placeholder="Method, timings, what you'd change"
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Recipe notes"
        />
      </View>
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  titleInput: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: fontWeight.semibold,
    // A box height rather than lineHeight: RN puts lineHeight straight onto the
    // iOS paragraph style with no baseline offset, sitting the glyphs low.
    minHeight: 44,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  groupLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingTop: spacing.sm,
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: spacing.sm,
  },
  urlInput: {
    color: colors.text,
    fontSize: font.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
  },
  notesInput: {
    color: colors.text,
    fontSize: font.md,
    paddingVertical: spacing.sm,
    minHeight: 96,
  },
});
