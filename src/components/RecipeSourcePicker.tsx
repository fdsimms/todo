import React, { useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  radius,
  font,
  fontWeight,
  border,
  iconSize,
  interaction,
  type Colors,
} from '../theme';
import { InlineAction } from './InlineAction';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { haptics } from '../utils/haptics';
import { looksLikeBareUrl } from '../utils/recipeUtils';
import { normalizeRecipeUrl } from '../utils/recipeUrl';
import type { RecipePhoto, RecipePhotoSource } from '../utils/recipePhoto';

export type RecipeInputMode = 'paste' | 'link' | 'photo';

interface Props {
  /** One line saying where the result lands. Differs per surface. */
  intro: string;
  mode: RecipeInputMode;
  onChangeMode: (mode: RecipeInputMode) => void;
  text: string;
  onChangeText: (text: string) => void;
  url: string;
  onChangeUrl: (url: string) => void;
  photo: RecipePhoto | null;
  onPickPhoto: (source: RecipePhotoSource) => void;
  onClearPhoto: () => void;
  /** True while the picker/downscale is running — the shutter is slow enough to notice. */
  picking?: boolean;
  /**
   * Drops the Paste tab and shows only the camera. For a source that genuinely
   * has no text form — a receipt is a piece of paper, and there is nothing to
   * paste — where offering an empty box would be offering a dead end.
   */
  photoOnly?: boolean;
  /** One line under the two photo buttons saying what a good shot looks like. */
  photoHint?: string;
  ctaLabel: string;
  onRun: () => void;
}

/**
 * The input step shared by every recipe import: paste some text, open a link,
 * or photograph the page. Extracted because it is otherwise the same markup in
 * three sheets — `RecipeExtractSheet`, `GroceryAISheet`'s recipe mode, and
 * `RecipeCreateSheet`.
 *
 * A segmented control rather than a photo button hanging off the paste box:
 * having pasted text *and* an attached photo would otherwise be representable,
 * and the question of which one wins is better settled by the layout than by a
 * precedence rule nobody can see. `paste` is the default, so nothing about the
 * existing flow changes until someone taps another tab.
 *
 * **Link is its own tab rather than a smart paste box.** The URL still gets
 * *noticed* in the paste box, because someone who pastes one there is exactly
 * the person this is for — but it's noticed as a nudge onto the tab that
 * handles it, not as a second job for a multiline field with the wrong keyboard
 * and the wrong autocapitalisation. A mode nobody can see is one nobody uses.
 *
 * Owns no scroll view — the two sheets that need `useKeyboardInsetScroll` keep
 * it on their own ScrollView, where it already is.
 */
export function RecipeSourcePicker({
  intro,
  mode,
  onChangeMode,
  text,
  onChangeText,
  url,
  onChangeUrl,
  photo,
  onPickPhoto,
  onClearPhoto,
  picking = false,
  photoOnly = false,
  photoHint,
  ctaLabel,
  onRun,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // A link pasted into the *text* box still can't be extracted as text — it's
  // the Link tab's job now, so the refusal became a way over to it.
  //
  // Both text modes are read through locals rather than off `mode` directly,
  // because `photoOnly` removes them: a caller with no text form at all must
  // not be able to land on a refusal about a box it never renders.
  const paste = mode === 'paste' && !photoOnly;
  const link = mode === 'link' && !photoOnly;
  const bareUrl = paste && looksLikeBareUrl(text);
  const typedUrl = url.trim();
  const badUrl = link && !!typedUrl && !normalizeRecipeUrl(typedUrl);
  const ready =
    paste ? !!text.trim() && !bareUrl
    : link ? !!normalizeRecipeUrl(typedUrl)
    : !!photo;

  const useLinkTab = () => {
    haptics.tap();
    // Carrying the address over is the whole point of the nudge — retyping it
    // is what someone who already pasted it would not do.
    onChangeUrl(text.trim());
    onChangeMode('link');
  };

  // Three fixed ways in, exactly one of them live — a SegmentedControl by the
  // rule in that component's own doc comment. `surface="page"` because every
  // caller renders this straight onto `colors.bg`, which is what the old
  // hand-rolled pills were using a `bgSecondary` fill to work around.
  const MODE_OPTIONS: SegmentOption<RecipeInputMode>[] = [
    { value: 'paste', label: 'Paste', icon: 'clipboard-outline' },
    { value: 'link', label: 'Link', icon: 'link-outline' },
    { value: 'photo', label: 'Photo', icon: 'camera-outline' },
  ];

  const renderPhotoButton = (
    source: RecipePhotoSource,
    label: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
  ) => (
    <TouchableOpacity
      style={[styles.photoBtn, picking && styles.photoBtnOff]}
      activeOpacity={interaction.activeOpacity}
      onPress={() => onPickPhoto(source)}
      disabled={picking}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={iconSize.md} color={colors.accent} />
      <Text style={styles.photoBtnText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Text style={styles.intro}>{intro}</Text>

      {!photoOnly && (
        <SegmentedControl
          label="How to add the recipe"
          value={mode}
          onChange={onChangeMode}
          options={MODE_OPTIONS}
          surface="page"
        />
      )}

      {paste ? (
        <TextInput
          style={styles.pasteInput}
          value={text}
          onChangeText={onChangeText}
          placeholder="Paste your recipe here…"
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Recipe text"
        />
      ) : link ? (
        <View style={styles.linkWrap}>
          <TextInput
            style={styles.linkInput}
            value={url}
            onChangeText={onChangeUrl}
            placeholder="e.g. example.com/chili-recipe"
            placeholderTextColor={colors.textTertiary}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="go"
            onSubmitEditing={() => { if (ready) onRun(); }}
            accessibilityLabel="Recipe link"
          />
          <Text style={badUrl ? styles.linkBad : styles.linkHint}>
            {badUrl
              ? 'That doesn’t look like a web address yet.'
              : 'Works on most recipe sites. Some build their page in the browser. For those, copy the recipe and paste it instead.'}
          </Text>
        </View>
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
            onPress={() => { haptics.tap(); onClearPhoto(); }}
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
                {photoHint
                  ?? 'Works on a cookbook page, a recipe card, a clipping: anything with the ingredients readable.'}
              </Text>
            </>
          )}
        </View>
      )}

      {bareUrl && (
        <View style={styles.warning}>
          <Ionicons name="link-outline" size={iconSize.sm} color={colors.warning} />
          <View style={styles.warningBody}>
            <Text style={styles.warningTitle}>That's a link</Text>
            <Text style={styles.warningDetail}>
              The Link tab opens the page and reads the recipe off it. Pasted here it's only
              an address, with no ingredients in it.
            </Text>
            <InlineAction
              label="Use the Link tab"
              icon="arrow-forward"
              onPress={useLinkTab}
              style={styles.warningAction}
              accessibilityLabel="Open this link on the Link tab"
            />
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[styles.runBtn, !ready && styles.runBtnOff]}
        activeOpacity={interaction.activeOpacity}
        onPress={onRun}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
      >
        <Ionicons name="sparkles" size={iconSize.sm} color={colors.onAccent} />
        <Text style={styles.runBtnText}>{ctaLabel}</Text>
      </TouchableOpacity>
    </>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    intro: {
      color: colors.textTertiary,
      fontSize: font.sm,
      paddingBottom: spacing.xs,
    },
    warning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.warningBg,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    warningBody: { flex: 1, gap: 2, alignItems: 'flex-start' },
    warningTitle: {
      color: colors.text,
      fontSize: font.sm,
      fontWeight: fontWeight.semibold,
    },
    warningDetail: {
      color: colors.textSecondary,
      fontSize: font.xs,
      lineHeight: font.xs * 1.4,
    },
    warningAction: { marginTop: spacing.xs },
    pasteInput: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      fontSize: font.md,
      color: colors.text,
      minHeight: 220,
    },
    // Same 220 as the paste box and the photo choices, so switching tabs doesn't
    // walk the CTA up and down the sheet under the finger reaching for it.
    linkWrap: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      minHeight: 220,
      gap: spacing.sm,
    },
    linkInput: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      // Height rather than lineHeight — see the note in CLAUDE.md on what
      // lineHeight does to a TextInput's glyph baseline on iOS.
      height: 44,
      fontSize: font.md,
      color: colors.text,
    },
    linkHint: {
      color: colors.textTertiary,
      fontSize: font.xs,
      lineHeight: font.xs * 1.4,
      textAlign: 'center',
    },
    linkBad: {
      color: colors.red,
      fontSize: font.xs,
      lineHeight: font.xs * 1.4,
      textAlign: 'center',
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
    photoHint: {
      color: colors.textTertiary,
      fontSize: font.xs,
      textAlign: 'center',
      paddingTop: spacing.xs,
    },
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
  });
}
