import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { CustomMinutesField } from './CustomMinutesField';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { spacing } from '../theme';
import { parseCustomMinutes, type MinutesRange } from '../utils/customMinutes';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** "Alert", "Timer length": the card's title and the field's spoken name. */
  title: string;
  range: MinutesRange;
  /** Seeds the field each time the card opens. */
  initialMinutes: number | null;
  onSubmit: (minutes: number) => void;
  onClose: () => void;
}

/**
 * The "Other…" answer for a row that offers its presets in a menu rather than
 * a track (a timer length, an event alert): one small card with a minutes
 * field. Done stays off until the number is one the row can store, so the
 * caller only ever hears a valid one.
 */
export function CustomMinutesPrompt({ visible, title, range, initialMinutes, onSubmit, onClose }: Props) {
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseCustomMinutes(text, range), [text, range]);

  useEffect(() => {
    if (visible) setText(initialMinutes === null ? '' : String(initialMinutes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const done = () => {
    if (parsed === null) return;
    card.close(() => { onClose(); onSubmit(parsed); });
  };

  return (
    <CardSheet name="CustomMinutesPrompt" visible={visible} controller={card} onRequestClose={dismiss}>
      <View>
        <SheetHeader
          title={title}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={done} disabled={parsed === null} />}
        />
        <View style={styles.body}>
          <CustomMinutesField text={text} onChangeText={setText} range={range} label={title} autoFocus />
        </View>
      </View>
    </CardSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md },
});
