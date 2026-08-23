import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Animated,
  PanResponder,
  FlatList,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeBlurView } from './SafeBlurView';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, animation, interaction, type Colors } from '../theme';
import { patchNotes } from '../utils/patchNotes';
import { useSettingsStore, type PatchNoteQaStatus } from '../store/useSettingsStore';
import { haptics } from '../utils/haptics';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const NOTES_MAX_HEIGHT = SCREEN_HEIGHT * 0.7;

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return format(parseISO(iso), 'MMM d');
  } catch {
    return '';
  }
}

export function PatchNotesModal({ visible, onDismiss }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const patchNotesQaStatus = useSettingsStore(s => s.patchNotesQaStatus);
  const setPatchNoteQaStatus = useSettingsStore(s => s.setPatchNoteQaStatus);
  const [hideReviewed, setHideReviewed] = useState(false);

  const toggleQaStatus = (id: string, status: PatchNoteQaStatus) => {
    haptics.tap();
    setPatchNoteQaStatus(id, patchNotesQaStatus[id] === status ? null : status);
  };

  const toggleHideReviewed = () => {
    haptics.tap();
    setHideReviewed(prev => !prev);
  };

  const visibleNotes = useMemo(
    () => (hideReviewed ? patchNotes.filter(note => !patchNotesQaStatus[note.id]) : patchNotes),
    [hideReviewed, patchNotesQaStatus]
  );

  const renderNote = useCallback(({ item: note }: { item: (typeof patchNotes)[number] }) => {
    const qaStatus = patchNotesQaStatus[note.id];
    return (
      <View style={styles.noteRow}>
        <View style={styles.noteTextCol}>
          <Text style={styles.noteMessage}>{note.message}</Text>
          {!!note.date && <Text style={styles.noteDate}>{formatDate(note.date)}</Text>}
        </View>
        <View style={styles.qaButtons}>
          <TouchableOpacity
            style={styles.qaButton}
            activeOpacity={interaction.activeOpacity}
            onPress={() => toggleQaStatus(note.id, 'pass')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="checkbox"
            accessibilityLabel={`Mark "${note.message}" as passed`}
            accessibilityState={{ checked: qaStatus === 'pass' }}
          >
            <Ionicons
              name={qaStatus === 'pass' ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={22}
              color={qaStatus === 'pass' ? colors.green : colors.textTertiary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.qaButton}
            activeOpacity={interaction.activeOpacity}
            onPress={() => toggleQaStatus(note.id, 'fail')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="checkbox"
            accessibilityLabel={`Mark "${note.message}" as failed`}
            accessibilityState={{ checked: qaStatus === 'fail' }}
          >
            <Ionicons
              name={qaStatus === 'fail' ? 'close-circle' : 'close-circle-outline'}
              size={22}
              color={qaStatus === 'fail' ? colors.red : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [patchNotesQaStatus, colors, styles]);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      translateY.setValue(hiddenY);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          ...animation.spring.smooth,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: hiddenY,
        ...animation.spring.sheetDismiss,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onDismiss();
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
          Animated.spring(translateY, {
            toValue: 0,
            ...animation.spring.snappy,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={dismiss}
    >
      <View style={styles.container}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
          <SafeBlurView
            intensity={isDark ? 20 : 15}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
        </Animated.View>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={dismiss} />

        <Animated.View style={[styles.sheetOuter, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.card}>
            <View style={styles.titleRow}>
              <Ionicons name="gift-outline" size={20} color={colors.accent} />
              <Text style={styles.title}>What's New</Text>
              <View style={styles.titleSpacer} />
              <TouchableOpacity
                style={styles.hideReviewedButton}
                activeOpacity={interaction.activeOpacity}
                onPress={toggleHideReviewed}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="switch"
                accessibilityLabel="Hide reviewed entries"
                accessibilityState={{ checked: hideReviewed }}
              >
                <Ionicons
                  name={hideReviewed ? 'eye-off' : 'eye-off-outline'}
                  size={20}
                  color={hideReviewed ? colors.accent : colors.textTertiary}
                />
              </TouchableOpacity>
            </View>

            <FlatList
              style={styles.notesScroll}
              data={visibleNotes}
              keyExtractor={note => note.id}
              renderItem={renderNote}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              showsVerticalScrollIndicator={false}
              bounces={false}
              windowSize={7}
              maxToRenderPerBatch={16}
              initialNumToRender={16}
              removeClippedSubviews
              ListEmptyComponent={<Text style={styles.emptyText}>All caught up. Nothing left to review.</Text>}
            />
          </View>

          <TouchableOpacity style={styles.doneCard} onPress={dismiss} activeOpacity={interaction.activeOpacity}>
            <Text style={styles.doneLabel}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropDim: {
    backgroundColor: colors.backdrop,
  },
  sheetOuter: {
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  titleSpacer: {
    flex: 1,
  },
  hideReviewedButton: {
    padding: 2,
  },
  notesScroll: {
    maxHeight: NOTES_MAX_HEIGHT,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: font.md,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: spacing.sm,
  },
  noteTextCol: {
    flex: 1,
    gap: 2,
  },
  noteMessage: {
    color: colors.text,
    fontSize: font.md,
    lineHeight: lineHeight.md,
  },
  noteDate: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  qaButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  qaButton: {
    padding: 2,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  doneCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
  },
  doneLabel: {
    color: colors.accent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
});
