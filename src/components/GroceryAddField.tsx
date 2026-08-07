import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import {
  spacing,
  font,
  fontWeight,
  radius,
  border,
  iconSize,
  interaction,
  type Colors,
} from '../theme';
import { useGroceryStore } from '../store/useGroceryStore';
import { rankGrocerySuggestions } from '../utils/grocerySuggest';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { GROCERY_NAME_MAX_LENGTH } from '../types';

interface Props {
  /** Fired after anything is added, so the screen can scroll or flash a row. */
  onAdded?: (count: number) => void;
}

/**
 * The pinned "what do you need" field.
 *
 * Pinned at the top with no FAB, which is the one place this screen diverges
 * hard from every other list screen here. A grocery list is entered in bursts
 * of ten; the FAB → QuickAddNameSheet pattern would cost ten modal
 * presentations. Top rather than bottom so the keyboard never covers it and it
 * needn't fight the tab bar height. The FAB's job moved into the header
 * actions instead.
 *
 * Behaviour is the chain-step input from QuickAddModal, verbatim: submit adds
 * and *keeps focus* (blurOnSubmit={false}), so the next item is one keystroke
 * away rather than one tap.
 */
export function GroceryAddField({ onAdded }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);

  const items = useGroceryStore(s => s.items);
  const addByName = useGroceryStore(s => s.addByName);
  const addManyFromText = useGroceryStore(s => s.addManyFromText);

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const suggestions = useMemo(
    () => (focused ? rankGrocerySuggestions(text, items, new Date()) : []),
    [focused, text, items]
  );

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      animateLayout();
      addByName(trimmed);
      haptics.tap();
      setText('');
      setStatus(null);
      onAdded?.(1);
    },
    [addByName, onAdded]
  );

  /**
   * Multi-line paste, without making this a multiline input.
   *
   * `multiline` would break onSubmitEditing — the return key would insert a
   * newline instead of adding the item, which is the whole interaction. So a
   * paste is detected here instead: anything arriving with a newline in it is
   * a block, not typing, and goes straight through splitGroceryLines.
   */
  const handleChange = useCallback(
    (next: string) => {
      if (!next.includes('\n')) {
        setText(next);
        if (status) setStatus(null);
        return;
      }

      animateLayout();
      const { added, alreadyOnList } = addManyFromText(next);
      const total = added.length + alreadyOnList.length;
      if (total === 0) {
        setText('');
        return;
      }

      haptics.success();
      setText('');
      setStatus(
        alreadyOnList.length > 0
          ? `Added ${added.length} · ${alreadyOnList.length} already on the list`
          : `Added ${added.length}`
      );
      onAdded?.(total);
    },
    [addManyFromText, onAdded, status]
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <Ionicons name="add" size={iconSize.md} color={colors.textTertiary} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Add an item"
          placeholderTextColor={colors.textTertiary}
          returnKeyType="done"
          onSubmitEditing={() => commit(text)}
          // The whole point: focus survives the submit, so ten items is ten
          // keystrokes-and-return rather than ten taps into a sheet.
          blurOnSubmit={false}
          // iOS inline prediction draws over the field and fights the
          // suggestion list underneath it.
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={GROCERY_NAME_MAX_LENGTH}
          accessibilityLabel="Add a grocery item"
        />
        {!!text && (
          <TouchableOpacity
            onPress={() => setText('')}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Clear input"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {!!status && <Text style={styles.status}>{status}</Text>}

      {suggestions.length > 0 && (
        // Absolutely positioned so the list underneath never jumps as you
        // type — a section list that reflows under a dropping suggestion list
        // is how you tap the wrong row.
        <View style={styles.overlay}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.overlayScroll}>
            {suggestions.map(({ item, onList }) => (
              <TouchableOpacity
                key={item.id}
                style={styles.suggestion}
                activeOpacity={interaction.activeOpacity}
                onPress={() => commit(item.name)}
                accessibilityRole="button"
                accessibilityLabel={`Add ${item.name}${onList ? ', already on the list' : ''}`}
              >
                <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.suggestionAisle} numberOfLines={1}>{item.aisle}</Text>
                {onList && (
                  <View style={styles.onListPill}>
                    <Text style={styles.onListText}>On list</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      // The suggestion overlay is a child, and it has to paint over the list.
      zIndex: 10,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      borderWidth: border.sm,
      borderColor: 'transparent',
      paddingHorizontal: spacing.md,
    },
    fieldFocused: {
      borderColor: colors.accent,
    },
    input: {
      flex: 1,
      fontSize: font.lg,
      color: colors.text,
      // Never lineHeight on a TextInput: RN maps it onto the iOS paragraph
      // style with no baseline compensation, so the glyphs sit low in the box
      // while the caret stays centred. A fixed height is the way to pin the
      // row height instead.
      height: 48,
      padding: 0,
    },
    status: {
      fontSize: font.sm,
      color: colors.textSecondary,
      marginTop: spacing.xs,
      marginLeft: spacing.xs,
    },
    overlay: {
      position: 'absolute',
      top: '100%',
      left: spacing.md,
      right: spacing.md,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      overflow: 'hidden',
      marginTop: spacing.xs,
    },
    overlayScroll: {
      maxHeight: 220,
    },
    suggestion: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 12,
      paddingHorizontal: spacing.md,
      borderBottomWidth: border.thin,
      borderBottomColor: colors.separator,
    },
    suggestionName: {
      flex: 1,
      fontSize: font.md,
      fontWeight: fontWeight.medium,
      color: colors.text,
    },
    suggestionAisle: {
      fontSize: font.xs,
      color: colors.textTertiary,
    },
    onListPill: {
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    onListText: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.accent,
    },
  });
}
