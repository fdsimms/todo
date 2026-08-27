import React, { useRef, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import { SheetScrim } from './SheetScrim';
import { EmptyState } from './EmptyState';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useShallow } from 'zustand/react/shallow';
import { useRecipeStore } from '../store/useRecipeStore';
import type { Cookbook } from '../types';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  /** The book staying on the shelf — left out of the list, since a book can't absorb itself. */
  survivorId: string;
  onClose: () => void;
  /** Called with the book to fold in, after the sheet has slid away. */
  onSelect: (loser: Cookbook) => void;
}

/**
 * "These are the same book" — step one of merging, picking which other book
 * on the shelf folds into the one already being edited. `CookbookEditor` owns
 * the confirm and the `mergeCookbooks` call; this only picks a target,
 * alphabetical like the shelf itself.
 */
export function CookbookMergeSheet({ visible, survivorId, onClose, onSelect }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cookbooks = useRecipeStore(useShallow(s => s.cookbooks));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const candidates = useMemo(
    () => cookbooks.filter(c => c.id !== survivorId).sort((a, b) => a.title.localeCompare(b.title)),
    [cookbooks, survivorId]
  );
  const recipeCountOf = (id: string) => recipes.filter(r => r.cookbookId === id).length;

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
  }, [visible, hiddenY, translateY, backdropOpacity]);

  const dismiss = (after?: () => void) => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
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
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  const handleSelect = (cookbook: Cookbook) => {
    haptics.tap();
    dismiss(() => onSelect(cookbook));
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={() => dismiss()} />

      <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>Merge another book in</Text>

          {candidates.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="library-outline"
                title="Nothing else to merge"
                subtitle="Every other book already has a different title and author"
              />
            </View>
          ) : (
            <ScrollView style={styles.list} bounces={false}>
              {candidates.map(cookbook => {
                const count = recipeCountOf(cookbook.id);
                const countLabel = `${count} ${count === 1 ? 'recipe' : 'recipes'}`;
                return (
                  <TouchableOpacity
                    key={cookbook.id}
                    style={styles.row}
                    onPress={() => handleSelect(cookbook)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${cookbook.title}${cookbook.author ? `, by ${cookbook.author}` : ''}. ${countLabel}`}
                  >
                    <View style={styles.rowIcon}>
                      <Ionicons name="library" size={16} color={colors.accent} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName} numberOfLines={1}>{cookbook.title}</Text>
                      <Text style={styles.rowHint} numberOfLines={1}>
                        {cookbook.author ? `${cookbook.author} · ` : ''}{countLabel}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        <TouchableOpacity style={styles.cancelCard} onPress={() => dismiss()} activeOpacity={interaction.activeOpacity}>
          <Text style={styles.cancelLabel}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  emptyWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  backdropDim: {
    backgroundColor: colors.backdrop,
  },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgQuaternary,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  list: {
    maxHeight: 380,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowHint: { color: colors.textTertiary, fontSize: font.xs },
  cancelCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
