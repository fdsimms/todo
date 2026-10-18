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
import { ChoiceMenuChip, type ChoiceGroup } from './ChoiceMenuChip';
import { parseWeightText, clampCookwareWeight, groupCookwareByType, cookwareTypeOf, isCookwareType, COOKWARE_TYPES } from '../utils/cookware';
import type { CookwareType } from '../types';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

const NAME_MAX_LENGTH = 40;

/** The key for "read the type from the name", which is a state rather than a type. */
const AUTO_KEY = 'auto';

const TYPE_MENU: ChoiceGroup[] = [
  { options: [{ key: AUTO_KEY, label: 'From the name' }] },
  { heading: 'TYPE', options: COOKWARE_TYPES.map(t => ({ key: t, label: t })) },
];

/** A menu key as the stored value: null for "from the name". */
const kindOfKey = (key: string): CookwareType | null => (isCookwareType(key) ? key : null);

/**
 * The type dropdown. A piece with no chosen type shows what its name reads as,
 * so the chip never claims a choice nobody made.
 */
function TypeChip({ name, kind, onSelect, label }: {
  name: string;
  kind: CookwareType | null;
  onSelect: (kind: CookwareType | null) => void;
  label: string;
}) {
  return (
    <ChoiceMenuChip
      groups={TYPE_MENU}
      selectedKey={kind ?? AUTO_KEY}
      onSelect={key => onSelect(kindOfKey(key))}
      noun={label}
      name={`CookwareType:${name}`}
      labelOverride={kind ? undefined : `${cookwareTypeOf(name)} (from the name)`}
    />
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * The pots, pans, lids and tubs a dish can be weighed in, and what each weighs
 * empty, listed under their type (`groupCookwareByType`), which is the one picked
 * from each piece's dropdown or, until one is picked, what its name reads as. Reached from the weight field wherever one is typed, and from
 * Settings.
 *
 * A saved item reads as a finished row. Tapping it opens its name and weight as
 * fields, and the check commits both, so there is nothing staged to lose and no
 * discard guard. A weight that isn't one puts the old value back rather than
 * saving it.
 */
export function CookwareSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cookware = useCookwareStore(s => s.cookware);
  const addCookware = useCookwareStore(s => s.addCookware);
  const updateCookware = useCookwareStore(s => s.updateCookware);
  const removeCookware = useCookwareStore(s => s.removeCookware);

  const groups = useMemo(() => groupCookwareByType(cookware), [cookware]);

  const [newName, setNewName] = useState('');
  const [newWeight, setNewWeight] = useState('');
  const [newKind, setNewKind] = useState<CookwareType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editWeight, setEditWeight] = useState('');

  const handleAdd = () => {
    if (!newName.trim()) { setError('Name it first, for example "Dutch oven".'); return; }
    const grams = clampCookwareWeight(parseWeightText(newWeight));
    if (grams === null) { setError('Weigh it empty and type the number in grams.'); return; }
    addCookware(newName, grams, newKind);
    haptics.success();
    setNewName('');
    setNewWeight('');
    setNewKind(null);
    setError(null);
  };

  const finishEdit = () => {
    const current = cookware.find(c => c.id === editingId);
    if (current) {
      const patch: { name?: string; weightG?: number } = {};
      if (editName.trim()) patch.name = editName;
      const grams = clampCookwareWeight(parseWeightText(editWeight));
      if (grams !== null) patch.weightG = grams;
      updateCookware(current.id, patch);
    }
    setEditingId(null);
  };

  const startEdit = (id: string, name: string, weightG: number) => {
    if (editingId && editingId !== id) finishEdit();
    setEditName(name);
    setEditWeight(String(weightG));
    setEditingId(id);
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
        <View style={styles.typeRow}>
          <TypeChip name={newName} kind={newKind} onSelect={setNewKind} label="Type of new cookware" />
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <InlineAction label="Add" icon="add" onPress={handleAdd} style={styles.add} />
      </View>

      {cookware.length === 0 ? (
        <>
          <Text style={styles.groupLabel}>Your cookware</Text>
          <EmptyNote icon="restaurant-outline">
            Nothing saved yet. Add a pot or plate above and it will show up next to the weight field.
          </EmptyNote>
        </>
      ) : (
        groups.map(group => (
          <React.Fragment key={group.type}>
            <Text style={styles.groupLabel}>{group.type}</Text>
            <View style={styles.card}>
              {group.items.map((c, i) => (
                <View key={c.id} style={[styles.rowBlock, i > 0 && styles.rowDivider]}>
                  <View style={styles.row}>
                    {editingId === c.id ? (
                      <>
                        <View style={[styles.well, styles.rowName]}>
                          <TextField
                            style={styles.input}
                            value={editName}
                            onChangeText={setEditName}
                            maxLength={NAME_MAX_LENGTH}
                            autoFocus
                            accessibilityLabel={`Name of ${c.name}`}
                          />
                        </View>
                        <View style={[styles.well, styles.rowWeight]}>
                          <TextField
                            style={[styles.input, styles.rowWeightInput]}
                            value={editWeight}
                            onChangeText={setEditWeight}
                            keyboardType="decimal-pad"
                            inputAccessoryViewID={NUMBER_PAD_ACCESSORY_ID}
                            maxLength={6}
                            accessibilityLabel={`Empty weight of ${c.name} in grams`}
                          />
                          <Text style={styles.unit}>g</Text>
                        </View>
                        <TouchableOpacity
                          onPress={finishEdit}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Save ${c.name}`}
                        >
                          <Ionicons name="checkmark" size={22} color={colors.accentText} />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={styles.rowTap}
                          onPress={() => startEdit(c.id, c.name, c.weightG)}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${c.name}, ${c.weightG} grams`}
                        >
                          <Text style={styles.rowTitle} numberOfLines={1}>{c.name}</Text>
                          <Text style={styles.rowValue}>{c.weightG} g</Text>
                          <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => confirmDelete(c.id, c.name)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${c.name}`}
                        >
                          <Ionicons name="trash-outline" size={20} color={colors.red} />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                  <View style={styles.typeRow}>
                    <TypeChip
                      name={c.name}
                      kind={c.kind}
                      onSelect={kind => updateCookware(c.id, { kind })}
                      label={`Type of ${c.name}`}
                    />
                  </View>
                </View>
              ))}
            </View>
          </React.Fragment>
        ))
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
  rowBlock: { paddingVertical: spacing.xs },
  typeRow: { flexDirection: 'row', marginTop: spacing.xs, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
  rowValue: { color: colors.textSecondary, fontSize: font.md, fontVariant: ['tabular-nums'] },
  rowName: { flex: 1, marginBottom: 0 },
  rowWeight: { width: 104, marginBottom: 0 },
  rowWeightInput: { textAlign: 'right' },
});
