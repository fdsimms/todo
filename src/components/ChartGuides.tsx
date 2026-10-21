import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { useTextScale } from '../hooks/useTextScale';
import { font, type Colors } from '../theme';

/** A bar stops this far short of its guide line rather than ending on it. */
export const BAR_GUIDE_GAP = 2;

/**
 * Width of a guide chart's label column. `labelWidth` is the width at the
 * default text size, and the column grows with the system text size so a label
 * like "Very good" isn't cut off.
 */
export function useGuideGutter(labelWidth: number): number {
  return Math.round(labelWidth * useTextScale());
}

export interface ChartGuide {
  /** Where the line sits, from 0 (the baseline) to 1 (the top of the track). */
  fraction: number;
  /** Empty draws the line alone. */
  label: string;
}

interface Props {
  /** The track the bars grow in, so a fraction means the same height as a bar's. */
  height: number;
  /** The label column's width, from `useGuideGutter`. The bars start after it. */
  gutter: number;
  guides: readonly ChartGuide[];
}

/**
 * The lines and labels behind a bar chart's bars, which say what a bar's height
 * means without a numeric axis. Absolutely positioned over the top `height` of
 * its parent, so render it before the bars: later siblings paint on top, which
 * is what puts each bar over its line. The bars take `paddingLeft: gutter`.
 */
export function ChartGuides({ height, gutter, guides }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rowHeight = Math.ceil(font.xxs * 1.5 * useTextScale());
  return (
    <View style={[styles.guides, { height }]} pointerEvents="none">
      {guides.map(guide => (
        <View
          key={guide.fraction}
          style={[styles.guide, { height: rowHeight, top: height - guide.fraction * height - rowHeight / 2 }]}
        >
          <Text style={[styles.label, { width: gutter }]} numberOfLines={1}>{guide.label}</Text>
          <View style={styles.line} />
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  guides: { position: 'absolute', top: 0, left: 0, right: 0 },
  // One text line tall and centred on the level's own y. It was zero height so
  // the centring was free, but a label inside a zero-height row never drew.
  guide: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  label: { color: colors.textTertiary, fontSize: font.xxs },
  line: { flex: 1, height: 1, backgroundColor: colors.separator, opacity: 0.6 },
});
