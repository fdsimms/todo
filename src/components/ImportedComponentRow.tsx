import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, checkboxRadius, interaction,
  type Colors,
} from '../theme';
import { InlineAction } from './InlineAction';
import { RecipeComponentPicker } from './RecipeComponentPicker';
import { ImportedComponentEditSheet } from './ImportedComponentEditSheet';
import { LazySheet } from './LazySheet';
import { formatServingsRange } from '../utils/recipeUtils';
import type { Recipe } from '../types';
import type { ReferenceCandidate } from '../utils/recipeImportComponents';
import type { useRecipeComponentImports } from '../hooks/useRecipeComponentImports';
import { MAX_RECIPE_PHOTOS, type RecipePhotoSource } from '../utils/recipePhoto';
import { haptics } from '../utils/haptics';
import { capitalize } from '../utils/capitalize';
import { useActionMenu } from '../hooks/useActionMenu';
import { BUTTON_LABEL } from '../copy/shared';
import type { ExtractedRecipe } from '../services/aiSuggestions';

const CHECKBOX_SIZE = 22;

export type ComponentImports = ReturnType<typeof useRecipeComponentImports>;

interface Props {
  candidate: ReferenceCandidate;
  /** The import's state, keyed by candidate (and by nested candidate); the row reads and drives its own entry. */
  imports: ComponentImports;
  /** The recipe this reference is being imported into, or null before it exists yet (RecipeCreateSheet). Passed straight through to RecipeComponentPicker. */
  parent: Recipe | null;
}

/**
 * "This one also calls for the salsa verde on page 45" — one row of the
 * import sheets' referenced-recipes list, shared by `RecipeCreateSheet` and
 * `RecipeExtractSheet`.
 *
 * **The row has two jobs and shows exactly one of them at a time**, decided by
 * whether the referenced recipe is already in the box. A recipe you have is a
 * tick: linking it costs nothing and un-links in one tap. A recipe you don't is
 * an invitation to turn the page and take a second photo, which is why the two
 * photo buttons sit in the row itself rather than behind a tap that opens
 * something. The book is open; the fewer steps between the reference and the
 * shutter, the better this works.
 *
 * A read row turns back into the first kind — a name, a tick, and what was
 * found — so the two paths converge on the same row before the sheet commits
 * anything. It can be corrected from there (**Edit**, `ImportedComponentEditSheet`),
 * since the only other way to fix a misread component was to finish the import
 * and edit the saved recipe. The name shown is the *photographed page's* own title rather than
 * the word the first page used for it, because that is what the new recipe will
 * be called.
 *
 * **The automatic match is exact-name-only, so it misses the common case where
 * the box already has this recipe under a different name.** "Find in recipe
 * box" is the row's manual answer to that — the same `RecipeComponentPicker`
 * the recipe screen's own "Add a component" uses, so a name typed once ranks
 * the whole box the same way either entry point does. Picking one behaves like
 * an automatic match from there on: ticked, and shown as already in the box.
 */
export function ImportedComponentRow({ candidate, imports, parent }: Props) {
  const state = imports.stateFor(candidate.key);
  const accepted = imports.accepted.has(candidate.key);
  const onToggle = () => imports.toggle(candidate.key);
  const onImport = (source: RecipePhotoSource) => imports.importFrom(candidate.key, source);
  const onLink = (picked: Recipe) => imports.linkTo(candidate.key, picked);
  const onEdit = (edited: ExtractedRecipe) => imports.editRead(candidate.key, edited);
  const onDismiss = () => imports.dismiss(candidate.key);
  // What this component's own page points at (one level deep): shown in its edit sheet.
  const nested = imports.nestedFor(candidate.key);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const actionMenu = useActionMenu();

  const { reference, match } = candidate;
  const read = state.status === 'read' ? state.extracted : null;
  const linked = state.status === 'linked' ? state.recipe : null;
  // Tickable exactly when there's something to tick for: a recipe to link, or
  // one that's been read and is about to be created.
  const tickable = !!match || !!read || !!linked;
  const busy = state.status === 'picking' || state.status === 'reading';

  const title = read?.name || reference.name;
  // The source's own words for where it is, capitalised for the start of a
  // line. Never restated in our words: "page 45" is what the book said.
  const where = capitalize(reference.reference);

  const detail = (() => {
    if (match) return 'already in your recipe box';
    // Named, because unlike an automatic match the two names are usually
    // different — that's exactly why this reference needed a manual pick.
    if (linked) return `linked to “${linked.name}”`;
    if (state.status === 'picking') return 'getting the photo ready';
    if (state.status === 'reading') return 'reading the photo';
    if (state.status === 'failed') return state.message;
    if (read) {
      const count = `${read.ingredients.length} ingredient${read.ingredients.length === 1 ? '' : 's'}`;
      const serves = formatServingsRange(read.servings, read.servingsMax);
      const base = serves ? `${count}, serves ${serves}` : count;
      const photoCount = state.status === 'read' ? state.photoCount : 1;
      const withPhotos = photoCount > 1 ? `${base}, from ${photoCount} photos` : base;
      // The edit sheet is where these are answered, so the row says there are some.
      return nested.length > 0
        ? `${withPhotos}, mentions ${nested.length} other recipe${nested.length === 1 ? '' : 's'}`
        : withPhotos;
    }
    return 'not in your recipe box yet';
  })();

  const meta = `${where} · ${detail}`;
  const accessibilityLabel = `${title}, ${meta}`;

  /**
   * A row that hasn't been read: the camera leads, since the reference points
   * at a page of the book already in the reader's hands. The library and the
   * clipboard are icon-only beside it, so the row's own line reads as one
   * answer rather than four, and "Find in recipe box" sits under them as the
   * other answer ("I already have this one").
   */
  const renderPhotoButtons = (cameraLabel: string) => (
    <View style={styles.actions}>
      <InlineAction
        label={cameraLabel}
        icon="camera-outline"
        onPress={() => onImport('camera')}
        haptic
        accessibilityLabel={`${cameraLabel} of ${title}`}
      />
      <InlineAction
        icon="images-outline"
        variant="neutral"
        onPress={() => onImport('library')}
        haptic
        accessibilityLabel={`Choose a photo of ${title}`}
      />
      <InlineAction
        icon="copy-outline"
        variant="neutral"
        onPress={() => onImport('clipboard')}
        haptic
        accessibilityLabel={`Paste an image of ${title}`}
      />
      <InlineAction
        label="Find in recipe box"
        icon="search-outline"
        variant="neutral"
        onPress={() => setPickerVisible(true)}
        haptic
        accessibilityLabel={`Find ${title} in your recipe box`}
      />
    </View>
  );

  /**
   * A row that has been read: correcting it, or adding the next page of it.
   * "Find in recipe box" is not offered, because the recipe is already answered;
   * the edit sheet carries that escape for a read that came back wrong.
   *
   * Adding a page re-reads every photo as one recipe (see `importFrom`), which
   * replaces any correction made since, so it asks first when there is one.
   */
  const addPage = (source: RecipePhotoSource) => {
    if (state.status === 'read' && state.edited) {
      Alert.alert(
        'Add a page?',
        'Reading another page re-reads the whole recipe, so the edits you made to it will be lost.',
        [
          { text: BUTTON_LABEL.cancel, style: 'cancel' },
          { text: 'Add a page', style: 'destructive', onPress: () => onImport(source) },
        ],
      );
      return;
    }
    onImport(source);
  };

  const openAddPageMenu = () => {
    actionMenu.open({
      title: 'Add a page',
      actions: [
        { key: 'camera', label: 'Take a photo', icon: 'camera-outline', onPress: () => addPage('camera') },
        { key: 'library', label: 'Choose a photo', icon: 'images-outline', onPress: () => addPage('library') },
        { key: 'paste', label: 'Paste image', icon: 'copy-outline', onPress: () => addPage('clipboard') },
      ],
    });
  };

  const body = (
    <View style={styles.body}>
      <Text style={styles.name} numberOfLines={1}>{title}</Text>
      <Text style={[styles.meta, state.status === 'failed' && styles.metaError]} numberOfLines={2}>
        {meta}
      </Text>
      {state.status === 'idle' && !match && renderPhotoButtons('Take a photo')}
      {state.status === 'failed' && renderPhotoButtons('Try again')}
      {/* Adds a page to the read rather than redoing it — see importFrom's
          append-on-read rule — so it drops out once the cap is reached the
          same way the main import's own add buttons do. */}
      {!!read && (
        <View style={styles.actions}>
          <InlineAction
            label="Edit"
            icon="create-outline"
            onPress={() => setEditOpen(true)}
            haptic
            accessibilityLabel={`Edit ${title}`}
          />
          {state.status === 'read' && state.photoCount < MAX_RECIPE_PHOTOS && (
            <InlineAction
              label="Add a page"
              icon="camera-outline"
              variant="neutral"
              onPress={openAddPageMenu}
              haptic
              accessibilityLabel={`Add another page of ${title}`}
            />
          )}
        </View>
      )}
      {!!linked && (
        <View style={styles.actions}>
          <InlineAction
            label="Choose a different recipe"
            icon="search-outline"
            variant="neutral"
            onPress={() => setPickerVisible(true)}
            haptic
            accessibilityLabel={`Choose a different recipe for ${title}`}
          />
        </View>
      )}
      <RecipeComponentPicker
        visible={pickerVisible}
        recipe={parent}
        onClose={() => setPickerVisible(false)}
        onSelect={onLink}
      />
      {!!read && (
        <LazySheet open={editOpen}>
          <ImportedComponentEditSheet
            visible={editOpen}
            fallbackName={reference.name}
            extracted={read}
            parent={parent}
            onSave={onEdit}
            onLink={onLink}
            references={nested}
            coveringKeys={imports.nestedCovering(candidate.key)}
            renderReference={nestedCandidate => (
              <ImportedComponentRow
                key={nestedCandidate.key}
                candidate={nestedCandidate}
                imports={imports}
                parent={null}
              />
            )}
            onClose={() => setEditOpen(false)}
          />
        </LazySheet>
      )}
      {actionMenu.element}
    </View>
  );

  return (
    <View style={styles.row}>
      {tickable ? (
        <TouchableOpacity
          onPress={() => { haptics.tap(); onToggle(); }}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          accessibilityLabel={accessibilityLabel}
        >
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
            {accepted && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onFill} />}
          </View>
        </TouchableOpacity>
      ) : busy ? (
        <View style={styles.slot}>
          <ActivityIndicator color={colors.purple} />
        </View>
      ) : (
        // The same badge a component wears on the recipe screen, so the row
        // looks like the thing it is about to become.
        <View style={styles.slot} accessibilityElementsHidden importantForAccessibility="no">
          <View style={styles.badge}>
            <Ionicons name="restaurant-outline" size={12} color={colors.accent} />
          </View>
        </View>
      )}
      {body}
      <TouchableOpacity
        onPress={() => { haptics.tap(); onDismiss(); }}
        disabled={busy}
        activeOpacity={interaction.activeOpacity}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${title}`}
      >
        <Ionicons name="close-circle-outline" size={iconSize.md} color={colors.textTertiary} />
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: colors.bgSecondary,
      marginHorizontal: spacing.md,
      marginVertical: spacing.xxs,
      borderRadius: radius.md,
      paddingVertical: spacing.smd,
      paddingHorizontal: spacing.md,
    },
    // Keeps the badge and the spinner on the checkbox's own baseline, so the
    // three leading states don't each sit at a different height.
    slot: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.accentSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkbox: {
      width: CHECKBOX_SIZE,
      height: CHECKBOX_SIZE,
      borderRadius: checkboxRadius(CHECKBOX_SIZE),
      borderWidth: border.md,
      borderColor: colors.separator,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.purpleFill, borderColor: colors.purpleFill },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: spacing.xxs },
    metaError: { color: colors.redText },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  });
}
