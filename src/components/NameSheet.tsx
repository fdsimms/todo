import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { HelpText } from './HelpText';
import { FieldError } from './FieldError';
import { TextField } from './TextField';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { BUTTON_LABEL } from '../copy/shared';

export interface NameRequest {
  title: string;
  /** What the field holds when the sheet opens: the current name, or empty for a new one. */
  initial: string;
  placeholder: string;
  /** A line about what the name does, under the field. Follows Hide help text. */
  hint?: string;
  /** Defaults to Save; "Next" where a name is the first step of something longer. */
  saveLabel?: string;
  maxLength?: number;
  /**
   * Save the prefilled name as it stands. Off for a rename, where an unchanged
   * name has nothing to write; on where the name makes something new and the
   * prefill is a fair answer (a routine named after its workout).
   */
  saveUnchanged?: boolean;
  /**
   * The sentence to show when what is typed can't be used, or null. Asked on
   * every keystroke and again at Save, from the same rule the store refuses on,
   * so the sheet can't accept a name the store would turn away.
   */
  refusal: (typed: string) => string | null;
  /** Called once, with the trimmed name, after the card has closed. */
  onSave: (typed: string) => void;
}

interface Props {
  /** The name being asked for, or null while the sheet is closed. */
  request: NameRequest | null;
  onClose: () => void;
}

/**
 * A short card that asks for one name and says under the field when it is
 * taken.
 *
 * It replaces the native `Alert.prompt` for a name that can be refused: the
 * typed text is only a callback argument there and Save is the system's own
 * button, so the refusal could only come as a second alert after the prompt had
 * closed and the text was gone. Here Save stays off while the name is refused,
 * with the reason under the field. The look is `GroupNameSheet`'s, which does
 * the same for a workout routine group against its own store.
 *
 * **Held through the fade.** `request` goes null when the card closes, but the
 * card still draws on the way out, so the last request is kept for that commit
 * (`useSheetSubject`) and `visible` follows the live one.
 */
export function NameSheet({ request: live, onClose }: Props) {
  const request = useSheetSubject(live);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [name, setName] = useState('');

  // Seeded on each opening, so a reopen on the same request starts from it
  // rather than from the last attempt.
  useEffect(() => {
    if (live) setName(live.initial);
  }, [live]);

  if (!request) return null;
  const typed = name.trim();
  const refusal = typed ? request.refusal(typed) : null;
  const unchanged = typed === request.initial.trim();

  const save = () => {
    if (!typed || refusal) return;
    // Nothing to write for a rename that changed nothing.
    if (unchanged && !request.saveUnchanged) { dismiss(); return; }
    card.close(() => { request.onSave(typed); onClose(); });
  };

  return (
    <CardSheet name="NameSheet" visible={live !== null} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title={request.title}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={request.saveLabel ?? BUTTON_LABEL.save} disabled={!typed || !!refusal} onPress={save} />}
        />
        <View style={styles.body}>
          <TextField
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={request.placeholder}
            placeholderTextColor={colors.textTertiary}
            maxLength={request.maxLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel={request.title}
          />
          <FieldError>{refusal}</FieldError>
          {request.hint ? <HelpText style={styles.hint}>{request.hint}</HelpText> : null}
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
    hint: { marginTop: spacing.md, color: colors.textSecondary, fontSize: font.sm },
  });
}
