import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  Keyboard,
  Platform,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { EMOJI_GROUPS, searchEmoji } from '../utils/emojiCatalog';
import { firstEmoji } from '../utils/emojiInput';

interface Props {
  visible: boolean;
  /** The emoji currently set, so it can be shown as selected and cleared. */
  value?: string | null;
  title?: string;
  hint?: string;
  /** Fires with the chosen emoji, or `null` when the user clears it. */
  onSelect: (emoji: string | null) => void;
  onClose: () => void;
}

/**
 * Picks the single emoji that stands in for a category.
 *
 * This replaces focusing a hidden `TextInput` and hoping the system keyboard
 * comes up on its emoji page. It can't be made to: iOS exposes no keyboard type
 * for emoji and `UITextInputMode` is read-only, so a raw field opens on
 * whichever page the keyboard was last left on — usually letters, which is how
 * a category ends up named with two emoji and a stray space.
 *
 * A grid sidesteps all of that: one tap is one emoji, the result is guaranteed
 * to be a single cluster without any parsing, and the emoji you'd actually name
 * a category with are on the first screen instead of eight swipes into a
 * keyboard. The keyboard is still reachable from the footer for anything the
 * curated catalog doesn't carry, and `firstEmoji` clamps whatever comes back.
 */
export function EmojiPickerSheet({ visible, value, title = 'Choose an emoji', hint, onSelect, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [groupIndex, setGroupIndex] = useState(0);
  const keyboardInputRef = useRef<TextInput>(null);

  const results = useMemo(() => (query.trim() ? searchEmoji(query) : null), [query]);
  const shown = results ?? EMOJI_GROUPS[groupIndex].entries;

  const translateY = useRef(new Animated.Value(700)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // The sheet lifts as a whole so the grid stays visible while the search field
  // (or the keyboard fallback) has focus.
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      Animated.spring(keyboardOffset, {
        toValue: -(e.endCoordinates?.height ?? 0), ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      Animated.spring(keyboardOffset, {
        toValue: 0, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setGroupIndex(0);
    translateY.setValue(700);
    backdropOpacity.setValue(0);
    keyboardOffset.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: 800, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(700);
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) {
          dismiss();
        } else {
          Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const choose = (emoji: string | null) => {
    haptics.tap();
    dismiss(() => onSelect(emoji));
  };

  const switchGroup = (index: number) => {
    haptics.tap();
    setGroupIndex(index);
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss()} />

      <Animated.View
        style={[styles.sheetOuter, { transform: [{ translateY: Animated.add(translateY, keyboardOffset) }] }]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <View style={styles.titleRow}>
            <View style={styles.titleText}>
              <Text style={styles.sheetTitle}>{title}</Text>
              {!!hint && <Text style={styles.sheetHint}>{hint}</Text>}
            </View>
            {!!value && (
              <TouchableOpacity
                onPress={() => choose(null)}
                activeOpacity={interaction.activeOpacity}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Remove emoji"
              >
                <Text style={styles.removeLabel}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search emoji"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel="Search emoji"
            />
            {!!query && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Icon-only, and all of them on screen at once: labelled tabs ran off
              the right edge, which buried Objects and Symbols — the two groups a
              category is most often named from. */}
          {!results && (
            <View style={styles.tabRow}>
              {EMOJI_GROUPS.map((group, index) => {
                const active = index === groupIndex;
                return (
                  <TouchableOpacity
                    key={group.name}
                    style={[styles.tab, active && styles.tabActive]}
                    onPress={() => switchGroup(index)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={group.name}
                  >
                    <Ionicons
                      name={group.icon as any}
                      size={17}
                      color={active ? colors.accent : colors.textTertiary}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {!results && (
            <Text style={styles.groupName}>{EMOJI_GROUPS[groupIndex].name}</Text>
          )}

          {shown.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptySub}>Try another word, or use the keyboard below.</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.grid}
              contentContainerStyle={styles.gridContent}
              keyboardShouldPersistTaps="handled"
            >
              {shown.map(entry => {
                const selected = entry.char === value;
                return (
                  <TouchableOpacity
                    key={entry.char}
                    style={[styles.cell, selected && styles.cellSelected]}
                    onPress={() => choose(entry.char)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={entry.keywords.split(' ')[0]}
                  >
                    <Text style={styles.cellEmoji}>{entry.char}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.sep} />

          <TouchableOpacity
            style={styles.keyboardRow}
            onPress={() => { haptics.tap(); keyboardInputRef.current?.focus(); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Type an emoji using the keyboard"
          >
            <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.keyboardLabel}>Type one instead</Text>
            <Text style={styles.keyboardSub}>anything not listed</Text>
          </TouchableOpacity>
          {/* Invisible: the row above owns the tap and only raises the keyboard.
              Value stays empty so every keystroke arrives on its own, and
              anything that isn't an emoji is dropped rather than stored. */}
          <TextInput
            ref={keyboardInputRef}
            style={styles.hiddenInput}
            value=""
            onChangeText={text => {
              const picked = firstEmoji(text);
              if (picked) choose(picked);
            }}
            caretHidden
            autoCorrect={false}
            importantForAccessibility="no-hide-descendants"
          />
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.md, paddingBottom: 34,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.bgQuaternary },
  card: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.lg,
    overflow: 'hidden', marginBottom: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
  },
  titleText: { flex: 1 },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  sheetHint: { color: colors.textTertiary, fontSize: font.xs, paddingTop: 2 },
  removeLabel: { color: colors.red, fontSize: font.sm, fontWeight: fontWeight.medium, paddingTop: 3 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: colors.bgTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.sm, marginHorizontal: spacing.md,
    marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  // No lineHeight on a TextInput — it sinks the glyphs below the caret on iOS.
  searchInput: { flex: 1, color: colors.text, fontSize: font.md, paddingVertical: 8 },
  tabRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.xs,
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    borderWidth: border.sm, borderColor: 'transparent',
  },
  // The border is what still reads once grayscale accessibility mode flattens
  // accentSubtle and bgTertiary to nearly the same shade — these tabs are
  // icon-only, so there's no text/weight cue to fall back on.
  tabActive: { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
  groupName: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.md, paddingBottom: spacing.xs,
  },
  grid: { maxHeight: 232 },
  gridContent: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: spacing.sm, paddingBottom: spacing.sm,
  },
  cell: {
    width: '12.5%', aspectRatio: 1,
    alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm,
    borderWidth: border.sm, borderColor: 'transparent',
  },
  // An emoji glyph can't be recolored or reweighted to show state, so the
  // border is the only cue available that isn't hue alone.
  cellSelected: { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
  // Emoji sit high in their line box; a little extra height keeps the descender
  // of the glyph from clipping the way it did on task rows.
  cellEmoji: { fontSize: 26, lineHeight: 34, textAlign: 'center' },
  emptyWrap: { alignItems: 'center', gap: 2, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  emptyTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  emptySub: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  keyboardRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  keyboardLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  keyboardSub: { color: colors.textTertiary, fontSize: font.xs, flex: 1 },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  cancelCard: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.lg,
    paddingVertical: 18, alignItems: 'center',
  },
  cancelLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
});
