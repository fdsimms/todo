import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { subDays } from 'date-fns/subDays';
import type { Leftover } from '../types';
import {
  LEFTOVER_KEEP_DAYS_DEFAULT,
  LEFTOVER_KEEP_DAYS_MAX,
  LEFTOVER_KEEP_DAYS_MIN,
  LEFTOVER_NAME_MAX_LENGTH,
} from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { SafeBlurView } from './SafeBlurView';
import { CountStepper } from './CountStepper';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SheetActionRow } from './SheetActionRow';
import { SegmentedControl } from './SegmentedControl';
import { ScrollEdgeFade } from './ScrollEdgeFade';
import { SheetScrim } from './SheetScrim';
import {
  cleanLeftoverTitle,
  describeLeftover,
  describeOutcome,
  isLiveLeftover,
  keepDaysBetween,
  leftoverContainersFor,
  type LeftoverDestination,
  type LeftoverPart,
  type LeftoverPick,
} from '../utils/leftovers';
import { useScrollEdgeFade } from '../hooks/useScrollEdgeFade';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

/** Kept clear above the sheet so its first row never slides under the status bar. */
const TOP_INSET = 72;

/** How far back "put away" can be nudged from the sheet. */
const PUT_AWAY_CHOICES = [0, 1, 2, 3] as const;

// Short forms for the last two so the four chips stay on one line at 390pt —
// "2 days ago" and "3 days ago" spelled out push the fourth chip onto a second
// row. The spoken label below says the whole thing.
const PUT_AWAY_LABELS: Record<number, string> = {
  0: 'Today',
  1: 'Yesterday',
  2: '2 days',
  3: '3 days',
};

const PUT_AWAY_SPOKEN: Record<number, string> = {
  0: 'today',
  1: 'yesterday',
  2: '2 days ago',
  3: '3 days ago',
};

/**
 * Where it's going, asked once at log time.
 *
 * A closed set of three with exactly one chosen, so it's a `SegmentedControl`
 * rather than the chip row above it — the same rule that keeps "Put away" as
 * chips, read the other way: those are four points on one dial, these are
 * three different places.
 */
const DESTINATIONS: { value: LeftoverDestination; label: string; spoken: string }[] = [
  { value: 'fridge', label: 'Fridge', spoken: 'In the fridge' },
  { value: 'freezer', label: 'Freezer', spoken: 'In the freezer' },
  { value: 'both', label: 'Both', spoken: 'Some in the fridge and some in the freezer' },
];

export interface LeftoverSeed {
  /** Prefills the title — the dish the "Log leftovers" action came from. */
  title?: string;
  recipeId?: string | null;
  sourceEntryId?: string | null;
  /**
   * The dish and its components, when the meal was a composed recipe — see
   * leftoverPartsFor. Two or more turns the title field into a pick list; one
   * or none leaves the sheet exactly as it was.
   */
  parts?: LeftoverPart[];
  /**
   * What the "Keep for" stepper opens on, when the dish has an opinion — see
   * Recipe.leftoverKeepDays. Omitted (a hand-logged container, or a recipe that
   * never said) falls to LEFTOVER_KEEP_DAYS_DEFAULT, which is what every open
   * did before this existed.
   *
   * **The whole meal's number, not the ticked parts'.** The sheet writes one
   * window for everything ticked (they came out of the same oven), so following
   * the ticks would mean a stepper that moves under a finger that has already
   * adjusted it — and the number on screen is exactly what gets stored either
   * way, which is the property worth keeping.
   */
  keepDays?: number;
}

interface Props {
  visible: boolean;
  /**
   * The row being edited, or null to log a new one. Read live from the store by
   * id so the caption follows an edit the sheet just made — same discipline
   * MealEntrySheet's `entry` prop keeps.
   */
  leftover: Leftover | null;
  /** Used only when `leftover` is null. */
  seed?: LeftoverSeed;
  /**
   * Every container the user ticked, all sharing one put-away day and one
   * keep-for window — they came out of the same oven at the same moment. Each
   * still becomes its own row with its own clock, so the mash can be finished
   * off on Thursday and the steak thrown out on Friday.
   *
   * A pick carries its own `frozen`, already multiplied out from the sheet's
   * fridge/freezer/both answer, so a caller only ever writes one row per pick.
   */
  onLog: (picks: LeftoverPick[], storedAt: string, keepDays: number) => void;
  onRename: (title: string) => void;
  onSetStoredAt: (storedAt: string) => void;
  onSetKeepDays: (days: number) => void;
  onFinish: (outcome: 'eaten' | 'tossed') => void;
  /**
   * Into the freezer, or back out. Not an outcome — a frozen container is
   * still live and still plannable (see `Leftover.frozenAt`), so this sits
   * above the two rows that actually close one out.
   */
  onSetFrozen: (frozen: boolean) => void;
  /**
   * Copies this container onto the opposite side of the fridge/freezer line,
   * keeping the original exactly where it is. For a pot logged whole that
   * turns out to be more than one meal's worth — the "Both" log-time answer,
   * arrived at after the fact instead of at the sink.
   */
  onSplit: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Logging a container into the fridge, and everything you can do to one that's
 * already in there.
 *
 * One sheet for both because the fields are identical and the difference is
 * only *when* the write lands: a new leftover is a draft held here until "Log
 * it", an existing one applies every tap immediately, the way MealEntrySheet's
 * move chips do. Splitting them would be two copies of the same two controls.
 *
 * **"Put away" is a chip row of relative days, not a calendar.** A leftover is
 * hours-to-days old by definition — nobody is logging one they made in March —
 * so a date picker would be four taps to say "yesterday", and the arithmetic
 * this feature does is in calendar days from that day anyway.
 *
 * **A composed meal is logged part by part** (#1322): when the seed carries
 * more than one part, the name field is replaced by a tick list of the dish and
 * the components it was actually cooked with, and each tick becomes its own
 * container. The whole dish starts ticked and nothing else does, so a composed
 * recipe still logs in exactly the one tap it did before this existed — the
 * parts are an offer, not a question. The list only appears when there is
 * genuinely something to choose, which is why an uncomposed recipe never sees
 * it and keeps its free-text name (renaming a part afterwards is what reopening
 * the row in the fridge is for).
 */
export function LeftoverSheet({
  visible, leftover, seed, onLog, onRename, onSetStoredAt, onSetKeepDays,
  onFinish, onSetFrozen, onSplit, onReopen, onDelete, onClose,
}: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const fade = useScrollEdgeFade();
  const { height: windowHeight } = useWindowDimensions();

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // The sheet is bottom-anchored, the same edge the keyboard docks to — with
  // nothing accounting for it, an autofocused TextInput (fresh, unseeded
  // "Log a leftover") raises a keyboard that covers the sheet entirely rather
  // than sitting beside it. Same fix TemplateItemQuickAdd's doc comment
  // describes: track the keyboard's own height and slide the sheet up by it.
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      Animated.timing(keyboardOffset, {
        toValue: -(e.endCoordinates?.height ?? 0),
        duration: e.duration ?? animation.duration.normal,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, e => {
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: e.duration ?? animation.duration.normal,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffset]);

  const editing = leftover !== null;
  const live = leftover ? isLiveLeftover(leftover) : true;
  // A container being logged fresh is never frozen — logLeftover writes null,
  // and the freezer is somewhere you move a container that already exists.
  const frozen = !!leftover?.frozenAt;

  const [title, setTitle] = useState('');
  // Only meaningful while logging — an existing row's controls write straight
  // through, so there is no draft to hold.
  const [draftDaysAgo, setDraftDaysAgo] = useState(0);
  const [draftKeepDays, setDraftKeepDays] = useState<number | null>(LEFTOVER_KEEP_DAYS_DEFAULT);
  const [pickedKeys, setPickedKeys] = useState<string[]>([]);
  // Opens on the fridge, which is where most of a week's leftovers go, so the
  // ordinary log still costs the taps it always did.
  const [destination, setDestination] = useState<LeftoverDestination>('fridge');

  const parts = seed?.parts ?? [];
  // One part is not a choice — that's every uncomposed recipe, and every
  // hand-logged container, which keep the plain name field.
  const choosing = !editing && parts.length > 1;

  const storedDaysAgo = leftover ? daysAgoOf(leftover.storedAt) : draftDaysAgo;
  const keepDays = leftover
    ? keepDaysBetween(leftover.storedAt, leftover.keepUntil)
    : (draftKeepDays ?? LEFTOVER_KEEP_DAYS_DEFAULT);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // A fresh open always starts from the row (or the seed) rather than from
    // whatever the last one was left on.
    setTitle(leftover?.title ?? seed?.title ?? '');
    setDraftDaysAgo(0);
    setDraftKeepDays(seed?.keepDays ?? LEFTOVER_KEEP_DAYS_DEFAULT);
    // The whole dish and nothing else, so the composed case costs the same one
    // tap the simple one does. Falls back to the first part for a seed that
    // somehow carries only components.
    setPickedKeys(seed?.parts?.length ? [(seed.parts.find(p => p.whole) ?? seed.parts[0]).key] : []);
    setDestination('fridge');
  }, [visible, leftover?.id]);

  const dismiss = (after?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
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
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 80 || vy > 1.2) dismiss();
        else Animated.spring(translateY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }).start();
      },
    })
  ).current;

  const cleanTitle = cleanLeftoverTitle(title);

  // What "Log it" is about to write: the ticked parts, or the one thing that's
  // been typed, each multiplied out by where it's going. Empty means the button
  // is inert rather than writing nothing.
  const picks: LeftoverPick[] = leftoverContainersFor(
    choosing
      ? parts.filter(p => pickedKeys.includes(p.key))
      : cleanTitle
        ? [{ title: cleanTitle, recipeId: seed?.recipeId ?? null }]
        : [],
    destination
  );

  const togglePart = (key: string) => {
    haptics.tap();
    setPickedKeys(keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]));
  };

  // Writes first, then animates out — the opposite order to MealEntrySheet's
  // destructive actions, which dismiss first so the list doesn't reflow under a
  // sheet that's still on screen. Nothing reflows here (the row this adds is
  // behind the modal), and writing first keeps the caller's handler free of any
  // dependence on state `onClose` has already cleared.
  const commit = () => {
    if (picks.length === 0) return;
    haptics.success();
    onLog(picks, instantDaysAgo(draftDaysAgo), draftKeepDays ?? LEFTOVER_KEEP_DAYS_DEFAULT);
    dismiss();
  };

  // An existing row's title commits on blur/submit rather than on every
  // keystroke: each write re-sorts the whole fridge, and re-sorting under a
  // caret is how a list jumps while you're still typing into it.
  const commitRename = () => {
    const clean = cleanLeftoverTitle(title);
    if (!leftover) return;
    if (!clean || clean === leftover.title) {
      setTitle(leftover.title);
      return;
    }
    onRename(clean);
  };

  /**
   * The one irreversible thing this sheet does, and the only one with no undo
   * behind it — useLeftoverStore keeps no lastAction queue, unlike tasks,
   * groceries and the meal plan. Finishing a container can be reopened and a
   * rename can be retyped; a delete takes the row and its history with it. So
   * it asks, the same way deleting a recipe does, rather than relying on a
   * safety net that isn't there.
   */
  const handleDeleteLeftover = () => {
    haptics.warning();
    confirmDelete({
      title: `Delete ${leftover?.title ?? 'this leftover'}?`,
      message: 'This takes it out of the fridge and out of the history. It can\'t be undone.',
      onConfirm: () => dismiss(onDelete),
    });
  };

  const pickDaysAgo = (days: number) => {
    haptics.tap();
    if (leftover) onSetStoredAt(instantDaysAgo(days));
    else setDraftDaysAgo(days);
  };

  const pickKeepDays = (days: number | null) => {
    const next = days ?? LEFTOVER_KEEP_DAYS_DEFAULT;
    if (leftover) onSetKeepDays(next);
    else setDraftKeepDays(next);
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
          { maxHeight: windowHeight - TOP_INSET },
          { transform: [{ translateY: Animated.add(translateY, keyboardOffset) }] },
        ]}
      >
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>

        {/* The card scrolls, same as MealEntrySheet's and for the same reason:
            the parts list grows with the meal's components and the actions
            below it are conditional, so a composed dish logged from a live row
            is taller than the sheet can be. */}
        <View style={styles.cardWrap}>
        <ScrollView
          style={styles.card}
          contentContainerStyle={styles.cardContent}
          bounces={false}
          showsVerticalScrollIndicator={false}
          {...fade.scrollProps}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerRow}>
            <Text style={styles.heading}>
              {editing ? 'In the fridge' : choosing ? 'Log leftovers' : 'Log a leftover'}
            </Text>
            {!editing && (
              <SheetHeaderButton
                // The count is the only thing saying how many containers this
                // is about to add, since the sheet dismisses before they render.
                label={picks.length > 1 ? `Log ${picks.length}` : 'Log it'}
                onPress={commit}
                disabled={picks.length === 0}
              />
            )}
          </View>

          {choosing ? (
            <>
              <Text style={styles.label}>What's left</Text>
              <Text style={styles.hintBlock}>
                Each one becomes its own container.
              </Text>
              <View style={styles.parts}>
                {parts.map((part, i) => {
                  const on = pickedKeys.includes(part.key);
                  return (
                    <TouchableOpacity
                      key={part.key}
                      style={[styles.partRow, i > 0 && styles.partRowDivided]}
                      onPress={() => togglePart(part.key)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={part.whole ? `${part.title}, the whole dish` : part.title}
                    >
                      <Ionicons
                        name={on ? 'checkmark-circle' : 'ellipse-outline'}
                        size={iconSize.md}
                        color={on ? colors.accent : colors.textSecondary}
                      />
                      <View style={styles.partText}>
                        <Text style={styles.partTitle} numberOfLines={1}>{part.title}</Text>
                        {part.whole && <Text style={styles.partCaption}>The whole dish</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              onBlur={editing ? commitRename : undefined}
              onSubmitEditing={editing ? commitRename : commit}
              placeholder="What's in the container?"
              placeholderTextColor={colors.textTertiary}
              // Only when logging fresh with nothing to start from — a seeded
              // title (from "Log leftovers" on a planned meal) is already a
              // complete answer, not a draft to type over, so the keyboard
              // shouldn't summon itself on top of it.
              autoFocus={!editing && !seed?.title}
              returnKeyType={editing ? 'done' : 'go'}
              maxLength={LEFTOVER_NAME_MAX_LENGTH}
              accessibilityLabel="Leftover name"
            />
          )}

          {editing && leftover && (
            <Text style={styles.caption}>
              {live ? describeLeftover(leftover) : describeOutcome(leftover)}
            </Text>
          )}

          <Text style={styles.label}>Put away</Text>
          <View style={styles.chips}>
            {PUT_AWAY_CHOICES.map(days => {
              const on = storedDaysAgo === days;
              return (
                <TouchableOpacity
                  key={days}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => pickDaysAgo(days)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Put away ${PUT_AWAY_SPOKEN[days]}`}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {PUT_AWAY_LABELS[days]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Older than the chips offer, so the row still reads honestly rather
              than showing four unselected chips and no explanation. */}
          {storedDaysAgo > PUT_AWAY_CHOICES[PUT_AWAY_CHOICES.length - 1] && (
            <Text style={styles.hint}>{`Put away ${storedDaysAgo} days ago`}</Text>
          )}

          {/* Only while logging. An existing container moves between the two
              with the "Put in the freezer" action further down, which is a
              different question — that one restarts a clock that has been
              running, this one says where the container starts. */}
          {!editing && (
            <>
              <Text style={styles.label}>Where it's going</Text>
              <View style={styles.destination}>
                <SegmentedControl
                  options={DESTINATIONS.map(d => ({
                    value: d.value,
                    label: d.label,
                    accessibilityLabel: d.spoken,
                  }))}
                  value={destination}
                  onChange={setDestination}
                  label="Where it's going"
                />
              </View>
              {destination === 'both' && (
                <Text style={styles.hint}>
                  Each one is logged twice, once for the fridge and once for the freezer.
                </Text>
              )}
            </>
          )}

          <View style={styles.keepRow}>
            <View style={styles.keepText}>
              <Text style={styles.keepLabel}>Keep for</Text>
              <Text style={styles.hintInline}>
                {/* A container logged straight into the freezer is asking the
                    same question a frozen row does: the window isn't running
                    yet, it's what it gets when it comes back out. "Both" keeps
                    the fridge wording, because one of the two is counting down
                    from today and that's the half worth naming. */}
                {frozen || (!editing && destination === 'freezer')
                  ? 'How long it keeps once it comes out of the freezer'
                  : 'How long before it should be used or tossed'}
              </Text>
            </View>
            <CountStepper
              value={keepDays}
              onChange={pickKeepDays}
              min={LEFTOVER_KEEP_DAYS_MIN}
              max={LEFTOVER_KEEP_DAYS_MAX}
              format={n => (n === 0 ? 'Today' : `${n}d`)}
              label="Keep for"
              describeValue={n => (n === 0 ? 'Use today' : `${n} days`)}
            />
          </View>

          {editing && live && (
            <>
              <View style={styles.sep} />
              {/* Above freezing because it's the row that makes freezing (or
                  fridging) *half* possible — this container stays whole
                  otherwise. Dismisses, unlike the freeze row below: the copy it
                  writes doesn't change anything this sheet is showing, so
                  there's nothing left here worth a caption to confirm. */}
              <SheetActionRow
                icon="copy-outline"
                color={colors.accent}
                label={frozen ? 'Split into the fridge' : 'Split into the freezer'}
                onPress={() => { haptics.success(); dismiss(() => onSplit()); }}
                accessibilityLabel={
                  frozen
                    ? 'Split this leftover, keeping the original in the freezer and putting a copy in the fridge'
                    : 'Split this leftover, keeping the original in the fridge and putting a copy in the freezer'
                }
              />

              <View style={styles.sep} />
              {/* Above the two closing rows because it isn't one: freezing
                  keeps the container, it doesn't end it. The sheet stays open
                  rather than dismissing, unlike every row below — the state it
                  writes is one the caption right above reports, so closing
                  would hide the only confirmation there is. */}
              <SheetActionRow
                icon={frozen ? 'sunny-outline' : 'snow-outline'}
                color={colors.accent}
                label={frozen ? 'Take out of the freezer' : 'Put in the freezer'}
                onPress={() => { haptics.tap(); onSetFrozen(!frozen); }}
                accessibilityLabel={
                  frozen
                    ? 'Take this leftover out of the freezer, restarting how long it keeps'
                    : 'Put this leftover in the freezer, pausing how long it keeps'
                }
              />

              <View style={styles.sep} />
              <SheetActionRow
                icon="checkmark-circle-outline"
                color={colors.green}
                label="Finished it"
                onPress={() => { haptics.success(); dismiss(() => onFinish('eaten')); }}
                accessibilityLabel="Mark this leftover finished"
              />

              <View style={styles.sep} />
              <SheetActionRow
                icon="trash-bin-outline"
                color={colors.orange}
                label="Threw it out"
                onPress={() => { haptics.warning(); dismiss(() => onFinish('tossed')); }}
                accessibilityLabel="Mark this leftover thrown out"
              />
            </>
          )}

          {editing && !live && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="arrow-undo-outline"
                color={colors.accent}
                label="Back in the fridge"
                onPress={() => { haptics.tap(); dismiss(onReopen); }}
                accessibilityLabel="Put this leftover back in the fridge"
              />
            </>
          )}

          {editing && (
            <>
              <View style={styles.sep} />
              <SheetActionRow
                icon="close-circle-outline"
                color={colors.red}
                destructive
                label="Delete"
                onPress={handleDeleteLeftover}
                accessibilityLabel="Delete this leftover"
              />
            </>
          )}
        </ScrollView>
        <ScrollEdgeFade edge="bottom" opacity={fade.bottomOpacity} color={colors.bgSecondary} />
        </View>

        <TouchableOpacity
          style={styles.cancelCard}
          onPress={() => {
            // Tapping Done can beat the title field's own blur — flush it
            // first instead of dropping whatever was typed.
            if (editing) commitRename();
            dismiss();
          }}
          activeOpacity={interaction.activeOpacity}
        >
          <Text style={styles.cancelLabel}>{editing ? 'Done' : 'Cancel'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

/** Local midday `n` days back — a put-away instant the chips can round-trip. */
function instantDaysAgo(days: number): string {
  const d = subDays(new Date(), days);
  // Midday rather than now-minus-n-days so nudging "yesterday" late at night
  // can't land the instant on a third calendar day once the clock rolls over
  // mid-session. The time is never displayed; only its calendar day is read.
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function daysAgoOf(storedAt: string): number {
  const then = new Date(storedAt);
  then.setHours(12, 0, 0, 0);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((+now - +then) / 86_400_000));
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
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
  // Wraps the scrolling card so the fade can be anchored to its bottom
  // edge. It carries the card's outer layout — the shrink that lets the
  // card give way to the sheet's maxHeight, the gap below it, and the
  // rounded clip the band has to sit inside — because an absolute child
  // is positioned from its parent's border box: left on the card, the
  // band would overhang the corners and the margin below it.
  cardWrap: {
    flexShrink: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    overflow: 'hidden',
    // See MealEntrySheet's: lets the card give way to the sheet's maxHeight
    // rather than taking its content's full height and overflowing it.
    flexShrink: 1,
  },
  cardContent: {
    paddingBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  // No lineHeight — RN maps it onto the iOS paragraph style with no baseline
  // compensation and the glyphs sit low in the box. See CLAUDE.md.
  titleInput: {
    color: colors.text,
    fontSize: font.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    height: 36,
  },
  caption: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  chipTextOn: { color: colors.onAccent },
  hint: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  destination: {
    paddingHorizontal: spacing.md,
  },
  hintBlock: {
    color: colors.textSecondary,
    fontSize: font.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  // A sunken region rather than a second card: these rows sit *inside* the
  // sheet's card, and the enclosure is what ties them together — the same call
  // TaskGroupTray makes about a stack's children.
  parts: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  partRowDivided: {
    borderTopWidth: border.hairline,
    borderTopColor: colors.separator,
  },
  partText: { flex: 1, gap: 1 },
  partTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  partCaption: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  keepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    marginBottom: spacing.md,
  },
  keepText: { flex: 1, gap: 2 },
  keepLabel: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  hintInline: {
    color: colors.textSecondary,
    fontSize: font.xs,
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
  },
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
