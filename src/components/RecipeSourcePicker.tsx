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
import { haptics } from '../utils/haptics';
import { looksLikeBareUrl } from '../utils/recipeUtils';
import type { RecipePhoto, RecipePhotoSource } from '../utils/recipePhoto';

export type RecipeInputMode = 'paste' | 'photo';

interface Props {
  /** One line saying where the result lands. Differs per surface. */
  intro: string;
  mode: RecipeInputMode;
  onChangeMode: (mode: RecipeInputMode) => void;
  text: string;
  onChangeText: (text: string) => void;
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
 * The input step shared by every recipe import: paste some text, or photograph
 * the page. Extracted because it is otherwise the same markup in three sheets —
 * `RecipeExtractSheet`, `GroceryAISheet`'s recipe mode, and `RecipeCreateSheet`.
 *
 * A segmented control rather than a photo button hanging off the paste box:
 * having pasted text *and* an attached photo would otherwise be representable,
 * and the question of which one wins is better settled by the layout than by a
 * precedence rule nobody can see. `paste` is the default, so nothing about the
 * existing flow changes until someone taps Photo.
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

  // A pasted link is the one input that has to be refused rather than run —
  // see looksLikeBareUrl. Nothing here can open a page, and the model handed an
  // address writes a recipe out of the words in it.
  const paste = mode === 'paste' && !photoOnly;
  const bareUrl = paste && looksLikeBareUrl(text);
  const ready = paste ? !!text.trim() && !bareUrl : !!photo;

  const renderTab = (value: RecipeInputMode, label: string, icon: React.ComponentProps<typeof Ionicons>['name']) => {
    const active = mode === value;
    return (
      <TouchableOpacity
        key={value}
        style={[styles.tab, active && styles.tabActive]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => {
          if (active) return;
          haptics.tap();
          onChangeMode(value);
        }}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
      >
        <Ionicons
          name={icon}
          size={iconSize.sm}
          color={active ? colors.onAccent : colors.textSecondary}
        />
        <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      </TouchableOpacity>
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
        <View style={styles.tabs}>
          {renderTab('paste', 'Paste', 'clipboard-outline')}
          {renderTab('photo', 'Photo', 'camera-outline')}
        </View>
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
                  ?? 'Works on a cookbook page, a recipe card, a clipping — anything with the ingredients readable.'}
              </Text>
            </>
          )}
        </View>
      )}

      {bareUrl && (
        <View style={styles.warning}>
          <Ionicons name="alert-circle-outline" size={iconSize.sm} color={colors.warning} />
          <View style={styles.warningBody}>
            <Text style={styles.warningTitle}>That's a link, not a recipe</Text>
            <Text style={styles.warningDetail}>
              dundundun can't open a web page. Open the link, copy the ingredients and method,
              and paste those here — or photograph the page instead.
            </Text>
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
    warningBody: { flex: 1, gap: 2 },
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
    tabs: { flexDirection: 'row', gap: spacing.xs },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      flex: 1,
      paddingVertical: 8,
      borderRadius: radius.full,
      backgroundColor: colors.bgSecondary,
    },
    tabActive: { backgroundColor: colors.accent },
    tabText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
    tabTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
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
