import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeBlurView } from './SafeBlurView';
import { HighlightedText } from './HighlightedText';
import { SearchField } from './SearchField';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, type Colors } from '../theme';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { quickSearch } from '../utils/quickSearch';
import { haptics } from '../utils/haptics';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Tapping a result. The caller decides where it opens (Today opens the editor). */
  onSelectTask: (task: Task) => void;
  /** The footer row — hands the query over to the Search tab rather than growing this card. */
  onOpenFullSearch: (query: string) => void;
}

/**
 * The pull-down quick search: a small card over a dimmed screen, holding a
 * field and at most five one-line results.
 *
 * Deliberately a *narrower* thing than the Search tab rather than a smaller
 * copy of it. The Search screen's rows carry tags, due dates and a notes
 * preview and split into Active/Completed sections; this carries none of
 * that. Anything the cap can't answer goes to the footer row, which is why
 * there's no scrolling here — a card you have to scroll isn't quick.
 */
export function QuickSearchModal({ visible, onClose, onSelectTask, onOpenFullSearch }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isDark, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);

  const tasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(s => s.projects);

  const [query, setQuery] = useState('');

  const scaleAnim = useRef(new Animated.Value(0.94)).current;
  // Enters from *above* its resting place, unlike QuickAddModal — the card is
  // answering a downward pull, so it should arrive travelling the same way.
  const translateYAnim = useRef(new Animated.Value(-20)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const projectNamesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects]
  );

  const { results, overflow } = useMemo(
    () => quickSearch(tasks, query, projectNamesById),
    [tasks, query, projectNamesById]
  );

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    scaleAnim.setValue(0.94);
    translateYAnim.setValue(-20);
    cardOpacity.setValue(0);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.spring(translateYAnim, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start(() => {
      // Focus after the card settles so its spring and the keyboard's own
      // slide-up don't overlap — same reasoning as QuickAddModal.
      inputRef.current?.focus();
    });
  }, [visible]);

  const dismiss = (then?: () => void) => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 0.94, duration: 120, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      scaleAnim.setValue(0.94);
      cardOpacity.setValue(0);
      onClose();
      then?.();
    });
  };

  const handleSelect = (task: Task) => {
    haptics.tap();
    dismiss(() => onSelectTask(task));
  };

  const handleOpenFull = () => {
    haptics.tap();
    const handoff = query;
    dismiss(() => onOpenFullSearch(handoff));
  };

  const trimmed = query.trim();
  const showNoMatches = trimmed.length > 0 && results.length === 0;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={() => dismiss()}
        accessibilityRole="button"
        accessibilityLabel="Close quick search"
      />

      <View style={[styles.topContainer, { paddingTop: insets.top + spacing.md }]} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            shadows.sheet,
            { opacity: cardOpacity, transform: [{ scale: scaleAnim }, { translateY: translateYAnim }] },
          ]}
        >
          <SearchField
            ref={inputRef}
            surface="sunken"
            placeholder="Search todos…"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleOpenFull}
          />

          {results.length > 0 && (
            <View style={styles.results}>
              {results.map(({ task, titleMatches }) => (
                <TouchableOpacity
                  key={task.id}
                  style={styles.resultRow}
                  onPress={() => handleSelect(task)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={[
                    task.title,
                    task.archived ? 'archived' : null,
                    task.completed ? 'completed' : null,
                  ].filter(Boolean).join(', ')}
                  accessibilityHint="Double tap to open task"
                >
                  {task.completed
                    ? <Ionicons name="checkmark-circle" size={20} color={colors.green} />
                    : <View style={styles.circle} />
                  }
                  <HighlightedText
                    text={task.title}
                    ranges={titleMatches}
                    style={[styles.resultTitle, task.completed && styles.resultTitleDone]}
                    highlightStyle={styles.highlight}
                    numberOfLines={1}
                  />
                  {task.archived && <Text style={styles.archivedLabel}>Archived</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {showNoMatches && (
            <Text style={styles.noMatches}>No todos match “{trimmed}”</Text>
          )}

          <TouchableOpacity
            style={styles.footer}
            onPress={handleOpenFull}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={
              overflow > 0
                ? `Open in Search, ${overflow} more ${overflow === 1 ? 'match' : 'matches'}`
                : 'Open in Search'
            }
          >
            <Text style={styles.footerText}>Open in Search</Text>
            <View style={styles.footerRight}>
              {overflow > 0 && <Text style={styles.footerCount}>{overflow} more</Text>}
              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },

  topContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: 20,
    padding: spacing.sm,
  },

  results: { marginTop: spacing.xs },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.bgQuaternary,
  },
  resultTitle: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
  },
  resultTitleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  highlight: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
  archivedLabel: {
    color: colors.orange,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
  },

  noMatches: {
    color: colors.textTertiary,
    fontSize: font.sm,
    paddingVertical: 12,
    paddingHorizontal: spacing.xs,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingTop: 10,
    paddingHorizontal: spacing.xs,
    borderTopWidth: border.hairline,
    borderTopColor: colors.separator,
  },
  footerText: {
    color: colors.accent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  footerCount: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
});
