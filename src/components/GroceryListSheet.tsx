// The shopping-list switcher — one row per list, tap to switch, plus the
// add/rename/delete the away lists need. Opened from the Groceries header
// title; see `GroceryList` in types for what a list is and what "away" costs a
// finished trip.
//
// Rows rather than pills, and no cap, for `CategoryPicker`'s reasons: the set
// is user-built and open-ended, and a name like "Beach house week 2" has to fit
// whole. The shell below is `CategoryPickerSheet`'s, down to the keyboard lift.
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { SafeBlurView } from './SafeBlurView';
import { SheetScrim } from './SheetScrim';
import { InlineAction } from './InlineAction';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';
import { useGroceryStore } from '../store/useGroceryStore';
import { listPickerRows } from '../utils/groceryLists';

/** Kept clear above the lifted sheet so its title never slides under the status bar. */
const TOP_INSET = 72;

/** Rows are 44pt; a little over four of them, so the fifth peeks. */
const LIST_MAX_HEIGHT = 340;

const LIST_NAME_MAX_LENGTH = 40;

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function GroceryListSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: windowHeight } = useWindowDimensions();

  const listEntries = useGroceryStore(useShallow(s => s.listEntries));
  const lists = useGroceryStore(useShallow(s => s.lists));
  const activeListId = useGroceryStore(s => s.activeListId);
  const setActiveList = useGroceryStore(s => s.setActiveList);
  const addList = useGroceryStore(s => s.addList);
  const renameList = useGroceryStore(s => s.renameList);
  const deleteList = useGroceryStore(s => s.deleteList);

  const rows = useMemo(() => listPickerRows(listEntries, lists), [listEntries, lists]);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const hiddenY = useSheetHiddenOffset();
  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const keyboardOffset = useRef(new Animated.Value(0)).current;
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      const height = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(height);
      Animated.spring(keyboardOffset, {
        toValue: -height, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      Animated.spring(keyboardOffset, {
        toValue: 0, ...animation.spring.smooth, useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setNewName('');
    setEditingId(null);
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    const height = Keyboard.metrics()?.height ?? 0;
    setKeyboardHeight(height);
    keyboardOffset.setValue(-height);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const dismiss = (after?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      onClose();
      after?.();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => dy > 4,
      onPanResponderMove: (_, { dy }) => { if (dy > 0) translateY.setValue(dy); },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  const handleAdd = () => {
    const created = addList(newName);
    if (!created) return;
    setNewName('');
    haptics.success();
    // Straight onto the list you just made. Creating one is only ever the first
    // half of "I'm shopping for the Airbnb now", and leaving the screen on the
    // home list would make every new list take two steps.
    dismiss(() => setActiveList(created.id));
  };

  const commitRename = () => {
    if (!editingId) return;
    renameList(editingId, editingName);
    setEditingId(null);
  };

  const handleDelete = (id: string, name: string, count: number) => {
    confirmDelete({
      title: `Delete "${name}"?`,
      message: count > 0
        ? `${count} ${count === 1 ? 'thing' : 'things'} on it will come off the list. Nothing is removed from your catalog.`
        : 'Nothing is removed from your catalog.',
      onConfirm: () => {
        deleteList(id);
        haptics.warning();
      },
    });
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      <SheetScrim onPress={() => dismiss()} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { maxHeight: windowHeight - keyboardHeight - TOP_INSET },
          { transform: [{ translateY: Animated.add(translateY, keyboardOffset) }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sheetTitle}>Shopping lists</Text>
          {/* The one line of documentation this feature has, and it names the
              mechanism rather than the mood: what a second list changes is that
              its shopping stays out of your kitchen's record. */}
          <Text style={styles.sheetHint}>
            Anything you add goes on the list you pick here. Buying things on a list other than
            Groceries doesn't update your pantry, prices or purchase history.
          </Text>

          <ScrollView
            style={{ maxHeight: LIST_MAX_HEIGHT }}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {rows.map(row => {
              const active = row.id === activeListId;
              const editing = row.id !== null && row.id === editingId;
              return (
                <View key={row.id ?? 'home'} style={styles.row}>
                  <Ionicons
                    name={row.away ? 'airplane-outline' : 'home-outline'}
                    size={iconSize.md}
                    color={active ? colors.accent : colors.textTertiary}
                  />

                  {editing ? (
                    <TextInput
                      style={styles.renameInput}
                      value={editingName}
                      onChangeText={setEditingName}
                      onBlur={commitRename}
                      onSubmitEditing={commitRename}
                      autoFocus
                      returnKeyType="done"
                      maxLength={LIST_NAME_MAX_LENGTH}
                      accessibilityLabel={`Rename ${row.name}`}
                    />
                  ) : (
                    <TouchableOpacity
                      style={styles.rowTap}
                      onPress={() => {
                        haptics.tap();
                        dismiss(() => setActiveList(row.id));
                      }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={
                        row.count > 0 ? `${row.name}, ${row.count} on the list` : `${row.name}, empty`
                      }
                    >
                      <Text style={[styles.rowName, active && styles.rowNameActive]} numberOfLines={1}>
                        {row.name}
                      </Text>
                      {row.count > 0 && <Text style={styles.rowCount}>{row.count}</Text>}
                      {active && <Ionicons name="checkmark" size={iconSize.md} color={colors.accent} />}
                    </TouchableOpacity>
                  )}

                  {/* Only an away list can be renamed or deleted. The home list
                      isn't a row in the table (see GroceryList), and a list you
                      can delete your way out of having is one this whole screen
                      would then have nowhere to fall back to. */}
                  {row.id !== null && !editing && (
                    <>
                      <TouchableOpacity
                        onPress={() => { setEditingId(row.id); setEditingName(row.name); }}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${row.name}`}
                      >
                        <Ionicons name="pencil-outline" size={iconSize.sm} color={colors.textTertiary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDelete(row.id!, row.name, row.count)}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${row.name}`}
                      >
                        <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.addWrap}>
            <TextInput
              style={styles.addInput}
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Airbnb"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
              blurOnSubmit={false}
              maxLength={LIST_NAME_MAX_LENGTH}
              accessibilityLabel="New list name"
            />
            <InlineAction
              label="New list"
              icon="add"
              variant="neutral"
              onPress={handleAdd}
              disabled={!newName.trim()}
            />
          </View>
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
    overflow: 'hidden', marginBottom: spacing.sm, flexShrink: 1,
  },
  sheetTitle: {
    color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
  },
  sheetHint: {
    color: colors.textSecondary, fontSize: font.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  listContent: { paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
  rowName: { flex: 1, color: colors.text, fontSize: font.md },
  rowNameActive: { fontWeight: fontWeight.semibold },
  rowCount: { color: colors.textTertiary, fontSize: font.sm, fontWeight: fontWeight.medium },
  renameInput: {
    flex: 1, color: colors.text, fontSize: font.md,
    // A height rather than a lineHeight — RN maps lineHeight onto the iOS
    // paragraph style with no baseline compensation, so the glyphs sit low.
    height: 40,
  },
  addWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md,
  },
  addInput: {
    flex: 1, color: colors.text, fontSize: font.md, height: 40,
    backgroundColor: colors.bgTertiary, borderRadius: radius.md, paddingHorizontal: spacing.sm,
  },
  cancelCard: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.lg,
    paddingVertical: 18, alignItems: 'center',
  },
  cancelLabel: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
});
