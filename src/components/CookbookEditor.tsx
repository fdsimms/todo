import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { useSheetSubject } from '../hooks/useSheetSubject';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRecipeStore } from '../store/useRecipeStore';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { CookbookMergeSheet } from './CookbookMergeSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { RECIPE_SOURCE_MAX_LENGTH, type Cookbook } from '../types';

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
export function CookbookEditor({ visible, cookbookId: liveCookbookId, onClose }: Props) {
  // Held past the host clearing it on close, so the `return null` below can't
  // unmount the presented sheet mid-dismiss (CookbooksScreen clears the id in
  // the same commit it lowers `visible`), the unmount CLAUDE.md's SheetModal
  // notes say freezes the screen underneath.
  const cookbookId = useSheetSubject(liveCookbookId);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cookbook = useRecipeStore(s => (cookbookId ? s.cookbookById(cookbookId) : undefined));
  const renameCookbook = useRecipeStore(s => s.renameCookbook);
  const deleteCookbook = useRecipeStore(s => s.deleteCookbook);
  const mergeCookbooks = useRecipeStore(s => s.mergeCookbooks);
  const recipeCount = useRecipeStore(s =>
    cookbookId ? s.recipes.filter(r => r.cookbookId === cookbookId).length : 0
  );
  const indexCount = useRecipeStore(s =>
    cookbookId ? s.indexEntries.filter(e => e.cookbookId === cookbookId).length : 0
  );

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [mergeVisible, setMergeVisible] = useState(false);
  const card = useCardSheet();
  // Every way out, animated: the card fades and then the host lowers `visible`.
  const finish = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  // Reloads from the store each time the sheet opens on a book, so a
  // half-finished edit from last time never leaks into the next one — same
  // reasoning CategoryEditor's own load effect gives.
  useEffect(() => {
    if (!cookbook || !visible) return;
    setTitle(cookbook.title);
    setAuthor(cookbook.author ?? '');
    // Intentionally keyed on the id and the open, not on `cookbook`, which
    // changes on every store write, and re-syncing on those would stomp an
    // in-progress edit. The open is what reseeds the same book reopened, now
    // that the id outlives a close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cookbookId, visible]);

  const saveAndClose = () => {
    if (!cookbookId || !cookbook) { finish(); return; }
    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim() || null;
    if (!trimmedTitle) {
      // A book with no title is one nobody can pick — see recipeProvenance.ts —
      // so an emptied field is left as it was rather than saved blank.
      finish();
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
    finish();
  };

  const handleDelete = () => {
    if (!cookbookId) return;
    haptics.warning();
    confirmDelete({
      title: 'Delete cookbook',
      // Recipes are unlinked and kept; the index goes with the book, since a
      // line of it is only a page of this book (see dbDeleteCookbook).
      message: [
        recipeCount > 0
          ? `Unlink "${cookbook?.title}" from ${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'}? They'll keep their author and title text, just not the link to this book.`
          : `Delete "${cookbook?.title}"?`,
        indexCount > 0
          ? `The ${indexCount} ${indexCount === 1 ? 'dish' : 'dishes'} in its index will be deleted.`
          : null,
      ].filter(Boolean).join(' '),
      // Deleted once the card is gone, since the card is drawn from the book.
      onConfirm: () => finish(() => deleteCookbook(cookbookId)),
    });
  };

  // The book open here is always the survivor — its title and author are
  // what every repointed recipe mirrors, so "merge another book in" reads the
  // same direction the picker asks it in.
  const handleMergeSelect = (loser: Cookbook) => {
    if (!cookbookId || !cookbook) return;
    haptics.warning();
    confirmDelete({
      title: 'Merge these books?',
      message: `"${loser.title}" will come off the shelf, and its recipes and index will move to "${cookbook.title}".`,
      confirmLabel: 'Merge',
      onConfirm: () => { haptics.success(); mergeCookbooks(cookbookId, loser.id); },
    });
  };

  if (!cookbook) return null;

  return (
    <CardSheet
      name="CookbookEditor"
      visible={visible}
      controller={card}
      onRequestClose={saveAndClose}
      overlays={cookbookId && (
        <CookbookMergeSheet
          visible={mergeVisible}
          survivorId={cookbookId}
          onClose={() => setMergeVisible(false)}
          onSelect={handleMergeSelect}
        />
      )}
    >
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

        {/* For the same book imported twice under a slightly different
            title or author (see recipeProvenance.ts) — folds another book's
            recipes into this one and removes it from the shelf. */}
        <View style={styles.mergeRow}>
          <InlineAction
            label="Merge another book in"
            icon="git-merge-outline"
            variant="neutral"
            onPress={() => { haptics.tap(); setMergeVisible(true); }}
          />
        </View>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
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
  mergeRow: {
    alignItems: 'flex-start',
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
});
