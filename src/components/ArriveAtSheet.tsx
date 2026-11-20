import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { spacing } from '../theme';
import { arriveClockFor, arriveMinutesForClock } from '../utils/travelTasks';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** The event's start, which the picked clock time is measured from. */
  start: Date | null;
  /** The arrival now in use, in minutes before the start, to open the wheel on. */
  currentMinutes: number;
  onSubmit: (minutes: number) => void;
  onClose: () => void;
}

/**
 * The "Other…" answer for the Arrive picker: a time wheel for when to be there,
 * for an event whose start isn't when you want to arrive (a 5 to 10 PM event
 * you join at 8). The pick is stored as minutes from the start like the
 * presets, so a repeating event keeps the same offset each week.
 */
export function ArriveAtSheet({ visible, start, currentMinutes, onSubmit, onClose }: Props) {
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [time, setTime] = useState<Date>(() => new Date());

  useEffect(() => {
    if (visible && start) setTime(arriveClockFor(start, currentMinutes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const done = () => {
    if (!start) return;
    const minutes = arriveMinutesForClock(start, time);
    card.close(() => { onClose(); onSubmit(minutes); });
  };

  return (
    <CardSheet name="ArriveAtSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View>
        <SheetHeader
          title="Arrive at"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.done} onPress={done} disabled={!start} />}
        />
        <View style={styles.body}>
          <DateTimePicker
            value={time}
            mode="time"
            display="spinner"
            minuteInterval={5}
            onChange={(_e, d) => { if (d) setTime(d); }}
          />
        </View>
      </View>
    </CardSheet>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md },
});
