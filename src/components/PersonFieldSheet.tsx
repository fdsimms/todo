import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type KeyboardTypeOptions } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { BUTTON_LABEL } from '../copy/shared';
import { TITLE_MAX_LENGTH } from '../types';
import { formatPhoneInput } from '../utils/phone';
import { PERSON_FIELDS, type PersonFieldKey } from '../utils/personFields';

export interface PersonFieldRequest {
  field: Exclude<PersonFieldKey, 'birthday'>;
  /** What the field holds when the card opens. */
  initial: string;
  /** Called once, with the trimmed text, after the card has closed. */
  onSave: (typed: string) => void;
}

interface Props {
  /** The field being edited, or null while the card is closed. */
  request: PersonFieldRequest | null;
  onClose: () => void;
}

const KEYBOARD: Partial<Record<PersonFieldKey, KeyboardTypeOptions>> = {
  phoneNumber: 'phone-pad',
  email: 'email-address',
};

/**
 * A short card that edits one detail on a person's page (name, nickname,
 * phone, email, address). It is `NameSheet`'s shape, except that an optional
 * field may be saved empty, which clears it.
 *
 * **Held through the fade.** `request` goes null when the card closes, but the
 * card still draws on the way out, so the last request is kept for that commit
 * (`useSheetSubject`) and `visible` follows the live one.
 */
export function PersonFieldSheet({ request: live, onClose }: Props) {
  const request = useSheetSubject(live);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [text, setText] = useState('');

  // Seeded on each opening, so a reopen starts from what is saved.
  useEffect(() => {
    if (live) setText(live.initial);
  }, [live]);

  if (!request) return null;
  const spec = PERSON_FIELDS.find(f => f.key === request.field)!;
  const typed = text.trim();
  const canSave = !spec.required || typed.length > 0;

  const save = () => {
    if (!canSave) return;
    if (typed === request.initial.trim()) { dismiss(); return; }
    card.close(() => { request.onSave(typed); onClose(); });
  };

  const multiline = request.field === 'address';

  return (
    <CardSheet name="PersonFieldSheet" visible={live !== null} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title={spec.label}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} disabled={!canSave} onPress={save} />}
        />
        <View style={styles.body}>
          <TextField
            style={[styles.input, multiline && styles.inputMultiline]}
            value={text}
            onChangeText={next => setText(request.field === 'phoneNumber' ? formatPhoneInput(next) : next)}
            placeholder={spec.placeholder}
            placeholderTextColor={colors.textTertiary}
            maxLength={request.field === 'name' || request.field === 'nickname' ? TITLE_MAX_LENGTH : undefined}
            keyboardType={KEYBOARD[request.field]}
            autoCapitalize={request.field === 'email' ? 'none' : request.field === 'address' ? 'words' : undefined}
            autoCorrect={request.field === 'email' ? false : undefined}
            multiline={multiline}
            textAlignVertical={multiline ? 'top' : undefined}
            autoFocus
            returnKeyType={multiline ? 'default' : 'done'}
            onSubmitEditing={multiline ? undefined : save}
            accessibilityLabel={spec.label}
          />
        </View>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    body: { padding: spacing.md },
    input: {
      color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44,
    },
    // No lineHeight on a TextInput; a taller minimum is what makes it read as a text area.
    inputMultiline: { minHeight: 88, paddingTop: spacing.smd, paddingBottom: spacing.smd },
  });
}
