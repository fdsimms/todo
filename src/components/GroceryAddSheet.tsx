import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { GroceryAddField, type GroceryAddFieldHandle } from './GroceryAddField';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, animation, type Colors } from '../theme';
import type { GroceryItem } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * The aisle the add button was dropped in, when this opening of the sheet
   * came from a drag. Named in the header only — where the rows actually land
   * is decided by the screen, which knows the seam and not just the section.
   */
  seedAisle?: string | null;
  /** Every add, so a screen that placed this sheet can place what comes out of it. */
  onAdded?: (items: GroceryItem[]) => void;
}

/**
 * The quick-add sheet behind this screen's FAB — same card, entrance spring and
 * backdrop as QuickAddNameSheet, so the corner behaves like every other list
 * screen's.
 *
 * What it does *not* copy is closing on submit. A grocery list is entered in
 * bursts of ten, and a sheet that dismissed itself per item would cost ten
 * presentations for one shop; `GroceryAddField` keeps focus after each add and
 * this sheet stays up until you're done. That's the whole reason this screen
 * used to have a pinned field and no FAB — the burst is preserved here, the
 * divergent chrome isn't.
 *
 * **Nor does it copy the centred resting place, and that's the other
 * divergence with a reason (#1605).** Those sheets hold one field and are the
 * same size the whole time they're up; this one grows a matches list, a row of
 * parsed-token chips and an either/or offer as you type. Centred, half of every
 * one of those appearing pushed the field itself upward — the field moved out
 * from under the cursor at the second or third character of nearly every item.
 * So the card is anchored near the top, `GroceryAddField` hangs everything it
 * reveals below the field out of flow, and between them nothing on screen moves
 * while you type. The keyboard glide went with it: at this height there is no
 * keyboard to get out of the way of, and a card that slid on `keyboardWillShow`
 * was one more thing moving under the same finger.
 */
export function GroceryAddSheet({ visible, onClose, seedAisle, onAdded }: Props) {
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const fieldRef = useRef<GroceryAddFieldHandle>(null);
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const translateYAnim = useRef(new Animated.Value(16)).current;
  const sheetOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [addedCount, setAddedCount] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setAddedCount(0);
    scaleAnim.setValue(0.95);
    translateYAnim.setValue(16);
    sheetOpacity.setValue(0);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start(() => {
      // Focus is deferred until the card has settled so the keyboard's own
      // slide-up doesn't fight the entrance.
      fieldRef.current?.focus();
    });
  }, [visible]);

  const dismiss = () => {
    fieldRef.current?.commitPending();
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 120, useNativeDriver: true }),
      Animated.timing(sheetOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.95);
      sheetOpacity.setValue(0);
      onClose();
    });
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
      <View style={styles.topContainer} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            shadows.sheet,
            {
              opacity: sheetOpacity,
              transform: [{ scale: scaleAnim }, { translateY: translateYAnim }],
            },
          ]}
        >
          <View style={styles.header}>
            {/* The aisle stays in the title for the whole burst, not just the
                first add: every item typed here goes to the same place, and
                that's the one thing a drag said that a tap didn't. */}
            <Text style={styles.title} numberOfLines={1}>
              {addedCount > 0
                ? `Added ${addedCount} ${addedCount === 1 ? 'item' : 'items'}${seedAisle ? ` to ${seedAisle}` : ''}`
                : seedAisle ? `Add to ${seedAisle}` : 'Add to the list'}
            </Text>
            <SheetHeaderButton label="Done" onPress={dismiss} />
          </View>

          <GroceryAddField
            ref={fieldRef}
            onAdded={items => {
              setAddedCount(c => c + items.length);
              onAdded?.(items);
            }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  // Top-anchored, not centred — see the component note. The offset clears the
  // notch on every device the app runs on and leaves the rest of the space to
  // what typing reveals below the field.
  topContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    // Shrinks rather than pushing Done off the card: a custom aisle name can be
    // as long as the user cares to make it.
    flexShrink: 1,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
});
