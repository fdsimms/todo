import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useRecipeStore } from '../store/useRecipeStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { cleanIndexIngredients, splitIngredientText } from '../utils/cookbookIndex';
import { RECIPE_NAME_MAX_LENGTH, RECIPE_PAGE_MAX_LENGTH } from '../types';
import { TextField } from './TextField';

interface Props {
  visible: boolean;
  /** The book whose index this line is in. */
  cookbookId: string;
  /** The line being edited, or null to add a new one. */
  entryId: string | null;
  onClose: () => void;
}

/**
 * Adds or edits one line of a cookbook's index: the dish, its page, and the
 * ingredients the index files it under. See `CookbookIndexEntry` for why it is
 * a line and not a recipe.
 *
 * Staged and saved on Save rather than as typed, so it carries the
 * `handleCancel` discard guard every pageSheet holding typed state does (the
 * swipe-down calls `onRequestClose`, not Cancel).
 */
export function CookbookIndexEntrySheet({ visible, cookbookId, entryId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const cookbook = useRecipeStore(s => s.cookbookById(cookbookId));
  const entry = useRecipeStore(s => (entryId ? s.indexEntries.find(e => e.id === entryId) : undefined));
  const addIndexEntry = useRecipeStore(s => s.addIndexEntry);
  const updateIndexEntry = useRecipeStore(s => s.updateIndexEntry);
  const deleteIndexEntry = useRecipeStore(s => s.deleteIndexEntry);

  const [title, setTitle] = useState('');
  const [page, setPage] = useState('');
  const [ingredients, setIngredients] = useState('');
  // What the fields held when the sheet opened, so Cancel only asks when
  // something was actually changed.
  const opened = useRef({ title: '', page: '', ingredients: '' });

  useEffect(() => {
    if (!visible) return;
    const seed = {
      title: entry?.title ?? '',
      page: entry?.page ?? '',
      ingredients: entry?.ingredients.join(', ') ?? '',
    };
    opened.current = seed;
    setTitle(seed.title);
    setPage(seed.page);
    setIngredients(seed.ingredients);
    // Seeded on the open only: `entry` changes on every store write, and
    // re-seeding on those would stomp what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entryId]);

  const dirty = title !== opened.current.title
    || page !== opened.current.page
    || ingredients !== opened.current.ingredients;

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const handleSave = () => {
    const fields = { title, page: page || null, ingredients: splitIngredientText(ingredients) };
    const saved = entryId ? updateIndexEntry(entryId, fields) : addIndexEntry(cookbookId, fields) !== null;
    if (!saved) {
      haptics.error();
      // The only refusal a filled-in title can meet is a second line of that
      // name in this book's index.
      Alert.alert(
        'Already in the index',
        `${cookbook?.title ?? 'This book'}'s index already has a dish called “${title.trim()}”.`,
      );
      return;
    }
    haptics.success();
    onClose();
  };

  const handleDelete = () => {
    if (!entryId || !entry) return;
    haptics.warning();
    confirmDelete({
      title: 'Delete from index',
      message: `Remove “${entry.title}” from ${cookbook?.title ?? 'this book'}'s index?`,
      onConfirm: () => { deleteIndexEntry(entryId); onClose(); },
    });
  };

  const words = cleanIndexIngredients(splitIngredientText(ingredients));

  return (
    <SheetModal
      name="CookbookIndexEntrySheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={[styles.root, { paddingTop: spacing.md }]}>
        <SheetHeader
          title={entryId ? 'Edit index entry' : 'Add to index'}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} />}
          right={<SheetHeaderButton label="Save" onPress={handleSave} disabled={!title.trim()} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          <Text style={styles.fieldLabel}>DISH</Text>
          <TextField
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Name as the index prints it"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_NAME_MAX_LENGTH}
            autoFocus={!entryId}
            returnKeyType="next"
            accessibilityLabel="Dish name"
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>PAGE</Text>
          <TextField
            style={styles.input}
            value={page}
            onChangeText={setPage}
            placeholder="e.g. 142"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_PAGE_MAX_LENGTH + 3}
            returnKeyType="next"
            accessibilityLabel="Page number"
          />

          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>INGREDIENTS</Text>
          <TextField
            style={styles.input}
            value={ingredients}
            onChangeText={setIngredients}
            placeholder="e.g. lentils, shallots"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={() => { if (title.trim()) handleSave(); }}
            accessibilityLabel="Ingredients, separated by commas"
          />
          <Text style={styles.hint}>
            {words.length > 0
              ? `Found by searching for ${words.join(', ')} in Cook with…`
              : 'The ingredients the index lists this dish under, separated by commas. Cook with… finds it by these and by its name.'}
          </Text>

          {entryId && (
            <TouchableOpacity
              style={styles.deleteRow}
              onPress={handleDelete}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${entry?.title ?? 'entry'} from the index`}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
              <Text style={styles.deleteText}>Delete from index</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { padding: spacing.md },
  fieldLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.xs, marginBottom: spacing.sm,
  },
  fieldLabelSpaced: { marginTop: spacing.lg },
  input: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: font.xs,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    marginTop: spacing.xl,
  },
  deleteText: { color: colors.red, fontSize: font.md },
});
