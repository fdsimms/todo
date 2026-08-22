import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, checkboxRadius,
  type Colors,
} from '../theme';
import { InlineAction } from './InlineAction';
import { formatServingsRange } from '../utils/recipeUtils';
import type { ReferenceCandidate } from '../utils/recipeImportComponents';
import type { ComponentImportState } from '../hooks/useRecipeComponentImports';
import type { RecipePhotoSource } from '../utils/recipePhoto';
import { haptics } from '../utils/haptics';

const CHECKBOX_SIZE = 22;

interface Props {
  candidate: ReferenceCandidate;
  state: ComponentImportState;
  accepted: boolean;
  onToggle: () => void;
  onImport: (source: RecipePhotoSource) => void;
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
 * anything. The name shown is the *photographed page's* own title rather than
 * the word the first page used for it, because that is what the new recipe will
 * be called.
 */
export function ImportedComponentRow({ candidate, state, accepted, onToggle, onImport }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { reference, match } = candidate;
  const read = state.status === 'read' ? state.extracted : null;
  // Tickable exactly when there's something to tick for: a recipe to link, or
  // one that's been read and is about to be created.
  const tickable = !!match || !!read;
  const busy = state.status === 'picking' || state.status === 'reading';

  const title = read?.name || reference.name;
  // The source's own words for where it is, capitalised for the start of a
  // line. Never restated in our words: "page 45" is what the book said.
  const where = reference.reference.charAt(0).toUpperCase() + reference.reference.slice(1);

  const detail = (() => {
    if (match) return 'already in your recipe box';
    if (state.status === 'picking') return 'getting the photo ready';
    if (state.status === 'reading') return 'reading the photo';
    if (state.status === 'failed') return state.message;
    if (read) {
      const count = `${read.ingredients.length} ingredient${read.ingredients.length === 1 ? '' : 's'}`;
      const serves = formatServingsRange(read.servings, read.servingsMax);
      return serves ? `${count}, serves ${serves}` : count;
    }
    return 'not in your recipe box yet';
  })();

  const meta = `${where} · ${detail}`;
  const accessibilityLabel = `${title}, ${meta}`;

  /**
   * The same pair the source picker offers, with the camera leading: the
   * reference points at a page of the book already in the reader's hands.
   *
   * A row that has already been read drops the second button. Both fit on one
   * line at 390pt only while the first is short, and "Take another photo"
   * beside "Choose a photo" wraps — a row that is already answered doesn't
   * need two ways to answer it again.
   */
  const renderPhotoButtons = (cameraLabel: string, withLibrary = true) => (
    <View style={styles.actions}>
      <InlineAction
        label={cameraLabel}
        icon="camera-outline"
        variant={read ? 'neutral' : 'accent'}
        onPress={() => onImport('camera')}
        haptic
        accessibilityLabel={`${cameraLabel} of ${title}`}
      />
      {withLibrary && (
        <InlineAction
          label="Choose a photo"
          icon="images-outline"
          variant="neutral"
          onPress={() => onImport('library')}
          haptic
          accessibilityLabel={`Choose a photo of ${title}`}
        />
      )}
    </View>
  );

  const body = (
    <View style={styles.body}>
      <Text style={styles.name} numberOfLines={1}>{title}</Text>
      <Text style={[styles.meta, state.status === 'failed' && styles.metaError]} numberOfLines={2}>
        {meta}
      </Text>
      {state.status === 'idle' && !match && renderPhotoButtons('Take a photo')}
      {state.status === 'failed' && renderPhotoButtons('Try again')}
      {!!read && renderPhotoButtons('Take another photo', false)}
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
            {accepted && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
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
      marginVertical: 2,
      borderRadius: radius.md,
      paddingVertical: 12,
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
    checkboxOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    body: { flex: 1 },
    name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
    meta: { fontSize: font.xs, color: colors.textTertiary, marginTop: 2 },
    metaError: { color: colors.red },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  });
}
