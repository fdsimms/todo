import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTaskStore } from '../store/useTaskStore';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useRecipeImportSource } from '../hooks/useRecipeImportSource';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { RecipeSourcePicker } from './RecipeSourcePicker';
import { InlineAction } from './InlineAction';
import { EmptyNote } from './EmptyNote';
import { extractCookbookChecklist, describeAIError } from '../services/aiSuggestions';
import { canReadTextOnDevice } from '../utils/receiptOcr';
import { readCookbookPhoto, stripTocNoise } from '../utils/cookbookOcr';
import { RECIPE_NAME_MAX_LENGTH } from '../types';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Fires once the checklist project exists, after the sheet has already closed itself. */
  onCreated?: (projectId: string) => void;
}

/**
 * Photograph a cookbook's table of contents and turn it into a checklist —
 * a list-kind `Project` (see `Project.kind`) with one task per recipe title,
 * checked off as each one gets cooked.
 *
 * Same two-step shape as `ReceiptImportSheet`: a photo goes in, on-device
 * Vision reads it for free, and — with a key — the recognised rows (or the
 * photo itself, when the read was too thin to use) go to
 * `extractCookbookChecklist` for a title and a printed-order list of recipes.
 * **Nothing is written until Create is tapped.** The review step is the same
 * confirm-before-write step every AI extractor in this app gets: every title
 * is editable and removable, and the book's own title has to be confirmed
 * (or typed) before the button is enabled — the guessed value is a starting
 * point, not something this sheet takes as read.
 *
 * Without a key (or with the feature switched off), there is no apology
 * screen: the on-device reading still runs, and its raw rows become the
 * starting list for the same edit-by-hand review, cleaned up only by
 * `stripTocNoise`'s bare dot-leader/page-number trim rather than by anything
 * that understands what a recipe title is. A photo Vision couldn't read at
 * all still opens the review step, empty, so typing every title in by hand
 * is always a way through — the entry point is never gated on a key existing.
 */
export function CookbookChecklistSheet({ visible, onClose, onCreated }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const cookbookFeature = useSettingsStore(s => s.aiFeatureConfig.cookbookChecklist);
  const createProject = useProjectStore(s => s.createProject);
  const addTask = useTaskStore(s => s.addTask);
  const addExistingToProject = useTaskStore(s => s.addExistingToProject);

  const input = useRecipeImportSource('photo', 'photograph a cookbook’s table of contents', 1);
  const { photos, clearPhoto, reset: resetInput } = input;

  const [step, setStep] = useState<'capture' | 'review'>('capture');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cookbookTitle, setCookbookTitle] = useState('');
  const [titles, setTitles] = useState<string[]>([]);

  const reset = useCallback(() => {
    setStep('capture');
    setProcessing(false);
    setError(null);
    setCookbookTitle('');
    setTitles([]);
    resetInput();
  }, [resetInput]);

  // Reset on close rather than on open, so a sheet left mounted doesn't hand
  // last time's read to this time's photo — same rule ReceiptImportSheet's
  // own reset follows.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const hasKey = !!anthropicApiKey && cookbookFeature.enabled;

  const run = useCallback(async () => {
    const photo = photos[0];
    if (!photo) return;
    haptics.tap();
    setProcessing(true);
    setError(null);
    try {
      // Read it on device first, for the same reason extractReceipt does:
      // with a key the recognised rows are what gets sent, and without one
      // the raw rows are the only reading there is.
      const reading = canReadTextOnDevice() ? await readCookbookPhoto(photo.sourceUri) : null;
      if (hasKey) {
        const result = await extractCookbookChecklist(reading?.text ?? photo);
        setCookbookTitle(result.cookbookTitle);
        setTitles(result.titles);
        if (result.titles.length === 0) {
          setError('Couldn’t find any recipe titles in that photo. Add them by hand below, or try a clearer photo.');
        } else {
          haptics.success();
        }
      } else if (reading) {
        setCookbookTitle('');
        setTitles(reading.rows.map(stripTocNoise).filter(Boolean));
      } else {
        setCookbookTitle('');
        setTitles([]);
      }
      setStep('review');
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setProcessing(false);
    }
  }, [photos, hasKey]);

  const setTitleAt = (index: number, value: string) => {
    setTitles(prev => prev.map((t, i) => (i === index ? value.slice(0, RECIPE_NAME_MAX_LENGTH) : t)));
  };

  const removeTitleAt = (index: number) => {
    haptics.tap();
    setTitles(prev => prev.filter((_, i) => i !== index));
  };

  const addBlankTitle = () => {
    haptics.tap();
    setTitles(prev => [...prev, '']);
  };

  const cleanTitles = titles.map(t => t.trim()).filter(Boolean);
  const ready = step === 'review' && cookbookTitle.trim().length > 0 && cleanTitles.length > 0;

  const handleCreate = () => {
    const title = cookbookTitle.trim();
    if (!title || cleanTitles.length === 0) return;
    Keyboard.dismiss();
    haptics.success();
    const project = createProject(title, { kind: 'list' });
    cleanTitles.forEach(recipeTitle => {
      const task = addTask({ title: recipeTitle });
      addExistingToProject(task.id, project.id);
    });
    onCreated?.(project.id);
    onClose();
  };

  // A photographed page, a guessed title, or hand-typed edits are all real
  // work — a swipe-down would otherwise drop any of them with no dialog.
  const handleCancel = () => {
    Keyboard.dismiss();
    const dirty = photos.length > 0 || step === 'review';
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title="Cookbook checklist"
          icon="sparkles"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />}
          right={
            step === 'review' ? (
              <SheetHeaderButton label="Create" onPress={handleCreate} disabled={!ready} minWidth={64} />
            ) : (
              <View style={styles.headerSpacer} />
            )
          }
        />

        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {step === 'capture' ? (
            <View style={styles.sourceWrap}>
              <RecipeSourcePicker
                intro="Photograph a cookbook's table of contents to build a checklist of everything in it."
                mode="photo"
                onChangeMode={() => {}}
                text=""
                onChangeText={() => {}}
                url=""
                onChangeUrl={() => {}}
                photos={photos}
                onPickPhoto={input.pick}
                onClearPhoto={clearPhoto}
                maxPhotos={1}
                picking={input.picking}
                photoOnly
                photoHint="Works on a printed contents page — one or two columns of recipe titles and page numbers."
                ctaLabel={processing ? 'Reading…' : 'Read table of contents'}
                onRun={run}
              />
              {processing && (
                <View style={styles.processing}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.processingText}>Reading the page…</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.reviewWrap}>
              {!!error && (
                <View style={styles.errorCard}>
                  <Ionicons name="alert-circle-outline" size={iconSize.sm} color={colors.warning} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Text style={styles.label}>Cookbook</Text>
              <TextInput
                style={styles.titleInput}
                value={cookbookTitle}
                onChangeText={setCookbookTitle}
                placeholder="e.g. Salt Fat Acid Heat"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="Cookbook title"
              />

              <Text style={styles.label}>Recipes</Text>
              {titles.length === 0 ? (
                <EmptyNote icon="restaurant-outline">
                  No recipe titles yet. Add them by hand below, or go back and try another photo.
                </EmptyNote>
              ) : (
                <View style={styles.titleList}>
                  {titles.map((title, index) => (
                    <View key={index} style={styles.titleRow}>
                      <TextInput
                        style={styles.titleRowInput}
                        value={title}
                        onChangeText={value => setTitleAt(index, value)}
                        placeholder="Recipe title"
                        placeholderTextColor={colors.textTertiary}
                        accessibilityLabel={`Recipe title ${index + 1}`}
                      />
                      <TouchableOpacity
                        hitSlop={8}
                        onPress={() => removeTitleAt(index)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${title || 'this title'}`}
                      >
                        <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <InlineAction
                label="Add a recipe"
                icon="add"
                onPress={addBlankTitle}
                style={styles.addAction}
                accessibilityLabel="Add a recipe title by hand"
              />
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { minWidth: 64 },
    body: { padding: spacing.md, paddingBottom: spacing.xl },
    sourceWrap: { gap: spacing.md },
    processing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingTop: spacing.md },
    processingText: { color: colors.textSecondary, fontSize: font.sm },
    reviewWrap: { gap: spacing.xs },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.warningBg,
      borderRadius: radius.md,
      padding: spacing.sm,
      marginBottom: spacing.sm,
    },
    errorText: { flex: 1, color: colors.text, fontSize: font.sm, lineHeight: font.sm * 1.4 },
    label: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginBottom: spacing.xs,
      marginTop: spacing.md,
    },
    titleInput: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      height: 44,
      fontSize: font.md,
      color: colors.text,
    },
    titleList: { gap: spacing.xs },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingLeft: spacing.md,
      paddingRight: spacing.sm,
      height: 44,
    },
    titleRowInput: { flex: 1, fontSize: font.md, color: colors.text },
    addAction: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  });
}
