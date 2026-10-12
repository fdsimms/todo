import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';
import { makeSettingsStyles } from '../screens/settings/settingsStyles';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { CountStepper } from './CountStepper';
import { InlineAction } from './InlineAction';
import { formatHHMM } from '../utils/dateUtils';
import { SUN_OFFSET_LIMIT, SUN_OFFSET_STEP, type SunAnchor, type SunEvent } from '../utils/sunTimes';

type Side = 'before' | 'at' | 'after';

interface Props {
  event: SunEvent;
  /** The bound's anchor as it stands, or null before one has been written. */
  anchor: SunAnchor | null;
  /** The clock time the anchor resolved to on the task's day. */
  resolved: string | null;
  /** "Today" or "On Oct 12": the day `resolved` is for. */
  dayLabel: string;
  hasLocation: boolean;
  locationStatus: 'idle' | 'asking' | 'failed';
  /** The sun doesn't rise or set at the saved place on that day. */
  unavailable: boolean;
  onSide: (side: Side) => void;
  onMinutes: (minutes: number) => void;
  onUseLocation: () => void;
  onDone: () => void;
}

/**
 * What unfolds under a Start or End pill set to Sunrise or Sunset: before / at
 * / after, how many minutes, and the clock time that comes to on the task's
 * day. Each change is written as it's made (there is no spinner to settle), so
 * the button is Done rather than Set.
 *
 * The offset is a side plus a plain number rather than one signed stepper,
 * because CountStepper is for a number with a unit, not a value that reads as a
 * sentence (see the note on that component).
 *
 * With no location saved it asks for one first and offers nothing to pick:
 * an anchor saved without a place to measure it from would quietly read as a
 * clock time, which is the one answer a control isn't allowed to give.
 */
export function SunBoundPanel({
  event, anchor, resolved, dayLabel, hasLocation, locationStatus, unavailable,
  onSide, onMinutes, onUseLocation, onDone,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settingsStyles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const eventName = event === 'sunrise' ? 'sunrise' : 'sunset';

  const sideOptions = useMemo<SegmentOption<Side>[]>(() => [
    { value: 'before', label: 'Before' },
    { value: 'at', label: event === 'sunrise' ? 'At sunrise' : 'At sunset' },
    { value: 'after', label: 'After' },
  ], [event]);

  const offset = anchor?.offsetMinutes ?? 0;
  const side: Side = offset === 0 ? 'at' : offset < 0 ? 'before' : 'after';

  return (
    <>
      <View style={styles.body}>
        {!hasLocation ? (
          <>
            <Text style={styles.note}>
              Sunrise and sunset are worked out on this phone from a location you save once. It isn’t sent anywhere.
            </Text>
            <InlineAction
              icon="locate-outline"
              label={locationStatus === 'asking' ? 'Finding your location' : 'Use my current location'}
              onPress={onUseLocation}
              disabled={locationStatus === 'asking'}
              style={styles.action}
            />
            {locationStatus === 'failed' && (
              <Text style={styles.note}>
                Couldn’t read your location. Allow Location for dundundun in Settings, then try again.
              </Text>
            )}
          </>
        ) : unavailable ? (
          <Text style={styles.note}>
            The sun doesn’t {event === 'sunrise' ? 'rise' : 'set'} at your saved location on that day, so there’s no time to follow.
          </Text>
        ) : (
          <>
            <SegmentedControl
              options={sideOptions}
              value={side}
              onChange={onSide}
              label={`Offset from ${eventName}`}
            />
            {side !== 'at' && (
              <CountStepper
                value={Math.abs(offset)}
                onChange={n => { if (n !== null) onMinutes(n); }}
                min={SUN_OFFSET_STEP}
                max={SUN_OFFSET_LIMIT}
                step={SUN_OFFSET_STEP}
                format={n => `${n} min`}
                label={`minutes ${side} ${eventName}`}
                describeValue={n => `${n ?? 0} minutes ${side} ${eventName}`}
              />
            )}
            {anchor && resolved && (
              <Text style={styles.note}>
                {dayLabel} that’s {formatHHMM(resolved)}, and it moves with {eventName} each day.
              </Text>
            )}
          </>
        )}
      </View>
      <View style={settingsStyles.pickerButtons}>
        <TouchableOpacity
          style={[settingsStyles.pickerBtn, settingsStyles.pickerBtnPrimary]}
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={[settingsStyles.pickerBtnText, { color: colors.onAccent }]}>Done</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  body: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.md,
  },
  note: { color: colors.textSecondary, fontSize: font.xs, lineHeight: 16 },
  action: { alignSelf: 'flex-start' },
});
