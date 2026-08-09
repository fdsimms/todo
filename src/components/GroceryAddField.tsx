import React, { useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
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
import { resolveGroceryTokens } from '../utils/groceryParse';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { GROCERY_NAME_MAX_LENGTH, type GroceryItem } from '../types';

interface Props {
  /**
   * Fired after anything is added, with the rows it put on the list in the
   * order they were typed — the sheet counts them, and the screen places them
   * when the sheet was opened by dropping the add button somewhere.
   */
  onAdded?: (items: GroceryItem[]) => void;
}

/** Lets the sheet focus the field once its entrance animation has settled. */
export interface GroceryAddFieldHandle {
  focus: () => void;
}

/**
 * The "what do you need" field, shown inside `GroceryAddSheet` behind the FAB.
 *
 * A grocery list is entered in bursts of ten, which is why this is a field and
 * not a name sheet that closes on every add: submit adds and *keeps focus*
 * (blurOnSubmit={false}), so ten items is ten keystrokes-and-return inside one
 * presentation rather than ten. That's the behaviour the pinned-at-the-top
 * version existed to protect, and it survives the move to the FAB intact — the
 * sheet stays open until you dismiss it.
 *
 * Behaviour is otherwise the chain-step input from QuickAddModal, verbatim.
 */
export const GroceryAddField = forwardRef<GroceryAddFieldHandle, Props>(function GroceryAddField(
  { onAdded },
  ref
) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const items = useGroceryStore(s => s.items);
  const addByName = useGroceryStore(s => s.addByName);
  const addManyFromText = useGroceryStore(s => s.addManyFromText);

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Named by the exact parsed text they dismissed, not a plain on/off flag —
  // see resolveGroceryTokens for why that's what makes a rejection survive
  // continued typing without needing an effect to reconcile it.
  const [rejectedQuantity, setRejectedQuantity] = useState<string | null>(null);
  const [rejectedPrep, setRejectedPrep] = useState<string | null>(null);

  const suggestions = useMemo(
    () => (focused ? rankGrocerySuggestions(text, items, new Date()) : []),
    [focused, text, items]
  );

  // What committing `text` right now would actually save — the whole point is
  // showing this *before* the tap, not after, so the split is a visible
  // decision rather than something the parser did behind your back.
  const tokens = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    return resolveGroceryTokens(trimmed, { quantity: rejectedQuantity, prep: rejectedPrep });
  }, [text, rejectedQuantity, rejectedPrep]);

  const commit = useCallback(
    (raw: string, override?: { name: string; quantity: string | null }) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      animateLayout();
      const item = addByName(trimmed, override);
      haptics.tap();
      setText('');
      setStatus(null);
      setRejectedQuantity(null);
      setRejectedPrep(null);
      onAdded?.([item]);
    },
    [addByName, onAdded]
  );

  const submit = useCallback(() => {
    if (!tokens) return;
    commit(text, { name: tokens.name, quantity: tokens.quantity });
  }, [tokens, text, commit]);

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
      // Only the part the caller can't already see. The sheet header counts
      // what was added; what it can't say is that some of the paste was
      // already on the list, which is why those lines didn't become rows.
      setStatus(
        alreadyOnList.length > 0
          ? `${alreadyOnList.length} already on the list`
          : null
      );
      onAdded?.(added);
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
          onSubmitEditing={submit}
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
            onPress={() => {
              setText('');
              setRejectedQuantity(null);
              setRejectedPrep(null);
            }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Clear input"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={iconSize.md} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Live preview of the split commit would produce, so it's a visible
          decision rather than something the parser did silently. Each token
          it pulled out of the text gets its own chip; tapping × keeps that
          exact piece in the name instead — see resolveGroceryTokens. */}
      {!!tokens && (tokens.quantityAccepted || tokens.prepAccepted) && (
        <View style={styles.tokenRow}>
          <View style={styles.tokenChips}>
            {tokens.quantityAccepted && (
              <View style={styles.tokenChip}>
                <Text style={styles.tokenChipText}>{tokens.quantity}</Text>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setRejectedQuantity(tokens.quantity); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Keep "${tokens.quantity}" in the name instead of the quantity`}
                >
                  <Ionicons name="close" size={11} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
            {tokens.prepAccepted && (
              <View style={styles.tokenChip}>
                <Text style={styles.tokenChipText}>{tokens.prep}</Text>
                <TouchableOpacity
                  onPress={() => { haptics.tap(); setRejectedPrep(tokens.prep); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Keep "${tokens.prep}" in the name instead of splitting it out`}
                >
                  <Ionicons name="close" size={11} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          <Text style={styles.tokenPreview} numberOfLines={1}>
            Adding “{tokens.name}”
          </Text>
        </View>
      )}

      {!!status && <Text style={styles.status}>{status}</Text>}

      {suggestions.length > 0 && (
        // In flow rather than absolutely positioned: inside the sheet there is
        // no list underneath to reflow, and the card growing downwards is the
        // thing that reads as "here are the matches". The pinned version had to
        // float this over the aisles to stop them jumping as you typed.
        <View style={styles.matches}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.matchesScroll}>
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
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.xs,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      // Tertiary, not secondary: the sheet card behind it is already secondary,
      // and a field the same colour as its card is a field you can't see.
      backgroundColor: colors.bgTertiary,
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
      marginLeft: spacing.xs,
    },
    tokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginLeft: spacing.xs,
    },
    tokenChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    tokenChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.full,
      paddingLeft: spacing.sm,
      paddingRight: 6,
      paddingVertical: 3,
    },
    tokenChipText: {
      fontSize: font.xs,
      fontWeight: fontWeight.medium,
      color: colors.accent,
    },
    tokenPreview: {
      flex: 1,
      fontSize: font.xs,
      color: colors.textTertiary,
    },
    matches: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.md,
      overflow: 'hidden',
    },
    matchesScroll: {
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
