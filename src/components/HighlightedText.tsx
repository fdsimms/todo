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
  quietRanges = [],
  style,
  highlightStyle,
  quietStyle,
  numberOfLines,
  ellipsizeMode,
  pointerEvents,
  trailing,
  onTextLayout,
}: {
  text: string;
  ranges: [number, number][];
  /** Ranges drawn in `quietStyle` instead (a settled token: same ink, no fill). */
  quietRanges?: [number, number][];
  style?: object;
  highlightStyle?: object;
  quietStyle?: object;
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  pointerEvents?: 'none' | 'auto';
  trailing?: React.ReactNode;
  onTextLayout?: (e: NativeSyntheticEvent<TextLayoutEventData>) => void;
}) {
  if (ranges.length === 0 && quietRanges.length === 0) {
    return <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode} pointerEvents={pointerEvents} onTextLayout={onTextLayout}>{text}{trailing}</Text>;
  }

  // Cut the text at every range edge, then style each piece by what covers it.
  // A piece in `ranges` wins over one in `quietRanges`, so a mention still being
  // typed keeps its fill even when it also sits in the settled set.
  const cuts = new Set<number>([0, text.length]);
  for (const [start, end] of [...ranges, ...quietRanges]) {
    cuts.add(Math.max(0, Math.min(start, text.length)));
    cuts.add(Math.max(0, Math.min(end, text.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const covers = (rs: [number, number][], at: number) => rs.some(([s, e]) => at >= s && at < e);
  const segments: { text: string; style: object | undefined }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    segments.push({
      text: text.slice(from, to),
      style: covers(ranges, from) ? highlightStyle : covers(quietRanges, from) ? quietStyle : undefined,
    });
  }

  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode} pointerEvents={pointerEvents} onTextLayout={onTextLayout}>
      {segments.map((seg, i) =>
        seg.style
          ? <Text key={i} style={seg.style}>{seg.text}</Text>
          : <Text key={i}>{seg.text}</Text>
      )}
      {trailing}
    </Text>
  );
}
