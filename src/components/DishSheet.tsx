import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { DishRating, DishVerdict } from '../types';
import { useDishRatingStore } from '../store/useDishRatingStore';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { WhenPicker } from './WhenPicker';
import { ActionMenu } from './ActionMenu';
import { FadeInImage } from './FadeInImage';
import { InlineAction } from './InlineAction';
import { PhotoViewer } from './PhotoViewer';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { useSheetMount } from '../hooks/useSheetMount';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getLogicalToday } from '../utils/dateUtils';
import { confirmDiscard } from '../utils/confirmDiscard';
import { afterMenuDismissed } from '../utils/sheetModal';
import { alertPermissionOff } from '../utils/permissionAlert';
import { pickPhotoIntoFolder, storedFileName, type RecipePhotoSource } from '../utils/recipePhoto';
import { DISH_PHOTO_FOLDER, dishPhotoUri } from '../utils/dishPhotos';
import { DISH_VERDICTS, DISH_VERDICT_LABELS, dishKeys } from '../utils/dishRating';
import { groceryNameKey } from '../utils/groceryParse';
import { BUTTON_LABEL } from '../copy/shared';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';

const NAME_MAX_LENGTH = 80;
const PLACE_MAX_LENGTH = 60;
const PLACE_SUGGESTION_LIMIT = 5;
const PHOTO_SIZE = 96;

/** Noon on today's logical day, the anchor `WhenPicker` gives a picked date. */
function noonOfToday(): Date {
  const d = getLogicalToday();
  d.setHours(12, 0, 0, 0);
  return d;
}

interface Props {
  visible: boolean;
  /** The dish being edited, or null to add a new one. */
  dish: DishRating | null;
  /** A name to start a new dish with: the food log entry it is being rated from. */
  prefillName?: string;
  onClose: () => void;
}

/**
 * Adding or editing a rated dish — see `DishRating` in `types/index.ts`.
 *
 * Two typed fields, one answer, a note, the day it was last had and one photo.
 * The answer starts unset and is never filled in for the person: leaving it
 * unset is a real state ("no opinion yet"), and tapping the chosen answer
 * again puts it back. The place is free text, with the places already saved
 * offered as one-tap suggestions so "Thai Orchid" isn't typed three ways.
 *
 * It is a full-screen `EditorSheet`, so there is no swipe-down to guard; Cancel
 * and the system back both go through `handleCancel`.
 */
export function DishSheet({ visible, dish, prefillName, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dishes = useDishRatingStore(s => s.dishes);
  const addDish = useDishRatingStore(s => s.addDish);
  const updateDish = useDishRatingStore(s => s.updateDish);
  const removeDish = useDishRatingStore(s => s.removeDish);

  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [verdict, setVerdict] = useState<DishVerdict | null>(null);
  const [note, setNote] = useState('');
  const [lastHad, setLastHad] = useState<Date>(() => noonOfToday());
  const [photo, setPhoto] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const mountMenu = useSheetMount(menuOpen);
  const mountViewer = useSheetMount(viewing);
  const nameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setName(dish?.name ?? prefillName ?? '');
    setPlace(dish?.place ?? '');
    setVerdict(dish?.verdict ?? null);
    setNote(dish?.note ?? '');
    setLastHad(dish?.lastHadAt ? new Date(dish.lastHadAt) : noonOfToday());
    setPhoto(dish?.photo ?? null);
    setShowDatePicker(false);
  }, [visible, dish, prefillName]);

  const trimmedName = name.trim();
  const canSave = dishKeys(trimmedName, null).nameKey !== '';

  // What counts as unsaved: any field differing from what the sheet opened
  // with. A new dish opened from the food log starts with its name filled in,
  // and that alone is not an edit.
  const dirty = (() => {
    const base = dish ?? null;
    if (trimmedName !== (base?.name ?? prefillName ?? '').trim()) return true;
    if (place.trim() !== (base?.place ?? '')) return true;
    if (verdict !== (base?.verdict ?? null)) return true;
    if (note.trim() !== (base?.note ?? '')) return true;
    if (photo !== (base?.photo ?? null)) return true;
    if (base?.lastHadAt && lastHad.toISOString() !== base.lastHadAt) return true;
    return false;
  })();

  const handleCancel = () => {
    if (!dirty) { onClose(); return; }
    confirmDiscard(onClose);
  };

  const handleSave = () => {
    if (!canSave) return;
    if (dish) {
      updateDish(dish.id, { name: trimmedName, place, verdict, note, lastHadAt: lastHad, photo });
    } else {
      animateLayout();
      addDish({ name: trimmedName, place, verdict, note, lastHadAt: lastHad, photo });
    }
    haptics.success();
    onClose();
  };

  const handleDelete = () => {
    if (!dish) { onClose(); return; }
    confirmDelete({
      title: 'Delete this dish?',
      message: 'Its rating and note will be removed.',
      onConfirm: () => { animateLayout(); removeDish(dish.id); onClose(); },
    });
  };

  // Places already saved that match what is typed, most used first would be a
  // ranking nobody asked for, so they keep the order the list shows them in.
  const placeSuggestions = useMemo(() => {
    const typedKey = groceryNameKey(place);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of dishes) {
      if (!d.place || seen.has(d.placeKey)) continue;
      seen.add(d.placeKey);
      if (d.placeKey === typedKey) return [];
      if (typedKey && !d.placeKey.includes(typedKey)) continue;
      out.push(d.place);
    }
    return out.sort((a, b) => a.localeCompare(b)).slice(0, PLACE_SUGGESTION_LIMIT);
  }, [dishes, place]);

  const pickPhoto = async (source: RecipePhotoSource) => {
    await afterMenuDismissed();
    const result = await pickPhotoIntoFolder(DISH_PHOTO_FOLDER, source);
    if (result.status === 'canceled') return;
    if (result.status === 'denied') {
      alertPermissionOff(
        source === 'camera' ? 'Camera access is off' : 'Photo access is off',
        'Turn it on in Settings to add a photo to this dish.',
      );
      return;
    }
    if (result.status === 'failed') { Alert.alert('Couldn’t add the photo', result.message); return; }
    const picked = storedFileName(result.image.uri);
    if (picked) { haptics.success(); setPhoto(picked); }
  };

  const photoUri = dishPhotoUri(photo);

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={handleCancel}
      onShow={() => { if (!dish && !prefillName) nameInputRef.current?.focus(); }}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title={dish ? 'Edit dish' : 'New dish'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={handleCancel} minWidth={64} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={handleSave} disabled={!canSave} minWidth={64} />}
        />
      }
      footer={
        <>
          <WhenPicker
            visible={showDatePicker}
            value={lastHad}
            title="Last had"
            showTimeOfDay={false}
            showSuggest={false}
            onConfirm={picked => { if (picked) setLastHad(picked); setShowDatePicker(false); }}
            onCancel={() => setShowDatePicker(false)}
          />
          {mountMenu && <ActionMenu
            visible={menuOpen}
            title="Dish photo"
            actions={[
              { key: 'camera', label: 'Take a photo', icon: 'camera-outline', onPress: () => { void pickPhoto('camera'); } },
              { key: 'library', label: 'Choose from library', icon: 'images-outline', onPress: () => { void pickPhoto('library'); } },
              ...(photo ? [{ key: 'remove', label: 'Remove photo', icon: 'trash-outline' as const, destructive: true, onPress: () => setPhoto(null) }] : []),
            ]}
            onClose={() => setMenuOpen(false)}
          />}
          {mountViewer && photoUri && <PhotoViewer
            visible={viewing}
            initialIndex={0}
            title={trimmedName || 'Dish'}
            shots={[{ key: photo ?? 'photo', uri: photoUri, label: 'Dish photo. Tap to close.' }]}
            sheetName="DishPhotoViewer"
            onClose={() => setViewing(false)}
          />}
        </>
      }
    >
      <View style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Dish</Text>
          <TextField
            ref={nameInputRef}
            style={styles.fieldInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Pad see ew"
            placeholderTextColor={colors.textTertiary}
            maxLength={NAME_MAX_LENGTH}
            autoCapitalize="sentences"
            accessibilityLabel="Dish name"
          />
        </View>
        <View style={[styles.field, styles.fieldLast]}>
          <Text style={styles.fieldLabel}>Where</Text>
          <TextField
            style={styles.fieldInput}
            value={place}
            onChangeText={setPlace}
            placeholder="e.g. Thai Orchid"
            placeholderTextColor={colors.textTertiary}
            maxLength={PLACE_MAX_LENGTH}
            autoCapitalize="words"
            accessibilityLabel="Restaurant"
          />
        </View>
      </View>
      {placeSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          {placeSuggestions.map(p => (
            <TouchableOpacity
              key={p}
              style={styles.suggestion}
              onPress={() => { haptics.tap(); setPlace(p); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Use ${p}`}
            >
              <Text style={styles.suggestionText} numberOfLines={1}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.sectionLabel}>Would you order it again?</Text>
      <SegmentedControl<DishVerdict | null>
        label="Would you order it again?"
        surface="page"
        options={DISH_VERDICTS.map(v => ({ value: v, label: DISH_VERDICT_LABELS[v] }))}
        value={verdict}
        onChange={next => { haptics.tap(); setVerdict(next === verdict ? null : next); }}
      />
      <HelpText style={styles.hint}>Leave it unset if you have no opinion yet. Tap your answer again to clear it.</HelpText>

      <Text style={styles.sectionLabel}>Note</Text>
      <View style={styles.card}>
        <TextField
          style={styles.noteInput}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Ask for extra spicy"
          placeholderTextColor={colors.textTertiary}
          multiline
          accessibilityLabel="Note"
        />
      </View>

      <Text style={styles.sectionLabel}>Photo</Text>
      <View style={styles.photoRow}>
        {photo && (
          <TouchableOpacity
            onPress={() => { if (photoUri) { haptics.tap(); setViewing(true); } else Alert.alert('Not on this device yet', 'It will arrive the next time your other device syncs.'); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={photoUri ? 'Dish photo' : 'Dish photo, not on this device yet'}
          >
            {photoUri ? (
              <FadeInImage source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
            ) : (
              <View style={[styles.photo, styles.photoMissing]}>
                <Ionicons name="image-outline" size={24} color={colors.textSecondary} />
              </View>
            )}
          </TouchableOpacity>
        )}
        <InlineAction
          icon={photo ? 'camera-outline' : 'add'}
          label={photo ? 'Change photo' : 'Add a photo'}
          surface="page"
          variant={photo ? 'neutral' : 'accent'}
          onPress={() => { haptics.tap(); setMenuOpen(true); }}
        />
      </View>

      <View style={[styles.card, styles.lastCard]}>
        <EditorRow
          icon="calendar-outline"
          label="Last had"
          value={format(lastHad, 'EEE, MMM d, yyyy')}
          onPress={() => { haptics.tap(); setShowDatePicker(true); }}
        />
      </View>

      {dish && (
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={handleDelete}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Delete dish"
        >
          <Ionicons name="trash-outline" size={18} color={colors.redText} />
          <Text style={styles.deleteText}>Delete dish</Text>
        </TouchableOpacity>
      )}
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  field: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  fieldLast: { borderBottomWidth: 0 },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  fieldInput: { color: colors.text, fontSize: font.md, padding: 0 },
  noteInput: {
    color: colors.text,
    fontSize: font.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  lastCard: { marginTop: spacing.md },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  suggestion: {
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.xsm,
    maxWidth: '100%',
  },
  suggestionText: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: radius.md, backgroundColor: colors.bgTertiary },
  photoMissing: { alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  deleteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    paddingVertical: spacing.smd, marginTop: spacing.lg,
  },
  deleteText: { color: colors.redText, fontSize: font.md, fontWeight: fontWeight.medium },
});
