import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import { format } from 'date-fns/format';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, checkboxRadius, type Colors } from '../theme';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { EmptyState } from './EmptyState';
import { HelpText } from './HelpText';
import { CheckPop } from './CheckPop';
import { WhenPicker } from './WhenPicker';
import { TextField } from './TextField';
import { ClipboardPhotoOffer } from './ClipboardPhotoOffer';
import { extractTasks, describeAIError, type RecipeImage } from '../services/aiSuggestions';
import { pickRecipePhoto, type RecipePhoto, type RecipePhotoSource } from '../utils/recipePhoto';
import { alertPhotoAccessDenied } from '../hooks/useRecipeImportSource';
import { useClipboardImage } from '../hooks/useClipboardImage';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  candidatesFromExtracted,
  candidatesToAdd,
  draftFromCandidate,
  type ImportCandidate,
} from '../utils/taskImport';
import type { TaskDraft } from '../types';
import { haptics } from '../utils/haptics';
import { confirmDiscard } from '../utils/confirmDiscard';
import { BUTTON_LABEL } from '../copy/shared';

type InputMode = 'paste' | 'photo';

const CHECKBOX_SIZE = 22;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called with a draft per ticked row when the person taps Add; the sheet closes itself right after. */
  onAdd: (drafts: Partial<TaskDraft>[]) => void;
  /**
   * A photo already in hand, such as one shared in from another app's share
   * sheet. The sheet opens on it, ready to read.
   */
  initialPhoto?: RecipeImage | null;
}

/**
 * Tasks out of a screenshot, a photo or pasted text, reachable from the "+"
 * menu's Import tasks entry (`AddTaskFab`).
 *
 * Two steps in one sheet. Capture takes a photo or a paste and runs
 * `extractTasks`; review lists what was read with a tick, an editable title and
 * a date chip on each row, and nothing is written until Add. **Unlike
 * `EventImportSheet`, this one reviews in place**, because what it finds is
 * plain tasks with no richer card of the app's own to hand them to, and a list
 * of several is only useful if each can be skipped or fixed on the spot.
 *
 * Needs Claude: there is no offline reading of a photo, and an offline read of
 * prose for "what is a task here" would be a guess presented as a reading. With
 * the feature off the sheet says where to turn it on rather than offering a
 * worse path.
 */
export function TaskImportSheet({ visible, onClose, onAdd, initialPhoto = null }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ ownsSheet: true });
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const taskImportEnabled = useSettingsStore(s => s.aiFeatureConfig.taskImport.enabled);
  const aiAvailable = !!anthropicApiKey && taskImportEnabled;

  const [mode, setMode] = useState<InputMode>('photo');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<RecipeImage | null>(null);
  const [picking, setPicking] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triedEmpty, setTriedEmpty] = useState(false);
  /** The review list. Null until a read comes back with at least one task. */
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  /** The row whose date is being picked. */
  const [dateFor, setDateFor] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMode('photo');
    setText('');
    setPhoto(null);
    setPicking(false);
    setPhotoError(null);
    setLoading(false);
    setError(null);
    setTriedEmpty(false);
    setCandidates(null);
    setDateFor(null);
  }, []);

  // Reset on close rather than on open, so a sheet left mounted doesn't hand
  // the next open a stale photo or list.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  // A photo handed in from outside seeds the capture step on open.
  useEffect(() => {
    if (visible && initialPhoto) {
      setPhoto(initialPhoto);
      setMode('photo');
    }
  }, [visible, initialPhoto]);

  // The request outlives a cancel (only the Modal hides), so a late answer
  // checks this before writing any state, the same guard EventImportSheet uses.
  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);

  const pick = useCallback(async (source: RecipePhotoSource) => {
    setPicking(true);
    setPhotoError(null);
    try {
      const result = await pickRecipePhoto(source);
      if (result.status === 'ok') {
        haptics.success();
        setPhoto(result.photo);
        setMode('photo');
      } else if (result.status === 'denied') {
        alertPhotoAccessDenied(source, result.canAskAgain, 'read tasks off a photo');
      } else if (result.status === 'failed') {
        setPhotoError(result.message);
      }
      // 'canceled' is a deliberate no-op: they changed their mind.
    } finally {
      setPicking(false);
    }
  }, []);

  const clipboardHasImage = useClipboardImage(visible && !candidates && mode === 'paste' && !text.trim());

  const ready = mode === 'photo' ? !!photo : !!text.trim();

  const run = useCallback(async () => {
    if (!ready || !aiAvailable) return;
    setLoading(true);
    setError(null);
    setTriedEmpty(false);
    try {
      const tasks = await extractTasks(mode === 'photo' ? photo! : text);
      if (!visibleRef.current) return;
      if (tasks.length === 0) {
        setTriedEmpty(true);
        return;
      }
      haptics.success();
      Keyboard.dismiss();
      setCandidates(candidatesFromExtracted(tasks));
    } catch (e) {
      if (visibleRef.current) setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [ready, aiAvailable, mode, photo, text]);

  const patch = (id: string, change: Partial<ImportCandidate>) =>
    setCandidates(rows => rows && rows.map(r => (r.id === id ? { ...r, ...change } : r)));

  const toAdd = candidates ? candidatesToAdd(candidates) : [];

  const handleAdd = () => {
    if (toAdd.length === 0) return;
    Keyboard.dismiss();
    haptics.success();
    onAdd(toAdd.map(draftFromCandidate));
    onClose();
  };

  // A read costs a real request, and edits to its rows are work, so a
  // swipe-down shouldn't drop either without asking.
  const handleCancel = () => {
    const dirty = !!candidates || !!text.trim() || !!photo;
    if (!dirty) { Keyboard.dismiss(); onClose(); return; }
    confirmDiscard(() => { Keyboard.dismiss(); onClose(); });
  };

  const renderPhotoButton = (
    source: RecipePhotoSource,
    label: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
  ) => (
    <TouchableOpacity
      style={[styles.photoBtn, picking && styles.photoBtnOff]}
      activeOpacity={interaction.activeOpacity}
      onPress={() => pick(source)}
      disabled={picking}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={iconSize.md} color={colors.accent} />
      <Text style={styles.photoBtnText}>{label}</Text>
    </TouchableOpacity>
  );

  const dateRow = candidates?.find(r => r.id === dateFor) ?? null;

  const reviewBody = (rows: ImportCandidate[]) => (
    <>
      <View style={styles.summary}>
        {photo && (
          <Image
            source={{ uri: `data:${photo.mediaType};base64,${photo.base64}` }}
            style={styles.thumb}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        )}
        <View style={styles.summaryText}>
          <Text style={styles.summaryCount}>
            {rows.length === 1 ? '1 task found' : `${rows.length} tasks found`}
          </Text>
          <HelpText style={styles.summaryHint}>
            Tap a title to edit it. Untick any you don’t want.
          </HelpText>
        </View>
      </View>

      <View style={styles.card}>
        {rows.map((row, i) => (
          <React.Fragment key={row.id}>
            {i > 0 && <View style={styles.sep} />}
            <View style={styles.row}>
              <TouchableOpacity
                hitSlop={8}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); patch(row.id, { included: !row.included }); }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: row.included }}
                accessibilityLabel={`Add ${row.title}`}
              >
                <CheckPop
                  checked={row.included}
                  style={styles.checkbox}
                  checkedStyle={styles.checkboxOn}
                >
                  <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />
                </CheckPop>
              </TouchableOpacity>
              <View style={styles.rowBody}>
                <TextField
                  style={[styles.titleInput, !row.included && styles.titleOff]}
                  value={row.title}
                  onChangeText={title => patch(row.id, { title })}
                  multiline
                  blurOnSubmit
                  returnKeyType="done"
                  accessibilityLabel={`Title of ${row.title || 'task'}`}
                />
                <View style={styles.chips}>
                  <TouchableOpacity
                    style={[styles.chip, row.dueDate && styles.chipDated]}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => { Keyboard.dismiss(); setDateFor(row.id); }}
                    accessibilityRole="button"
                    accessibilityLabel={row.dueDate ? `Date ${format(row.dueDate, 'EEEE, MMMM d')}, change` : 'No date, set one'}
                  >
                    <Text style={[styles.chipText, row.dueDate && styles.chipTextDated]}>
                      {row.dueDate ? format(row.dueDate, 'EEE, MMM d') : 'No date'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {!!row.notes && <Text style={styles.notes} numberOfLines={2}>{row.notes}</Text>}
              </View>
            </View>
          </React.Fragment>
        ))}
      </View>
    </>
  );

  const body = () => {
    if (!aiAvailable) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="sparkles-outline"
            title="Turn on task import"
            subtitle="Reading tasks from a photo or text uses Claude. Add your Anthropic API key and turn on “Import tasks from a photo” in Settings."
          />
        </View>
      );
    }

    if (candidates) return reviewBody(candidates);

    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>
            {mode === 'photo' ? 'Reading the photo…' : 'Reading the text…'}
          </Text>
        </View>
      );
    }

    if (triedEmpty) {
      return (
        <View style={styles.centered}>
          <EmptyState
            icon="checkbox-outline"
            title="No tasks found"
            subtitle={mode === 'photo'
              ? 'No tasks found in that photo. Try again in better light, or paste the text instead.'
              : 'No tasks found in that text.'}
            actionLabel={mode === 'photo' ? 'Try another photo' : 'Edit the text'}
            onAction={() => { setTriedEmpty(false); if (mode === 'photo') setPhoto(null); }}
          />
        </View>
      );
    }

    return (
      <>
        <Text style={styles.intro}>
          Paste or photograph a screenshot, note or list, then choose which tasks to add before anything is saved.
        </Text>

        <SegmentedControl
          label="How to add the tasks"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'photo', label: 'Photo', icon: 'camera-outline' },
            { value: 'paste', label: 'Paste', icon: 'clipboard-outline' },
          ]}
          surface="page"
        />

        {mode === 'paste' && clipboardHasImage && (
          <ClipboardPhotoOffer onPress={() => pick('clipboard')} disabled={picking} />
        )}

        {mode === 'paste' ? (
          <TextField
            style={styles.pasteInput}
            value={text}
            onChangeText={setText}
            placeholder="Paste the message or list here…"
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Text to read tasks from"
          />
        ) : photo ? (
          <View style={styles.preview}>
            <Image
              source={{ uri: `data:${photo.mediaType};base64,${photo.base64}` }}
              style={styles.previewImage}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
            <TouchableOpacity
              hitSlop={8}
              style={styles.previewClear}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setPhoto(null); }}
              accessibilityRole="button"
              accessibilityLabel="Remove this photo"
            >
              <Ionicons name="close" size={iconSize.sm} color={colors.onFill} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.photoChoices}>
            {picking ? (
              <View style={styles.picking}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.pickingText}>Getting the photo ready…</Text>
              </View>
            ) : (
              <>
                {renderPhotoButton('camera', 'Take a photo', 'camera-outline')}
                {renderPhotoButton('library', 'Choose a photo', 'images-outline')}
                {renderPhotoButton('clipboard', 'Paste image', 'copy-outline')}
                <HelpText style={styles.photoHint}>
                  Works on a screenshot of a message, email, note or to-do list if the text is readable.
                </HelpText>
              </>
            )}
          </View>
        )}

        {!!photoError && <Text style={styles.error}>{photoError}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.runBtn, !ready && styles.runBtnOff]}
          activeOpacity={interaction.activeOpacity}
          onPress={run}
          disabled={!ready}
          accessibilityRole="button"
          accessibilityLabel="Read the tasks"
        >
          <Ionicons name="sparkles" size={iconSize.sm} color={colors.onFill} />
          <Text style={styles.runBtnText}>Read the tasks</Text>
        </TouchableOpacity>
      </>
    );
  };

  return (
    <SheetModal
      name="TaskImportSheet"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.root}>
        <SheetHeader
          title="Import tasks"
          icon="sparkles"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={72} />}
          right={candidates ? (
            <SheetHeaderButton
              label={toAdd.length > 0 ? `Add ${toAdd.length}` : 'Add'}
              onPress={handleAdd}
              disabled={toAdd.length === 0}
              minWidth={72}
            />
          ) : <View style={styles.headerSpacer} />}
        />
        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {body()}
        </ScrollView>

        {/* Rendered inside this sheet, not beside it: the titles typed above
            have to survive the picker (see "Two sibling Modals" in CLAUDE.md). */}
        <WhenPicker
          visible={dateFor !== null}
          value={dateRow?.dueDate ?? null}
          title="Due date"
          showTimeOfDay={false}
          showSuggest={false}
          onConfirm={date => {
            if (dateFor) patch(dateFor, { dueDate: date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12) : null });
            setDateFor(null);
          }}
          onClear={() => {
            if (dateFor) patch(dateFor, { dueDate: null });
            setDateFor(null);
          }}
          onCancel={() => setDateFor(null)}
        />
      </View>
    </SheetModal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    headerSpacer: { minWidth: 72 },
    scroll: { flex: 1 },
    body: { flexGrow: 1, padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
    loadingText: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center' },
    intro: { color: colors.textTertiary, fontSize: font.sm, lineHeight: font.sm * 1.4 },
    pasteInput: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      fontSize: font.md,
      color: colors.text,
      minHeight: 220,
    },
    photoChoices: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      minHeight: 220,
      justifyContent: 'center',
      gap: spacing.sm,
    },
    photoBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: 14,
      borderRadius: radius.md,
      backgroundColor: colors.bgTertiary,
    },
    photoBtnOff: { opacity: 0.4 },
    photoBtnText: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.semibold },
    photoHint: { color: colors.textTertiary, fontSize: font.xs, textAlign: 'center', paddingTop: spacing.xs },
    picking: { alignItems: 'center', gap: spacing.sm },
    pickingText: { color: colors.textSecondary, fontSize: font.sm },
    preview: {
      minHeight: 220,
      borderRadius: radius.md,
      backgroundColor: colors.bgSecondary,
      overflow: 'hidden',
    },
    previewImage: { width: '100%', height: 260 },
    previewClear: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.backdrop,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: border.hairline,
      borderColor: colors.separator,
    },
    runBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.purpleFill,
      borderRadius: radius.md,
      paddingVertical: 14,
    },
    runBtnOff: { opacity: 0.4 },
    runBtnText: { color: colors.onFill, fontSize: font.md, fontWeight: fontWeight.semibold },
    error: { color: colors.redText, fontSize: font.sm },

    summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
    thumb: { width: 56, height: 72, borderRadius: radius.sm, backgroundColor: colors.bgTertiary },
    summaryText: { flex: 1, gap: spacing.xxs },
    summaryCount: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    summaryHint: { color: colors.textSecondary, fontSize: font.sm },
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
    sep: {
      height: border.hairline,
      backgroundColor: colors.separator,
      marginLeft: spacing.md + CHECKBOX_SIZE + spacing.smd,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
      gap: spacing.smd,
    },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.controlBorder,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    checkboxOn: { backgroundColor: colors.accentFill, borderColor: colors.accent },
    rowBody: { flex: 1, gap: spacing.xsm },
    titleInput: { color: colors.text, fontSize: font.md, paddingVertical: 0 },
    titleOff: { color: colors.textTertiary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xsm },
    chip: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    chipDated: { backgroundColor: colors.accentSubtle },
    chipText: { color: colors.textSecondary, fontSize: font.xs },
    chipTextDated: { color: colors.accentText },
    notes: { color: colors.textSecondary, fontSize: font.sm },
  });
}
