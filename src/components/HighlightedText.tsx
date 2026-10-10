import React from 'react';
import { Text, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';

/**
 * Renders `text` with the given `[start, end]` ranges wrapped in
 * `highlightStyle` (e.g. bolded search matches). Used by the Search results
 * and the quick-add title suggestions.
 *
 * `trailing` is rendered inside the same `Text`, after the last character, so
 * it flows with the words and wraps with them (a title's notes and deadline
 * markers). It is never highlighted and never counted against `ranges`.
 */
export function HighlightedText({
  text,
  ranges,
  style,
  highlightStyle,
  numberOfLines,
  ellipsizeMode,
  pointerEvents,
  trailing,
  onTextLayout,
}: {
  text: string;
  ranges: [number, number][];
  style?: object;
  highlightStyle?: object;
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  pointerEvents?: 'none' | 'auto';
  trailing?: React.ReactNode;
  onTextLayout?: (e: NativeSyntheticEvent<TextLayoutEventData>) => void;
}) {
  if (ranges.length === 0) {
    return <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode} pointerEvents={pointerEvents} onTextLayout={onTextLayout}>{text}{trailing}</Text>;
  }

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const segments: { text: string; highlight: boolean }[] = [];
  let cursor = 0;

  for (const [start, end] of sorted) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlight: false });
    segments.push({ text: text.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlight: false });

  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode} pointerEvents={pointerEvents} onTextLayout={onTextLayout}>
      {segments.map((seg, i) =>
        seg.highlight
          ? <Text key={i} style={highlightStyle}>{seg.text}</Text>
          : <Text key={i}>{seg.text}</Text>
      )}
      {trailing}
    </Text>
  );
}
