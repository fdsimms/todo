import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TemplateQuestion, TemplateQuestionKind, TemplateQuestionSource } from '../types';
import { TITLE_MAX_LENGTH } from '../types';
import { useTemplateStore } from '../store/useTemplateStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import { normalizePlaceholderName } from '../utils/templateUtils';
import { EditorSheet } from './EditorSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { InlineAction } from './InlineAction';

interface Props {
  visible: boolean;
  templateId: string;
  /** The question being edited, or null to write a new one. */
  question: TemplateQuestion | null;
  onClose: () => void;
}

const KIND_OPTIONS: { value: TemplateQuestionKind; label: string }[] = [
  { value: 'choice', label: 'A choice' },
  { value: 'number', label: 'A number' },
  { value: 'text', label: 'Text' },
];

const KIND_NOTES: Record<TemplateQuestionKind, string> = {
  choice: 'Pick one of the answers below. Items can be set to be included only for some of them.',
  number: 'Type a count. Item titles can do arithmetic on it — "Pack {nights / 2} pairs of jeans".',
  text: 'Type anything. Fills the blank of the same name in item titles and notes.',
};

const SOURCE_OPTIONS: { value: TemplateQuestionSource; label: string }[] = [
  { value: 'none', label: 'Type it' },
  { value: 'nights', label: 'Nights' },
  { value: 'days', label: 'Days' },
];

const SOURCE_NOTES: Record<TemplateQuestionSource, string> = {
  none: 'The answer is typed in every time.',
  nights: 'Starts at the number of nights between the run\'s start and end dates. The 3rd to the 10th is 7. You can still type over it.',
  days: 'Starts at the number of days between the run\'s start and end dates, counting both. The 3rd to the 10th is 8. You can still type over it.',
};

/**
 * Write one of a template's questions — what the apply sheet asks about a run
 * before it creates anything.
 *
 * Its own sheet rather than a field inside `TemplateEditor`, because a question
 * is four decisions (what to ask, what kind of answer, what the answers are,
 * where it starts) and the editor's other fields are one apiece. The editor
 * keeps the list; this holds one row of it.
 */
export function TemplateQuestionSheet({ visible, templateId, question, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const addQuestion = useTemplateStore(s => s.addQuestion);
  const updateQuestion = useTemplateStore(s => s.updateQuestion);
  const deleteQuestion = useTemplateStore(s => s.deleteQuestion);

  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TemplateQuestionKind>('choice');
  const [options, setOptions] = useState<string[]>([]);
  const [defaultValue, setDefaultValue] = useState('');
  const [fromDates, setFromDates] = useState<TemplateQuestionSource>('none');

  useEffect(() => {
    if (!visible) return;
    setPrompt(question?.prompt ?? '');
    setName(question?.name ?? '');
    setKind(question?.kind ?? 'choice');
    setOptions(question?.options ?? ['', '']);
    setDefaultValue(question?.defaultValue ?? '');
    setFromDates(question?.fromDates ?? 'none');
  }, [visible, question]);

  const setOption = (index: number, value: string) =>
    setOptions(prev => prev.map((o, i) => (i === index ? value : o)));

  const removeOption = (index: number) => {
    animateLayout();
    setOptions(prev => prev.filter((_, i) => i !== index));
  };

  const save = () => {
    const cleanedOptions = options.map(o => o.trim()).filter(Boolean);
    // A name is optional — a question can exist purely to condition items — but
    // one that's typed has to be a blank the engine will actually match again,
    // or the title keeps its literal `{2 nights}` forever.
    const cleanedName = name.trim() ? normalizePlaceholderName(name) : '';
    if (cleanedName === null) {
      haptics.warning();
      Alert.alert(
        'That blank won\'t fill in',
        'A blank\'s name starts with a letter and holds letters, numbers, spaces, hyphens and underscores — and can\'t look like a sum ("nights-2"). Try "nights" or "trip type".',
      );
      return;
    }
    if (!prompt.trim() && !cleanedName) {
      haptics.warning();
      Alert.alert('Nothing to ask', 'Give the question something to say, or a blank for it to fill in.');
      return;
    }
    const values = {
      prompt: prompt.trim(),
      name: cleanedName,
      kind,
      options: kind === 'choice' ? cleanedOptions : [],
      defaultValue: kind === 'choice' ? '' : defaultValue.trim(),
      fromDates: kind === 'number' ? fromDates : ('none' as TemplateQuestionSource),
    };
    if (question) updateQuestion(templateId, question.id, values);
    else addQuestion(templateId, values);
    onClose();
  };

  const handleDelete = () => {
    if (!question) return;
    haptics.warning();
    confirmDelete({
      title: 'Delete Question',
      message: 'Delete this question? Items that were only included for some of its answers go back to being included every time.',
      onConfirm: () => {
        animateLayout();
        deleteQuestion(templateId, question.id);
        onClose();
      },
    });
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
        <>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={60} />
          <Text style={styles.headerTitle}>{question ? 'Edit Question' : 'New Question'}</Text>
          <SheetHeaderButton label="Save" onPress={save} minWidth={60} />
        </>
      }
    >
      <TextInput
        style={styles.titleInput}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="e.g. What kind of trip is it?"
        placeholderTextColor={colors.textTertiary}
        multiline
        maxLength={TITLE_MAX_LENGTH}
      />

      <View style={styles.sectionCard}>
        <Text style={styles.fieldLabel}>ANSWER</Text>
        <SegmentedControl
          options={KIND_OPTIONS}
          value={kind}
          onChange={next => { haptics.tap(); animateLayout(); setKind(next); }}
          label="Answer type"
        />
        <Text style={styles.note}>{KIND_NOTES[kind]}</Text>
      </View>

      {kind === 'choice' && (
        <View style={styles.sectionCard}>
          <Text style={styles.fieldLabel}>ANSWERS</Text>
          <Text style={styles.note}>The first one is what a run starts on.</Text>
          {options.map((option, index) => (
            <View key={index} style={styles.optionRow}>
              <TextInput
                style={styles.optionInput}
                value={option}
                onChangeText={text => setOption(index, text)}
                placeholder={index === 0 ? 'e.g. Work' : 'e.g. Vacation'}
                placeholderTextColor={colors.textTertiary}
                maxLength={TITLE_MAX_LENGTH}
                returnKeyType="done"
                accessibilityLabel={`Answer ${index + 1}`}
              />
              <TouchableOpacity
                onPress={() => removeOption(index)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove answer ${option || index + 1}`}
              >
                <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
          <InlineAction
            icon="add"
            label="Add answer"
            variant="neutral"
            onPress={() => { animateLayout(); setOptions(prev => [...prev, '']); }}
          />
        </View>
      )}

      {kind === 'number' && (
        <View style={styles.sectionCard}>
          <Text style={styles.fieldLabel}>STARTS AT</Text>
          <SegmentedControl
            options={SOURCE_OPTIONS}
            value={fromDates}
            onChange={next => { haptics.tap(); animateLayout(); setFromDates(next); }}
            label="Where the number starts"
          />
          <Text style={styles.note}>{SOURCE_NOTES[fromDates]}</Text>
        </View>
      )}

      {kind !== 'choice' && fromDates === 'none' && (
        <View style={styles.sectionCard}>
          <Text style={styles.fieldLabel}>DEFAULT</Text>
          <TextInput
            style={styles.valueInput}
            value={defaultValue}
            onChangeText={setDefaultValue}
            placeholder={kind === 'number' ? 'e.g. 3' : 'e.g. Portland'}
            placeholderTextColor={colors.textTertiary}
            keyboardType={kind === 'number' ? 'number-pad' : 'default'}
            maxLength={TITLE_MAX_LENGTH}
            returnKeyType="done"
          />
          <Text style={styles.note}>What the field starts at. Leave empty to start blank.</Text>
        </View>
      )}

      <View style={styles.sectionCard}>
        <Text style={styles.fieldLabel}>FILLS THE BLANK</Text>
        <View style={styles.blankRow}>
          <Text style={styles.brace}>{'{'}</Text>
          <TextInput
            style={styles.valueInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. nights"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            maxLength={TITLE_MAX_LENGTH}
            returnKeyType="done"
            accessibilityLabel="Blank this question fills"
          />
          <Text style={styles.brace}>{'}'}</Text>
        </View>
        <Text style={styles.note}>
          Item titles holding this blank get the answer written into them. Leave it empty for a
          question that only decides which items are included.
        </Text>
      </View>

      {question && (
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={handleDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete question"
        >
          <Ionicons name="trash-outline" size={18} color={colors.red} />
          <Text style={styles.deleteLabel}>Delete question</Text>
        </TouchableOpacity>
      )}
    </EditorSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  titleInput: {
    color: colors.text,
    fontSize: font.xl,
    fontWeight: fontWeight.semibold,
    paddingVertical: spacing.sm,
  },
  sectionCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
  },
  note: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  blankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  brace: {
    color: colors.textTertiary,
    fontSize: font.md,
  },
  valueInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  deleteLabel: {
    color: colors.red,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
});
