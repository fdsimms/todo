import React, { useMemo } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import type { StepSegment } from '../utils/stepIngredients';
import { splitStepAtDurations, type StepDuration } from '../utils/stepTimers';
import { useColors } from '../theme/ThemeContext';

interface Props {
  /** The step exactly as the recipe wrote it — what renders when there's nothing to annotate. */
  text: string;
  /**
   * The annotated form from `annotateSteps`, or undefined for a step it had
   * nothing to say about. Undefined is the common case and renders `text`
   * straight, which is why the map leaves those steps out rather than mapping
   * them to a single segment.
   */
  segments?: StepSegment[];
  /** The step's own type. The annotation inherits its size and takes the accent colour. */
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /**
   * The durations the step names (`stepDurationOffers`). With `onDurationPress`
   * each one becomes a tap target in the sentence, so the phrase "7 to 9
   * minutes" starts its own timer. Omit both and the text is plain.
   */
  durations?: StepDuration[];
  onDurationPress?: (duration: StepDuration) => void;
}

/**
 * A recipe step, with the amounts and swaps its own sentence implies.
 *
 * One component for both surfaces that render a step — cook mode's big
 * one-at-a-time text and the recipe screen's step rows — because the thing
 * worth keeping identical is what the annotation *looks* like: it is the app's
 * text sitting inside the recipe's, and a cook has to be able to tell which is
 * which at a glance. So it takes the accent colour rather than a size or a
 * weight of its own, which is the same mark a scaled or converted amount takes
 * on the ingredient row for the same reason.
 *
 * The rule for what it says is `stepIngredients.ts`'s; this only draws it. Both
 * halves render inside one `Text`, so the annotation wraps and reflows with the
 * words it belongs to instead of being a pill that can end up on its own line.
 * A tappable duration is the same: an underlined run of the sentence, not a
 * button, so the sentence keeps its line breaks.
 */
export function StepText({ text, segments, style, numberOfLines, durations, onDurationPress }: Props) {
  const colors = useColors();
  const tappable = !!onDurationPress && !!durations && durations.length > 0;
  const pieces = useMemo(
    () => (tappable ? splitStepAtDurations(text, segments, durations) : null),
    [tappable, text, segments, durations]
  );

  if (pieces) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {pieces.map((piece, at) => {
          if (piece.kind === 'text') return <Text key={at}>{piece.text}</Text>;
          if (piece.kind === 'duration') {
            return (
              <Text
                key={at}
                onPress={() => onDurationPress?.(piece.offer)}
                accessibilityRole="button"
                accessibilityLabel={`Set a timer for ${piece.text}`}
                style={{ color: colors.accentText, textDecorationLine: 'underline' }}
              >
                {piece.text}
              </Text>
            );
          }
          return (
            <Text key={at}>
              {piece.text}
              <Text style={{ color: colors.accent }}> ({piece.note})</Text>
            </Text>
          );
        })}
      </Text>
    );
  }

  if (!segments || segments.length === 0) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, at) => (segment.kind === 'text' ? (
        <Text key={at}>{segment.text}</Text>
      ) : (
        <Text key={at}>
          {segment.text}
          {/* Colour only: the size and weight are the step's own, so the
              annotation sits in the sentence rather than interrupting it. */}
          <Text style={{ color: colors.accent }}> ({segment.note})</Text>
        </Text>
      )))}
    </Text>
  );
}
