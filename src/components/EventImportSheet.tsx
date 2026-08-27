import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { EmptyState } from './EmptyState';
import { extractCalendarEvents, describeAIError, type ExtractedCalendarEvent } from '../services/aiSuggestions';
import { pickRecipePhoto, type RecipePhoto, type RecipePhotoSource } from '../utils/recipePhoto';
import { alertPhotoAccessDenied } from '../hooks/useRecipeImportSource';
import { haptics } from '../utils/haptics';

type InputMode = 'paste' | 'photo';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called once extraction finds at least one event; the sheet closes itself right after. */
  onImported: (events: ExtractedCalendarEvent[]) => void;
}

/**
 * The capture step for importing a task from a photo or pasted text of a
 * confirmation, booking, or itinerary — reachable from the "+" menu's Import
 * entry (`AddTaskFab`).
 *
 * **This sheet only captures and extracts; it never reviews.** Unlike
 * `RecipeExtractSheet`/`ReceiptImportSheet`, there is no in-sheet list of
 * found fields to tick through — `TaskEditor` already is that review surface
 * for a single task, with a real Date row, a real Location row, a search bar,
 * and a Cancel that doesn't commit anything. Building a second review UI here
 * would duplicate it for no reason other than habit. So a successful read
 * hands the raw `ExtractedCalendarEvent[]` straight to `onImported` and
 * closes; the caller (`TodayScreen`) is what turns each one into a task
 * editor opened pre-filled, one at a time for an itinerary with several legs.
 *
 * Text or a photo, deliberately never a link: unlike a recipe, there's no
 * "the page builds itself in the browser" failure mode worth a fetch-and-read
 * step for here, and the confirmation pages this is aimed at (a MyChart
 * appointment, an airline itinerary) are exactly the ones a person already has
 * open and would rather screenshot or copy from than hand over a URL to.
 */
export function EventImportSheet({ visible, onClose, onImported }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const [mode, setMode] = useState<InputMode>('paste');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<RecipePhoto | null>(null);
  const [picking, setPicking] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a run comes back with nothing — distinguishes "hasn't tried yet"
  // from "tried and found nothing" without a third loading-ish state.
  const [triedEmpty, setTriedEmpty] = useState(false);

  const reset = useCallback(() => {
    setMode('paste');
    setText('');
    setPhoto(null);
    setPicking(false);
    setPhotoError(null);
    setLoading(false);
    setError(null);
    setTriedEmpty(false);
  }, []);

  // Reset on close rather than on open, so a sheet left mounted doesn't hand
  // the next open a stale photo — same rule ReceiptImportSheet's reset follows.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const pick = useCallback(async (source: RecipePhotoSource) => {
    setPicking(true);
    setPhotoError(null);
    try {
      const result = await pickRecipePhoto(source);
      if (result.status === 'ok') {
        haptics.success();
        setPhoto(result.photo);
      } else if (result.status === 'denied') {
        alertPhotoAccessDenied(source, result.canAskAgain, 'read an event off a photo');
      } else if (result.status === 'failed') {
        setPhotoError(result.message);
      }
      // 'canceled' is a deliberate no-op — they changed their mind.
    } finally {
      setPicking(false);
    }
  }, []);

  const ready = mode === 'photo' ? !!photo : !!text.trim();

  const run = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    setTriedEmpty(false);
    try {
      const events = await extractCalendarEvents(mode === 'photo' ? photo! : text);
      if (events.length === 0) {
        setTriedEmpty(true);
        return;
      }
      haptics.success();
      onImported(events);
      onClose();
    } catch (e) {
      setError(describeAIError(e));
    } finally {
      setLoading(false);
    }
  }, [ready, mode, photo, text, onImported, onClose]);

  // A paste or an attached photo not yet read is real work — a swipe-down
  // would otherwise drop it with no dialog.
  const handleCancel = () => {
    const dirty = !!text.trim() || !!photo;
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

  const body = () => {
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
            icon="calendar-outline"
            title="Nothing found"
            subtitle={mode === 'photo'
              ? 'Nothing that looked like an event turned up in that photo. Try again in better light, or paste the text instead.'
              : 'Nothing that looked like an event turned up in that text.'}
            actionLabel={mode === 'photo' ? 'Try another photo' : undefined}
            onAction={mode === 'photo' ? () => { setTriedEmpty(false); setPhoto(null); } : undefined}
          />
        </View>
      );
    }

    return (
      <>
        <Text style={styles.intro}>
          Paste a confirmation, or photograph one, and dundundun will read out the title, date,
          time, and location for you to review before it's added.
        </Text>

        <SegmentedControl
          label="How to add the event"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'paste', label: 'Paste', icon: 'clipboard-outline' },
            { value: 'photo', label: 'Photo', icon: 'camera-outline' },
          ]}
          surface="page"
        />

        {mode === 'paste' ? (
          <TextInput
            style={styles.pasteInput}
            value={text}
            onChangeText={setText}
            placeholder="Paste the confirmation text here…"
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Confirmation text"
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
              style={styles.previewClear}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setPhoto(null); }}
              accessibilityRole="button"
              accessibilityLabel="Remove this photo"
            >
              <Ionicons name="close" size={iconSize.sm} color={colors.onAccent} />
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
                <Text style={styles.photoHint}>
                  Works on an appointment page, a booking confirmation, a ticket — anything with
                  the details readable.
                </Text>
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
          accessibilityLabel="Read the event"
        >
          <Ionicons name="sparkles" size={iconSize.sm} color={colors.onAccent} />
          <Text style={styles.runBtnText}>Read the event</Text>
        </TouchableOpacity>
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <View style={styles.headerTitleWrap}>
            <Ionicons name="sparkles" size={14} color={colors.purple} />
            <Text style={styles.headerTitle}>Import event</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView
          ref={keyboardScroll.ref}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          {...keyboardScroll.props}
        >
          {body()}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
    headerSpacer: { minWidth: 64 },
    body: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
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
      backgroundColor: colors.purple,
      borderRadius: radius.md,
      paddingVertical: 14,
    },
    runBtnOff: { opacity: 0.4 },
    runBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
    error: { color: colors.red, fontSize: font.sm },
  });
}
