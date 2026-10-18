import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCookwareStore } from '../store/useCookwareStore';
import { EditorSheet } from './EditorSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { HelpText } from './HelpText';
import { InlineAction } from './InlineAction';
import { EmptyNote } from './EmptyNote';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from './NumberPadAccessory';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { fieldWell } from '../theme/textStyles';
import { parseWeightText, clampCookwareWeight } from '../utils/cookware';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

const NAME_MAX_LENGTH = 40;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The pots, pans, lids and tubs a dish can be weighed in, and what each weighs
 * empty. Reached from the weight field wherever one is typed, and from
 * Settings.
 *
 * Every row commits as it is edited (a name on leaving its field, a weight the
 * same), so there is nothing staged to lose and no discard guard. A weight that
 * isn't one puts the old value back rather than saving it.
 */
export function CookwareSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cookware = useCookwareStore(s => s.cookware);
  const addCookware = useCookwareStore(s => s.addCookware);
  const updateCookware = useCookwareStore(s => s.updateCookware);
  const removeCookware = useCookwareStore(s => s.removeCookware);

  const [newName, setNewName] = useState('');
  const [newWeight, setNewWeight] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    if (!newName.trim()) { setError('Name it first, for example "Dutch oven".'); return; }
    const grams = clampCookwareWeight(parseWeightText(newWeight));
    if (grams === null) { setError('Weigh it empty and type the number in grams.'); return; }
    addCookware(newName, grams);
    haptics.success();
    setNewName('');
    setNewWeight('');
    setError(null);
  };

  const confirmDelete = (id: string, name: string) => {
    Alert.alert(`Delete ${name}?`, 'Dishes already weighed keep their weight. Only this entry goes.', [
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
      { text: BUTTON_LABEL.delete, style: 'destructive', onPress: () => removeCookware(id) },
    ]);
  };

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title="Cookware"
          left={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={onClose} />}
          right={<View style={styles.headerSpacer} />}
        />
      }
      footer={<NumberPadAccessory />}
    >
      <HelpText style={styles.hint}>
        Weigh each one empty and save it here. When you weigh a dish with its pot, or food on a
        plate, the app takes its weight off.
      </HelpText>

      <Text style={styles.groupLabel}>New</Text>
      <View style={styles.card}>
        <View style={styles.well}>
          <TextField
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. Dutch oven"
            placeholderTextColor={colors.textTertiary}
            maxLength={NAME_MAX_LENGTH}
            accessibilityLabel="Cookware name"
          />
        </View>
        <View style={styles.well}>
          <TextField
            style={styles.input}
            value={newWeight}
            onChangeText={setNewWeight}
            keyboardType="decimal-pad"
            inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
            placeholder="Empty weight"
            placeholderTextColor={colors.textTertiary}
            maxLength={6}
            accessibilityLabel="Empty weight in grams"
          />
          <Text style={styles.unit}>g</Text>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <InlineAction label="Add" icon="add" onPress={handleAdd} style={styles.add} />
      </View>

      <Text style={styles.groupLabel}>Your cookware</Text>
      {cookware.length === 0 ? (
        <EmptyNote icon="restaurant-outline">
          Nothing saved yet. Add a pot or plate above and it will show up next to the weight field.
        </EmptyNote>
      ) : (
        <View style={styles.card}>
          {cookware.map((c, i) => (
            <View key={`${c.id}:${c.name}:${c.weightG}`} style={[styles.row, i > 0 && styles.rowDivider]}>
              <View style={[styles.well, styles.rowName]}>
                <TextField
                  style={styles.input}
                  defaultValue={c.name}
                  onEndEditing={e => updateCookware(c.id, { name: e.nativeEvent.text })}
                  maxLength={NAME_MAX_LENGTH}
                  accessibilityLabel={`Name of ${c.name}`}
                />
              </View>
              <View style={[styles.well, styles.rowWeight]}>
                <TextField
                  style={[styles.input, styles.rowWeightInput]}
                  defaultValue={String(c.weightG)}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                  onEndEditing={e => {
                    const grams = parseWeightText(e.nativeEvent.text);
                    if (grams !== null) updateCookware(c.id, { weightG: grams });
                  }}
                  maxLength={6}
                  accessibilityLabel={`Empty weight of ${c.name} in grams`}
                />
                <Text style={styles.unit}>g</Text>
              </View>
              <TouchableOpacity
                onPress={() => confirmDelete(c.id, c.name)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${c.name}`}
              >
                <Ionicons name="trash-outline" size={20} color={colors.red} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerSpacer: { width: 20 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  hint: { color: colors.textTertiary, fontSize: font.sm, marginBottom: spacing.md },
  groupLabel: {
    fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.smd,
    marginBottom: spacing.md,
  },
  // The card is bgSecondary, so the fields step up to bgTertiary (`fieldWell`).
  well: { ...fieldWell(colors), marginBottom: spacing.sm },
  input: { flex: 1, color: colors.text, fontSize: font.md, padding: 0, minHeight: 44 },
  unit: { color: colors.textSecondary, fontSize: font.sm },
  error: { color: colors.redText, fontSize: font.sm, marginTop: spacing.xs },
  add: { alignSelf: 'flex-start', marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowName: { flex: 1, marginBottom: 0 },
  rowWeight: { width: 104, marginBottom: 0 },
  rowWeightInput: { textAlign: 'right' },
});
