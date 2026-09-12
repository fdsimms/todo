import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { border, font, fontWeight, radius, spacing, type Colors } from '../theme';
import { NUTRIENT_KEYS, type FoodNutrition, type NutrientKey } from '../types';
import { NUTRIENT_LABEL, NUTRITION_BASIS_LABEL } from '../utils/foodNutrition';
import {
  applyFoodNutrition,
  applyLabelReading,
  buildPanelNutrition,
  foodNutritionFieldCount,
  invalidPanelFields,
  labelColumnFieldCount,
  panelFormDirty,
  panelFormFrom,
  type PanelFieldKey,
  type PanelForm,
} from '../utils/nutritionPanelForm';
import { canReadTextOnDevice } from '../utils/receiptOcr';
import { readLabelPhoto, type LabelReading } from '../utils/labelOcr';
import { pickRecipePhoto } from '../utils/recipePhoto';
import {
  describeAIError, nutritionLabelPhotoAiAvailable, readLabelPhotoWithAi,
} from '../services/aiSuggestions';
import { haptics } from '../utils/haptics';
import { InlineAction } from './InlineAction';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { NutritionBarcodeScanSheet } from './NutritionBarcodeScanSheet';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';

/**
 * Typing in a label panel by hand, for the food no database has.
 *
 * **This is what makes the rest of the feature safe to ship.** Barcode lookup
 * and FoodData Central between them miss store brands, deli counters, bakeries,
 * food from another country, and every packet whose barcode scans to nothing.
 * Those foods would otherwise be permanently un-loggable.
 *
 * **The layout follows the label, because that is what somebody is copying
 * from.** Serving size and weight first, since they apply whichever basis is
 * picked, then calories, then the rest in the order a panel prints them
 * (`NUTRIENT_KEYS`). Reading down the packet and down the screen should be
 * the same movement.
 *
 * **The basis selector sits at the bottom of the SERVING card, immediately
 * above NUTRIENTS, not at the top.** It answers "what basis are the figures
 * below in", and it used to sit directly above Serving weight instead — which
 * reads as if it scopes that field too, since a form control and the field
 * right under it look like the control's own target. `servingGrams` is
 * unrelated to `basis` (see that field's own doc comment in `types/index.ts`)
 * and applies to a per-100g panel exactly as much as a per-serving one, so it
 * comes first and the selector sits right against the section it actually
 * governs.
 *
 * **Every field is blank by default and stays blank if nothing is typed.** A
 * placeholder of "0" would read as a value already saved and would quietly
 * destroy the record's one load-bearing distinction: a blank field is "the
 * label didn't say", a typed 0 is "the label said zero". The placeholders start
 * with "e.g." for the same reason the copy rule in CLAUDE.md says so, and are
 * examples for that specific nutrient rather than a repeated stand-in.
 *
 * **A field it can't read blocks the save rather than being dropped.** The
 * alternative stores a panel the person believes has a figure in it and
 * doesn't. See `readPanelNumber`.
 *
 * **Nothing is written until Save, so the swipe-down is guarded.** Ten typed
 * fields behind a `pageSheet` is exactly the silent-data-loss case CLAUDE.md
 * documents, and the iOS pull-down calls `onRequestClose` rather than Cancel.
 *
 * **The packet can fill the form in, and that changes nothing about the save.**
 * "Read from a photo" hands a photograph of the panel to `labelOcr.ts` and lays
 * what it read into these same fields, where the person checks it against the
 * packet still in their hand and commits it with the Save that was already
 * here. That is what makes an imperfect read acceptable: there is no path from
 * a photograph to a stored figure that does not pass through a person looking
 * at it. The button is absent rather than disabled where Vision cannot run,
 * since there is no second opinion to offer and a control that would only ever
 * refuse is worse than no control.
 *
 * **A panel Vision can't transcribe — a curved tub, a steep angle, glare on
 * the wrap — gets one more try from Claude**, when a key is configured for
 * `nutritionLabelPhoto` (`aiSuggestions.ts`'s `readLabelPhotoWithAi`). Same
 * photo, same fields, same person checking the result before Save; the two
 * paths differ only in who read the panel. Attempted only when there's a key
 * to spend it on, so "the photo didn't read" stays the whole story for
 * everyone who hasn't set one up — a real failure on the fallback itself
 * (a timeout, a rate limit) gets its own message rather than being folded
 * into that one.
 *
 * **A barcode can fill the form in too, and that changes nothing about the
 * save either.** "Scan a barcode" hands a decoded GTIN to
 * `NutritionBarcodeScanSheet`, which asks the same barcode databases
 * `BarcodeScanSheet` does and lays whatever nutrition they had into these same
 * fields via `applyFoodNutrition` — the camera-scanned sibling of
 * `applyLabelReading`. Same review, same Save; only the source of the numbers
 * differs.
 */

interface Props {
  visible: boolean;
  /** What this food is called, for the header. */
  foodName: string;
  /** The panel being corrected, or null to type a new one. */
  nutrition: FoodNutrition | null;
  onClose: () => void;
  /** Called with the typed panel, or null when every figure was cleared. */
  onSave: (nutrition: FoodNutrition | null) => void;
}

const BASIS_OPTIONS = (['per100g', 'per100ml', 'perServing'] as const).map(value => ({
  value,
  label: NUTRITION_BASIS_LABEL[value],
}));

/**
 * A plausible figure for each nutrient, so the example reads as an example.
 *
 * One number per field rather than a repeated "e.g. 0": a greyed 0 in ten boxes
 * is indistinguishable from ten saved zeroes at a glance, which is the exact
 * confusion this form exists to avoid. These are roughly a slice of bread,
 * which is a food most people can sanity-check against.
 */
const PLACEHOLDER: Record<NutrientKey, string> = {
  calorieKcal: 'e.g. 265',
  fatG: 'e.g. 3.2',
  satFatG: 'e.g. 0.6',
  carbsG: 'e.g. 49',
  fiberG: 'e.g. 2.7',
  sugarG: 'e.g. 5',
  proteinG: 'e.g. 9',
  sodiumMg: 'e.g. 490',
  caffeineMg: 'e.g. 0',
  waterMl: 'e.g. 36',
};

/** What an unlabelled column is called, by position. A panel never prints more. */
const COLUMN_ORDINAL = ['First column', 'Second column', 'Third column'];

export function NutritionPanelSheet({ visible, foodName, nutrition, onClose, onSave }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // The hook rather than KeyboardAvoidingView, which this file's own header
  // comment already cited the rule for: a pageSheet with inputs inside its
  // ScrollView wants the inset, and the two approaches fight.
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const [form, setForm] = useState<PanelForm>(() => panelFormFrom(nutrition));
  // What the sheet opened saying, so the discard guard compares against the
  // panel as it was rather than against a blank form.
  const baseline = useRef<PanelForm>(panelFormFrom(nutrition));
  // Computed on a save attempt rather than as you type: a half-typed "2." is
  // not yet an error, and flagging it mid-keystroke would flicker red.
  const [bad, setBad] = useState<readonly PanelFieldKey[]>([]);
  const [reading, setReading] = useState(false);
  // Why the last photograph produced nothing, when it produced nothing. A
  // successful read says so through the column row below instead.
  const [photoError, setPhotoError] = useState<string | null>(null);
  // The last successful read, kept so the person can move between a panel's
  // columns and watch the fields follow. Cleared on reopen with everything
  // else: a column control about a packet photographed yesterday is worse
  // than none.
  const [label, setLabel] = useState<LabelReading | null>(null);
  const [column, setColumn] = useState(0);
  // Resolved once rather than per render: whether Vision is linked cannot
  // change while the app is running. See `canReadTextOnDevice`.
  const canPhotograph = useMemo(() => canReadTextOnDevice(), []);
  // Whether the barcode camera sheet is open, and what its last successful
  // scan found — cleared alongside the photo's own `label` on reopen, and by
  // whichever of the two runs next, so only the most recent source's note is
  // ever on screen.
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const opened = panelFormFrom(nutrition);
    setForm(opened);
    baseline.current = opened;
    setBad([]);
    setPhotoError(null);
    setLabel(null);
    setColumn(0);
    setReading(false);
    setScanning(false);
    setScanNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handlePhoto = useCallback(async (source: 'camera' | 'library') => {
    const picked = await pickRecipePhoto(source);
    if (picked.status === 'canceled') return;
    if (picked.status === 'denied') {
      Alert.alert(
        source === 'camera' ? 'Camera access is off' : 'Photo access is off',
        'Turn it on in Settings to read a label from a photo. You can always type the figures in by hand.',
      );
      return;
    }
    if (picked.status === 'failed') {
      setPhotoError(picked.message);
      return;
    }

    setReading(true);
    setPhotoError(null);
    try {
      // The full-resolution copy, not the downscaled one: Vision reads a local
      // file for free and a nutrition panel is set in small type, so the long
      // edge cut lands hardest on exactly the rows worth reading. Same call
      // `receiptOcr`'s path makes, for the same reason.
      let read = await readLabelPhoto(picked.photo.sourceUri);
      let aiFailure: string | null = null;
      // Vision transcribes for free and gets most panels; a curved tub, a
      // steep angle, or glare it couldn't see past gets a second try from
      // Claude, using the same downscaled copy already encoded for it. Only
      // attempted when there's actually a key to spend — see the doc comment
      // on `nutritionLabelPhotoAiAvailable`.
      if (!read && nutritionLabelPhotoAiAvailable()) {
        try {
          read = await readLabelPhotoWithAi(picked.photo);
        } catch (e) {
          aiFailure = describeAIError(e);
        }
      }
      if (!read) {
        haptics.warning();
        setLabel(null);
        setPhotoError(aiFailure
          ? `Claude couldn't read that photo either: ${aiFailure}`
          : "That photo didn't read as a nutrition panel. Try again with the whole panel in frame and more light on it, or type the figures in below.");
        return;
      }
      haptics.success();
      setLabel(read);
      setColumn(0);
      setForm(f => applyLabelReading(f, read, 0));
      // Filling a field can only fix one that wouldn't read, never break one,
      // so anything flagged from an earlier save attempt is re-judged on the
      // next rather than left marked red under a figure that is now fine.
      setBad([]);
      // A fresh photo read is the source on screen now; a scan note from
      // earlier in this session would otherwise sit stale beside it.
      setScanNote(null);
    } finally {
      setReading(false);
    }
  }, []);

  /**
   * Moving to another of the panel's columns.
   *
   * The figures follow immediately rather than on a confirm, because seeing
   * them change is how a person tells which column they wanted — the two
   * differ by whatever the serving weighs, which is obvious side by side and
   * invisible in a menu of headings.
   */
  const pickColumn = useCallback((index: number) => {
    if (!label) return;
    haptics.tap();
    setColumn(index);
    setForm(f => applyLabelReading(f, label, index));
    setBad([]);
  }, [label]);

  const startPhoto = useCallback(() => {
    Alert.alert(
      'Read the label',
      'Photograph the nutrition panel and the figures on it will fill in the fields below.',
      [
        { text: 'Take a photo', onPress: () => { void handlePhoto('camera'); } },
        { text: 'Choose a photo', onPress: () => { void handlePhoto('library'); } },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [handlePhoto]);

  /**
   * A barcode's own figures, laid over the form the same way a photo's are.
   *
   * The sheet closes itself the moment it finds something (see
   * `NutritionBarcodeScanSheet`), so by the time this runs there is exactly
   * one panel to apply — no column picker, since a fetched record states one
   * basis rather than a photographed panel's several.
   */
  const handleBarcodeFound = useCallback((found: FoodNutrition, sourceName: string) => {
    haptics.success();
    setForm(f => applyFoodNutrition(f, found));
    setBad([]);
    // The barcode's figures are on screen now; a photo column picker or note
    // from earlier in this session would otherwise sit stale beside them.
    setLabel(null);
    setPhotoError(null);
    const count = foodNutritionFieldCount(found);
    setScanNote(
      `Filled in ${count} ${count === 1 ? 'figure' : 'figures'} from the barcode for `
      + `“${sourceName}”. Double-check them against the label before saving.`,
    );
  }, []);

  const setAmount = (key: NutrientKey, text: string) => {
    setForm(f => ({ ...f, amounts: { ...f.amounts, [key]: text } }));
    setBad(b => (b.includes(key) ? b.filter(k => k !== key) : b));
  };

  const handleSave = () => {
    const invalid = invalidPanelFields(form);
    if (invalid.length > 0) {
      haptics.error();
      setBad(invalid);
      return;
    }
    haptics.success();
    onSave(buildPanelNutrition(form, nutrition));
    onClose();
  };

  /**
   * What to call each column in the picker.
   *
   * Its own heading where the panel printed one, and its position where it did
   * not — "First column" says something true and checkable about where the
   * figures came from, where a guessed "Per 100g" would not.
   */
  const columnOptions = useMemo(
    () => (label?.columns ?? []).map((col, index) => ({
      value: String(index),
      label: col.basis ? NUTRITION_BASIS_LABEL[col.basis] : COLUMN_ORDINAL[index] ?? `Column ${index + 1}`,
    })),
    [label],
  );

  const handleCancel = () => {
    if (!panelFormDirty(form, baseline.current)) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={64} />
          <Text style={styles.headerTitle} numberOfLines={1}>{foodName}</Text>
          <SheetHeaderButton label="Save" onPress={handleSave} minWidth={64} />
        </View>

        <ScrollView
          ref={keyboardScroll.ref}
          style={styles.flex}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          {...keyboardScroll.props}
        >
            <Text style={styles.intro}>
              Copy the numbers off the package label. Leave a field blank if the label
              doesn't list it. Blank means unknown, which is not the same as zero.
            </Text>

            <View style={styles.photoRow}>
              {canPhotograph && (
                <InlineAction
                  label={reading ? 'Reading the label…' : 'Read from a photo'}
                  icon="camera-outline"
                  onPress={startPhoto}
                  disabled={reading}
                />
              )}
              <InlineAction
                label="Scan a barcode"
                icon="barcode-outline"
                variant="neutral"
                onPress={() => { haptics.tap(); setScanning(true); }}
              />
            </View>
            {!!photoError && <Text style={styles.photoError}>{photoError}</Text>}
            {!!scanNote && (
              <View style={styles.photoRead}>
                <Text style={styles.photoNote}>{scanNote}</Text>
              </View>
            )}

            {!!label && (
              <View style={styles.photoRead}>
                {columnOptions.length > 1 ? (
                  <>
                    <SegmentedControl
                      label="Take the figures from"
                      options={columnOptions}
                      value={String(column)}
                      onChange={value => pickColumn(Number(value))}
                      surface="page"
                    />
                    <Text style={styles.photoNote}>
                      This label prints more than one column. They're the same food against
                      different portions, so they don't agree. Pick the one you want, then
                      double-check a figure or two against the label before saving.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.photoNote}>
                    {`Filled in ${labelColumnFieldCount(label.columns[0])} ${
                      labelColumnFieldCount(label.columns[0]) === 1 ? 'figure' : 'figures'
                    }. Double-check them against the label before saving.`}
                  </Text>
                )}
              </View>
            )}

            <Text style={styles.groupLabel}>SERVING</Text>
            <View style={styles.card}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Serving size</Text>
                <TextInput
                  style={styles.textInput}
                  value={form.servingText}
                  onChangeText={t => setForm(f => ({ ...f, servingText: t }))}
                  placeholder="e.g. 2 cookies (30g)"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Serving size as printed"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Serving weight</Text>
                <View style={styles.numberRow}>
                  <TextInput
                    style={[styles.numberInput, bad.includes('servingGrams') && styles.inputBad]}
                    value={form.servingGrams}
                    onChangeText={t => {
                      setForm(f => ({ ...f, servingGrams: t }));
                      setBad(b => b.filter(k => k !== 'servingGrams'));
                    }}
                    placeholder="e.g. 30"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="decimal-pad"
                    inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                    accessibilityLabel="Serving weight in grams"
                  />
                  <Text style={styles.unit}>g</Text>
                </View>
                <Text style={styles.hint}>
                  The number to compute with. A product sold by volume has none, and that
                  is fine.
                </Text>
              </View>

              <SegmentedControl
                label="The nutrients below are"
                options={BASIS_OPTIONS}
                value={form.basis}
                onChange={basis => setForm(f => ({ ...f, basis }))}
                surface="card"
              />
              <Text style={styles.hint}>
                Most labels outside the US print per 100g. Pick "per serving" only if the
                panel's own column says so.
              </Text>
            </View>

            <Text style={styles.groupLabel}>NUTRIENTS</Text>
            <View style={styles.card}>
              {NUTRIENT_KEYS.map(key => (
                <View key={key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{NUTRIENT_LABEL[key].label}</Text>
                  <View style={styles.numberRow}>
                    <TextInput
                      style={[styles.numberInput, bad.includes(key) && styles.inputBad]}
                      value={form.amounts[key]}
                      onChangeText={t => setAmount(key, t)}
                      placeholder={PLACEHOLDER[key]}
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                      inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                      accessibilityLabel={`${NUTRIENT_LABEL[key].label} in ${NUTRIENT_LABEL[key].unit}`}
                    />
                    <Text style={styles.unit}>{NUTRIENT_LABEL[key].unit}</Text>
                  </View>
                </View>
              ))}
            </View>

            {bad.length > 0 && (
              <Text style={styles.error}>
                {bad.length === 1 ? 'One field' : `${bad.length} fields`} couldn't be read as a
                number. Fix or clear {bad.length === 1 ? 'it' : 'them'}, so nothing is stored
                that the label didn't say.
              </Text>
            )}
        </ScrollView>
        <NumberPadAccessory />
      </View>
      <NutritionBarcodeScanSheet
        visible={scanning}
        onClose={() => setScanning(false)}
        onFound={handleBarcodeFound}
      />
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.separator,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: font.md,
      fontWeight: fontWeight.semibold,
    },
    body: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
    intro: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, marginBottom: spacing.sm },
    // Margin on both sides it needs: the group label below has no top margin of
    // its own, per the spacing note in CLAUDE.md. Wraps rather than a fixed
    // row now that a second action sits beside the first — same treatment
    // `GroceryItemSheet`'s own nutrition action row uses.
    photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    photoRead: { gap: spacing.sm, marginBottom: spacing.sm },
    photoNote: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
    photoError: {
      color: colors.red,
      fontSize: font.xs,
      lineHeight: 16,
      marginBottom: spacing.sm,
    },
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.md,
    },
    field: { gap: spacing.xs },
    fieldLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
    numberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    textInput: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderWidth: border.thin,
      borderColor: colors.separator,
    },
    numberInput: {
      flex: 1,
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderWidth: border.thin,
      borderColor: colors.separator,
    },
    inputBad: { borderColor: colors.red },
    unit: { color: colors.textSecondary, fontSize: font.sm, minWidth: 26 },
    hint: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
    error: { color: colors.red, fontSize: font.sm, lineHeight: 18, marginTop: spacing.md },
  });
}
