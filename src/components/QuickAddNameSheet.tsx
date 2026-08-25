import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { EmojiPickerSheet } from './EmojiPickerSheet';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  placeholder: string;
  /** Adds a small emoji button ahead of the name — for things that carry one. */
  withEmoji?: boolean;
  /** Label for the secondary "open the full editor" button; omit to hide it. */
  moreLabel?: string;
  /**
   * A second way to add the same kind of thing, beside typing its name rather
   * than instead of it — People's "From Contacts". Omit for the sheets that
   * have only the one way in, which is most of them.
   *
   * Enabled with the field empty, unlike `moreLabel`: it doesn't act on what
   * has been typed, it replaces the typing.
   */
  altAction?: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void };
  autoCapitalize?: 'none' | 'words';
  /** The trimmed name, plus the trimmed emoji when `withEmoji` is set. */
  onSubmit: (name: string, emoji: string | null) => void;
  onOpenFull?: (name: string, emoji: string | null) => void;
  onClose: () => void;
}

/**
 * The quick-add sheet behind the FAB on the name-only list screens
 * (categories, tags, templates). Same centered card, entrance spring and
 * keyboard behaviour as QuickAddModal/QuickAddProjectModal — those two carry
 * enough per-type fields to be worth their own components, while everything
 * that's just "a name, maybe an emoji" shares this one.
 */
export function QuickAddNameSheet({
  visible, placeholder, withEmoji, moreLabel, altAction, autoCapitalize = 'words',
  onSubmit, onOpenFull, onClose,
}: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const inputRef = useRef<TextInput>(null);
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const translateYAnim = useRef(new Animated.Value(16)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // The sheet glides to its new centered resting spot on its own spring
  // rather than tracking the keyboard 1:1 — same as the other quick adds.
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      Animated.spring(keyboardOffsetAnim, {
        toValue: -height / 2, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardOffsetAnim, {
        toValue: 0, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setEmoji('');
    setEmojiPickerOpen(false);
    scaleAnim.setValue(0.95);
    translateYAnim.setValue(16);
    sheetOpacity.setValue(0);
    backdropOpacity.setValue(0);
    keyboardOffsetAnim.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Focus (and the keyboard's own slide-up) starts alongside the sheet
    // animation rather than after it, so the keyboard is up sooner — same
    // fix as QuickAddModal's (#1210).
    inputRef.current?.focus();
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.95);
      sheetOpacity.setValue(0);
      onClose();
      after?.();
    });
  };

  const trimmedName = name.trim();
  const trimmedEmoji = withEmoji ? emoji.trim() || null : null;

  const handleAdd = () => {
    if (!trimmedName) return;
    haptics.success();
    onSubmit(trimmedName, trimmedEmoji);
    dismiss();
  };

  const handleOpenFull = () => {
    if (!onOpenFull) return;
    haptics.tap();
    const captured = { name: trimmedName, emoji: trimmedEmoji };
    dismiss(() => onOpenFull(captured.name, captured.emoji));
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />
      <View style={styles.centeredContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            shadows.sheet,
            {
              opacity: sheetOpacity,
              transform: [{ scale: scaleAnim }, { translateY: Animated.add(translateYAnim, keyboardOffsetAnim) }],
            },
          ]}
        >
          <View style={styles.row}>
            {withEmoji && (
              <TouchableOpacity
                style={styles.emojiWell}
                onPress={() => { haptics.tap(); Keyboard.dismiss(); setEmojiPickerOpen(true); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={emoji ? `Emoji, ${emoji}` : 'Emoji, none set'}
                accessibilityHint="Opens the emoji picker"
              >
                {emoji ? (
                  <Text style={styles.emojiGlyph}>{emoji}</Text>
                ) : (
                  <Ionicons name="happy-outline" size={18} color={colors.textTertiary} />
                )}
              </TouchableOpacity>
            )}
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={placeholder}
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
              onSubmitEditing={handleAdd}
              returnKeyType="done"
              autoCapitalize={autoCapitalize}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.addBtn, !trimmedName && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!trimmedName}
              accessibilityRole="button"
              accessibilityLabel="Create"
            >
              <Ionicons name="arrow-up" size={18} color={colors.onAccent} />
            </TouchableOpacity>
          </View>

          {!!altAction && (
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={altAction.onPress}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={altAction.label}
            >
              <Ionicons name={altAction.icon} size={15} color={colors.textSecondary} />
              <Text style={styles.moreBtnText}>{altAction.label}</Text>
            </TouchableOpacity>
          )}

          {!!moreLabel && !!onOpenFull && (
            <TouchableOpacity
              style={[styles.moreBtn, !trimmedName && styles.moreBtnDisabled]}
              onPress={handleOpenFull}
              disabled={!trimmedName}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.moreBtnText}>{moreLabel}</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>

      {withEmoji && (
        <EmojiPickerSheet
          visible={emojiPickerOpen}
          value={emoji || null}
          title="Emoji"
          hint="Optional. It stands in for this everywhere it's shown."
          onSelect={picked => setEmoji(picked ?? '')}
          onClose={() => { setEmojiPickerOpen(false); inputRef.current?.focus(); }}
        />
      )}
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emojiWell: {
    width: 38, height: 38, borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  emojiGlyph: { fontSize: font.xl, lineHeight: 26, textAlign: 'center' },
  input: {
    flex: 1,
    fontSize: font.md,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  addBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: colors.bgTertiary,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  moreBtnDisabled: {
    opacity: 0.5,
  },
  moreBtnText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
});
