import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { EmptyNote } from './EmptyNote';
import { useRecipeStore, type IndexImportUndo } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { extractCookbookIndex, describeAIError } from '../services/aiSuggestions';
import {
  cleanIndexEntryFields, mergeIndexDrafts, mergedIndexLine, splitIngredientText,
  type IndexDraft, type IndexEntryFields,
} from '../utils/cookbookIndex';
import { RECIPE_NAME_MAX_LENGTH, RECIPE_PAGE_MAX_LENGTH } from '../types';

/** Index pages one scan reads. An index runs a few pages; a book's whole one is a few scans. */
const MAX_INDEX_PHOTOS = 8;

interface Props {
  visible: boolean;
  cookbookId: string;
  onClose: () => void;
  /** After the lines are written, with what taking them back out needs. The sheet has closed itself. */
  onApplied: (undo: IndexImportUndo, added: number, updated: number) => void;
}

/**
 * Photograph pages of a cookbook's index and add its dishes to the book's
 * index (`CookbookIndexEntry`), the lines Cook with… searches.
 *
 * Capture, then review, the shape `ReceiptImportSheet` has: every page goes to
 * `extractCookbookIndex` in order, each told the heading the page before ended
 * under, and the dishes come back as one list (`mergeIndexDrafts`), a dish
 * once however many headings listed it. **Nothing is written until Add**, and
 * every line can be corrected or removed first. A dish the index already has
 * adds to that line rather than making a second.
 *
 * Needs a key, unlike the old table-of-contents scanner: an index's nesting is
 * the whole of what it says, and no on-device read keeps it (see
 * `extractCookbookIndex`). Without one the sheet says so and points at typing
 * lines in by hand, which the book's page always offers.
 */
export function CookbookIndexScanSheet({ visible, cookbookId, onClose, onApplied }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });

  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const feature = useSettingsStore(s => s.aiFeatureConfig.cookbookIndex);
  const cookbook = useRecipeStore(s => s.cookbookById(cookbookId));
  const indexEntries = useRecipeStore(useShallow(s => s.indexEntries));
  const applyIndexDrafts = useRecipeStore(s => s.applyIndexDrafts);

  const input = useRecipeImportSource('photo', "photograph a cookbook's index", MAX_INDEX_PHOTOS);
  const { photos, clearPhoto, reset: resetInput } = input;

  const [step, setStep] = useState<'capture' | 'review'>('capture');
  const [progress, setProgress] = useState<{ page: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<IndexDraft[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [editFields, setEditFields] = useState({ title: '', page: '', ingredients: '' });

  // A read that comes back after the sheet closed, or after a newer read began,
  // is dropped rather than written into a review nobody is looking at.
  const runRef = useRef(0);
  const reset = useCallback(() => {
    runRef.current += 1;
    setStep('capture');
    setProgress(null);
    setError(null);
    setDrafts([]);
    setEditing(null);
    resetInput();
  }, [resetInput]);
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const hasKey = !!anthropicApiKey && feature.enabled;

  const run = useCallback(async () => {
    if (photos.length === 0) return;
    haptics.tap();
    const token = ++runRef.current;
    setError(null);
    const read: IndexEntryFields[] = [];
    let heading: string | null = null;
    let failure: string | null = null;
    for (let i = 0; i < photos.length; i++) {
      setProgress({ page: i + 1, of: photos.length });
      try {
        const page = await extractCookbookIndex(photos[i], heading);
        if (runRef.current !== token) return;
        read.push(...page.entries);
        heading = page.lastHeading;
      } catch (e) {
        if (runRef.current !== token) return;
        failure = photos.length > 1
          ? `Page ${i + 1} couldn't be read, so the pages after it weren't either. ${describeAIError(e)}`
          : describeAIError(e);
        break;
      }
    }
    setProgress(null);
    const merged = mergeIndexDrafts(read, useRecipeStore.getState().indexEntries, cookbookId);
    if (merged.length === 0 && failure) {
      setError(failure);
      return;
    }
    setDrafts(merged);
    setError(failure ?? (merged.length === 0
      ? "Couldn't find any dishes in these photos. Try a sharper photo of one index page at a time."
      : null));
    if (merged.length > 0) haptics.success();
    setStep('review');
  }, [photos, cookbookId]);

  // What Add will do, counted with the same rule it applies with.
  const newCount = drafts.filter(d => !d.existing).length;
  const addsToCount = drafts.filter(d => mergedIndexLine(d) !== null).length;
  const writes = newCount + addsToCount;

  // The list with the row being edited folded in. Add reads this rather than
  // `drafts`: tapping Add mid-edit would otherwise write the list as it was
  // before the edit, since committing it is a state update that hasn't landed.
  // An emptied title leaves the line as it was; the remove button is how a
  // line goes.
  const withPendingEdit = (): IndexDraft[] => {
    if (editing === null) return drafts;
    const clean = cleanIndexEntryFields({
      title: editFields.title,
      page: editFields.page || null,
      ingredients: splitIngredientText(editFields.ingredients),
    });
    return clean ? drafts.map((d, i) => (i === editing ? { ...d, ...clean } : d)) : drafts;
  };

  const commitEdit = () => {
    if (editing === null) return;
    setDrafts(withPendingEdit());
    setEditing(null);
  };

  const handleAdd = () => {
    const final = withPendingEdit();
    if (final.every(d => d.existing && !mergedIndexLine(d))) return;
    const undo = applyIndexDrafts(cookbookId, final);
    haptics.success();
    onClose();
    onApplied(undo, undo.created.length, undo.previous.length);
  };

  const handleCancel = () => {
    const dirty = step === 'review' ? drafts.length > 0 : photos.length > 0;
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

  const startEditing = (index: number) => {
    commitEdit();
    const draft = drafts[index];
    setEditFields({ title: draft.title, page: draft.page ?? '', ingredients: draft.ingredients.join(', ') });
    setEditing(index);
  };

  const removeDraft = (index: number) => {
    haptics.tap();
    setEditing(null);
    setDrafts(prev => prev.filter((_, i) => i !== index));
  };

  const draftMeta = (draft: IndexDraft) => {
    const parts = [draft.page ? `p. ${draft.page}` : null, draft.ingredients.join(', ') || null];
    const text = parts.filter(Boolean).join(' · ');
    if (!draft.existing) return text;
    const merged = mergedIndexLine(draft);
    const note = merged ? 'Already in the index, adds to that line' : 'Already in the index, nothing new';
    return text ? `${text} · ${note}` : note;
  };

  const bookTitle = cookbook?.title ?? 'this book';

  return (
    <SheetModal
      name="CookbookIndexScanSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={[styles.root, { paddingTop: spacing.md }]}>
        <SheetHeader
          title="Scan the index"
          icon="sparkles"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={step === 'review'
            ? <SheetHeaderButton label="Add" onPress={handleAdd} disabled={writes === 0 && editing === null} minWidth={64} />
            : <View style={styles.headerSpacer} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {!hasKey ? (
            <EmptyNote icon="key-outline">
              {anthropicApiKey
                ? "Reading a cookbook's index from a photo is turned off in Settings. You can still add dishes one at a time with Add to index."
                : "Reading a cookbook's index from a photo needs an Anthropic API key, added in Settings. You can still add dishes one at a time with Add to index."}
            </EmptyNote>
          ) : step === 'capture' ? (
            <>
              <RecipeSourcePicker
                intro={`Photograph pages of ${bookTitle}'s index, in order. Each dish is added with its page and the ingredients it's listed under.`}
                mode="photo"
                onChangeMode={() => {}}
                text=""
                onChangeText={() => {}}
                url=""
                onChangeUrl={() => {}}
                photos={photos}
                onPickPhoto={input.pick}
                onClearPhoto={clearPhoto}
                maxPhotos={MAX_INDEX_PHOTOS}
                picking={input.picking}
                photoOnly
                photoHint="One index page per photo, flat and in focus. Up to 8 pages at a time."
                ctaLabel={progress ? 'Reading…' : 'Read the index'}
                onRun={progress ? () => {} : run}
              />
              {progress && (
                <View style={styles.progress}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.progressText}>
                    {progress.of > 1 ? `Reading page ${progress.page} of ${progress.of}…` : 'Reading the page…'}
                  </Text>
                </View>
              )}
              {!!error && (
                <View style={styles.errorCard}>
                  <Ionicons name="alert-circle-outline" size={iconSize.sm} color={colors.warning} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </>
          ) : (
            <>
              {!!error && (
                <View style={[styles.errorCard, styles.errorCardTop]}>
                  <Ionicons name="alert-circle-outline" size={iconSize.sm} color={colors.warning} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
              {drafts.length > 0 && (
                <Text style={styles.summary}>
                  {[
                    newCount > 0 ? `${newCount} new ${newCount === 1 ? 'dish' : 'dishes'}` : null,
                    addsToCount > 0 ? `${addsToCount} already in the index with something to add` : null,
                  ].filter(Boolean).join(', ') || 'Everything here is already in the index.'}
                  {' Tap a dish to correct it.'}
                </Text>
              )}
              <View style={styles.card}>
                {drafts.map((draft, i) => (
                  <View key={`${draft.title}-${i}`} style={[styles.row, i > 0 && styles.rowDivided]}>
                    {editing === i ? (
                      <View style={styles.editFields}>
                        <TextInput
                          style={styles.input}
                          value={editFields.title}
                          onChangeText={title => setEditFields(f => ({ ...f, title }))}
                          maxLength={RECIPE_NAME_MAX_LENGTH}
                          placeholder="Dish"
                          placeholderTextColor={colors.textTertiary}
                          accessibilityLabel="Dish name"
                          autoFocus
                        />
                        <TextInput
                          style={styles.input}
                          value={editFields.page}
                          onChangeText={page => setEditFields(f => ({ ...f, page }))}
                          maxLength={RECIPE_PAGE_MAX_LENGTH + 3}
                          placeholder="Page"
                          placeholderTextColor={colors.textTertiary}
                          accessibilityLabel="Page number"
                        />
                        <TextInput
                          style={styles.input}
                          value={editFields.ingredients}
                          onChangeText={ingredients => setEditFields(f => ({ ...f, ingredients }))}
                          placeholder="Ingredients, separated by commas"
                          placeholderTextColor={colors.textTertiary}
                          autoCapitalize="none"
                          returnKeyType="done"
                          onSubmitEditing={commitEdit}
                          accessibilityLabel="Ingredients, separated by commas"
                        />
                        <TouchableOpacity
                          style={styles.doneEditing}
                          onPress={commitEdit}
                          activeOpacity={interaction.activeOpacity}
                          accessibilityRole="button"
                        >
                          <Text style={styles.doneEditingText}>Done</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.rowBody}
                        onPress={() => startEditing(i)}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${draft.title}`}
                      >
                        <Text style={styles.rowTitle}>{draft.title}</Text>
                        {!!draftMeta(draft) && <Text style={styles.rowMeta}>{draftMeta(draft)}</Text>}
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      onPress={() => removeDraft(i)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${draft.title}`}
                    >
                      <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              {drafts.length === 0 && (
                <EmptyNote icon="list-outline">
                  Nothing left to add. Cancel and scan again, or add dishes one at a time with Add to index.
                </EmptyNote>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}


const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerSpacer: { width: 64 },
  scroll: { flex: 1 },
  body: { padding: spacing.md },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  progressText: { color: colors.textSecondary, fontSize: font.sm },
  errorCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorCardTop: { marginTop: 0, marginBottom: spacing.md },
  errorText: { flex: 1, color: colors.text, fontSize: font.sm },
  summary: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
  },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: colors.text, fontSize: font.md },
  rowMeta: { color: colors.textSecondary, fontSize: font.sm },
  editFields: { flex: 1, gap: spacing.sm },
  input: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: font.md,
  },
  doneEditing: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  doneEditingText: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
