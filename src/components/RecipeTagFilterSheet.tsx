import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  PanResponder,
  Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { tagColor } from '../utils/tagColor';
import { toggleRecipeTag } from '../utils/recipeTags';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The whole box's vocabulary, alphabetical — see allRecipeTags. */
  tags: readonly string[];
  /** How many recipes each tag is on — see recipeTagCounts. */
  counts: ReadonlyMap<string, number>;
  selected: readonly string[];
  onChange: (tags: string[]) => void;
}

/**
 * The recipe box's tag filter, in a wrapping bottom sheet rather than the
 * horizontal chip row it started as — the same fix `LogbookFilterSheet` is
 * for the category/tag rows it replaced there. A scrolling row hides every
 * chip past what fits on screen behind a swipe nobody is prompted to make,
 * and a tag box can run past what a phone-width row can even gesture through
 * (a household's grocery aisles alone are north of a dozen; a personal recipe
 * vocabulary — cuisines, diets, occasions, "quick", "make ahead" — gets there
 * fast). Wrapping puts the whole vocabulary on screen at once.
 *
 * Multi-select rather than Logbook's radio-per-group: recipe tags AND
 * together (see filterRecipesByTags), so every chip here is a checkbox, not
 * a single "which one" choice — picking a second doesn't replace the first.
 */
export function RecipeTagFilterSheet({ visible, onClose, tags, counts, selected, onChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(hiddenY);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 10,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 60 || vy > 1) {
          dismiss();
        } else {
          Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.overlay, { opacity: backdropOpacity }]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filter by tag</Text>
            <View style={styles.headerRight}>
              {selected.length > 0 && (
                <TouchableOpacity
                  onPress={() => { haptics.tap(); onChange([]); }}
                  style={styles.resetBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.resetText}>Clear all ({selected.length})</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={styles.chips}>
              {tags.map(tag => {
                const active = selected.includes(tag);
                const color = tagColor(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.chip, active && { backgroundColor: color + '33', borderColor: color }]}
                    onPress={() => { haptics.tap(); onChange(toggleRecipeTag(selected, tag)); }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${tag}, ${counts.get(tag) ?? 0} recipes`}
                  >
                    <View style={[styles.chipDot, { backgroundColor: color }]} />
                    <Text style={[styles.chipText, active && { color }]}>{tag}</Text>
                    <Text style={[styles.chipCount, active && { color }]}>{counts.get(tag) ?? 0}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.backdrop },
  sheet: {
    backgroundColor: colors.bgSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.bgQuaternary },
  handleArea: { paddingVertical: spacing.md, alignItems: 'center' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  sheetTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  resetBtn: {
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
  },
  resetText: { color: colors.accent, fontSize: font.sm },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.bgQuaternary,
    backgroundColor: colors.bgTertiary,
  },
  chipDot: { width: 6, height: 6, borderRadius: radius.full },
  chipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  chipCount: { color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.medium },
});
