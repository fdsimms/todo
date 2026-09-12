import React, { useEffect, useState } from 'react';
import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, type Colors } from '../theme';

const TOKENS: { char: string; label: string }[] = [
  { char: '#', label: 'hash' },
  { char: '@', label: 'at' },
  { char: '!', label: 'exclamation' },
];

interface TitleTokenAccessoryProps {
  /** Required unless `floating` — a floating bar attaches to nothing by id. */
  nativeID?: string;
  onInsert: (token: string) => void;
  /**
   * Applies whatever quick-add tooltip is currently active — the same action
   * tapping the tooltip itself performs. Omit for a title field with no such
   * tooltip (the task editor's), which then never shows the confirm button.
   */
  onConfirm?: () => void;
  /** Whether there's a tooltip up for `onConfirm` to apply right now. */
  confirmVisible?: boolean;
  /**
   * `InputAccessoryView` doesn't support a multiline `TextInput` — a
   * documented iOS/RN limitation: the view is simply never attached, with no
   * warning to say why. The task editor's title needs `multiline` (a long
   * title wraps there instead of scrolling sideways), so it sets this
   * instead of `nativeID` and gets the same bar rendered as a plain view
   * that tracks the keyboard's own height and floats just above it. Because
   * that's no longer a real accessory view, there's no native mechanism
   * left tying its visibility to which field has focus — `focused` is the
   * caller saying so by hand.
   */
  floating?: boolean;
  /** Only read when `floating`. */
  focused?: boolean;
}

/**
 * iOS keeps "#", "@" and "!" off the default keyboard layout — all three
 * live behind the "123" key — so typing any of them into a task title costs
 * a keyboard switch, including for "#" and "!" which drive category/tag and
 * priority parsing (CATEGORY_OR_TAG_TOKEN_PATTERN, PRIORITY_TOKEN_PATTERN in
 * parseTaskInput.ts). This bar sits above the keyboard with one-tap buttons
 * for all three, the same InputAccessoryView pattern NumberPadAccessory uses
 * for number-pad fields — but the insert target differs per field, so unlike
 * that shared "Done" bar, each title input using this one needs its own
 * nativeID and onInsert.
 *
 * The confirm checkmark on the right is a second way to accept whatever
 * tooltip is showing below the field — the tooltip itself is easy to miss
 * while looking at the keyboard rather than the field above it, and this
 * sits right where the thumb already is. It only renders when the caller
 * passes both `onConfirm` and `confirmVisible`.
 *
 * The clipboard button is the same insert as a token, just with the
 * clipboard's text standing in for a fixed character — `onInsert` already
 * splices whatever string it's given in at the caret (`insertToken` in
 * `useTitleSelection`), so a copied link lands the same way tapping "#"
 * does, without detouring through tapping into the field and holding for
 * the system paste menu first.
 *
 * See the `floating` prop's own doc comment for the one field this can't
 * attach to as a real `InputAccessoryView` at all.
 */
export function TitleTokenAccessory({ nativeID, onInsert, onConfirm, confirmVisible, floating, focused }: TitleTokenAccessoryProps) {
  const colors = useColors();
  // Starts true so the button isn't disabled for a frame before the first
  // check resolves; a listener keeps it current while the bar stays mounted
  // (copying something in another app and switching back fires it too).
  const [hasClipboardContent, setHasClipboardContent] = useState(true);
  // Only the floating variant needs its own idea of "how tall is the
  // keyboard right now" — a real InputAccessoryView is laid out by iOS
  // itself and never needs this.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    const check = () => {
      Clipboard.hasStringAsync().then((result) => {
        if (!cancelled) setHasClipboardContent(result);
      });
    };
    check();
    const subscription = Clipboard.addClipboardListener(check);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !floating) return;
    const showSub = Keyboard.addListener('keyboardWillShow', e => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [floating]);

  if (Platform.OS !== 'ios') return null;
  // Nothing to gate visibility on without a native accessory view of our
  // own, so this stands in for "is the keyboard actually up for our field".
  if (floating && (!focused || keyboardHeight <= 0)) return null;

  const handlePaste = async () => {
    // Empty is a no-op rather than inserting nothing visible — same guard
    // useCopyToClipboard uses on the write side, for the same reason: a
    // silently-failed read shouldn't read as "there was nothing to paste".
    const text = await Clipboard.getStringAsync();
    if (text) onInsert(text);
  };

  const styles = makeStyles(colors);
  const bar = (
    <View style={styles.bar}>
      <View style={styles.tokenGroup}>
        {TOKENS.map(({ char, label }) => (
          <PressableScale
            key={char}
            style={styles.tokenBtn}
            haptic
            onPress={() => onInsert(char)}
            accessibilityLabel={`Insert ${label} symbol`}
          >
            <Text style={styles.tokenText}>{char}</Text>
          </PressableScale>
        ))}
        <PressableScale
          style={[styles.tokenBtn, !hasClipboardContent && styles.tokenBtnDisabled]}
          haptic
          disabled={!hasClipboardContent}
          onPress={handlePaste}
          accessibilityLabel="Paste from clipboard"
          accessibilityState={{ disabled: !hasClipboardContent }}
        >
          <Ionicons
            name="clipboard-outline"
            size={iconSize.md}
            color={hasClipboardContent ? colors.text : colors.textTertiary}
          />
        </PressableScale>
      </View>
      {onConfirm && confirmVisible && (
        <PressableScale
          style={styles.confirmBtn}
          haptic
          onPress={onConfirm}
          accessibilityLabel="Confirm suggestion"
        >
          <Ionicons name="checkmark" size={20} color={colors.onAccent} />
        </PressableScale>
      )}
    </View>
  );

  if (floating) {
    return (
      <View style={[styles.floatingWrap, { bottom: keyboardHeight }]}>
        {bar}
      </View>
    );
  }

  return (
    <InputAccessoryView nativeID={nativeID}>
      {bar}
    </InputAccessoryView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Positioned against the screen the same way a real InputAccessoryView
  // sits against the keyboard — `bottom` is set inline to the tracked
  // keyboard height, so this only needs the sides pinned.
  floatingWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    // Rounds to meet the keyboard's own top corners, which sit flush
    // against this bar's bottom edge.
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderCurve: 'continuous',
  },
  tokenGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tokenBtn: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  tokenBtnDisabled: {
    opacity: 0.4,
  },
  tokenText: {
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  confirmBtn: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
});
