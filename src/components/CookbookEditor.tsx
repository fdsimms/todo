import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRecipeStore } from '../store/useRecipeStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { RECIPE_SOURCE_MAX_LENGTH } from '../types';

interface Props {
  visible: boolean;
  /** Id of the cookbook being edited; null while the sheet is closed. */
  cookbookId: string | null;
  onClose: () => void;
}

/**
 * Title and author for one book on the shelf, plus deleting it.
 *
 * Autosaves on Done/close rather than staging a draft to confirm or discard —
 * same shape as `CategoryEditor`, and for the same reason: two plain text
 * fields have nothing worth a confirm dialog over, so `onRequestClose` runs
 * the same save path "Done" does instead of needing a dirty-guard.
 */
export function CookbookEditor({ visible, cookbookId, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cookbook = useRecipeStore(s => (cookbookId ? s.cookbookById(cookbookId) : undefined));
  const renameCookbook = useRecipeStore(s => s.renameCookbook);
  const deleteCookbook = useRecipeStore(s => s.deleteCookbook);
  const recipeCount = useRecipeStore(s =>
    cookbookId ? s.recipes.filter(r => r.cookbookId === cookbookId).length : 0
  );

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  // Reloads from the store each time the sheet opens on a book, so a
  // half-finished edit from last time never leaks into the next one — same
  // reasoning CategoryEditor's own load effect gives.
  useEffect(() => {
    if (!cookbook) return;
    setTitle(cookbook.title);
    setAuthor(cookbook.author ?? '');
    // Intentionally keyed on the id only — `cookbook` changes on every store
    // write, and re-syncing on those would stomp an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cookbookId]);

  const saveAndClose = () => {
    if (!cookbookId || !cookbook) { onClose(); return; }
    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim() || null;
    if (!trimmedTitle) {
      // A book with no title is one nobody can pick — see recipeProvenance.ts —
      // so an emptied field is left as it was rather than saved blank.
      onClose();
      return;
    }
    if (trimmedTitle !== cookbook.title || trimmedAuthor !== cookbook.author) {
      if (!renameCookbook(cookbookId, trimmedTitle, trimmedAuthor)) {
        Alert.alert(
          'That book is already on the shelf',
          'Another cookbook already has this title and author.'
        );
        return;
      }
    }
    onClose();
  };

  const handleDelete = () => {
    if (!cookbookId) return;
    haptics.warning();
    confirmDelete({
      title: 'Delete cookbook',
      message: recipeCount > 0
        ? `Unlink "${cookbook?.title}" from ${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'}? They'll keep their author and title text, just not the link to this book.`
        : `Delete "${cookbook?.title}"?`,
      onConfirm: () => { deleteCookbook(cookbookId); onClose(); },
    });
  };

  if (!cookbook) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={saveAndClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <SheetHeaderButton label="Done" onPress={saveAndClose} />
          <Text style={styles.headerTitle}>Edit cookbook</Text>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete cookbook ${cookbook.title}`}
          >
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Cookbook title"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_SOURCE_MAX_LENGTH}
            autoCapitalize="words"
            returnKeyType="next"
            accessibilityLabel="Cookbook title"
          />
          <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>AUTHOR</Text>
          <TextInput
            style={styles.input}
            value={author}
            onChangeText={setAuthor}
            placeholder="Author, optional"
            placeholderTextColor={colors.textTertiary}
            maxLength={RECIPE_SOURCE_MAX_LENGTH}
            autoCapitalize="words"
            returnKeyType="done"
            accessibilityLabel="Cookbook author"
          />
          <Text style={styles.hint}>
            {recipeCount === 0 ? 'No recipes' : recipeCount === 1 ? '1 recipe' : `${recipeCount} recipes`} linked
            to this book. Changing the title or author here updates every one of them.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
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
    paddingVertical: 12,
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
