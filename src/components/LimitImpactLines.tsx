import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, spacing, type Colors } from '../theme';
import { describeLimitImpact, type LimitImpact } from '../utils/nutritionTargets';

/**
 * "Puts you at 14 of 16 g saturated fat", one line per limit an entry about
 * to be logged would move. Renders nothing when there are none, so a sheet can
 * mount it unconditionally. A line that takes or keeps the day past a limit is
 * red, the colour the Food log's bar uses for the same state; the rest are the
 * secondary grey, since they are information rather than a warning.
 */
export function LimitImpactLines({ impacts, style }: { impacts: LimitImpact[]; style?: StyleProp<ViewStyle> }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (impacts.length === 0) return null;
  return (
    <View style={[styles.root, style]}>
      {impacts.map(impact => (
        <Text key={impact.key} style={[styles.line, impact.status === 'over' && styles.over]}>
          {describeLimitImpact(impact)}
        </Text>
      ))}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { gap: spacing.xxs },
    line: { color: colors.textSecondary, fontSize: font.xs },
    over: { color: colors.redText, fontWeight: fontWeight.semibold },
  });
}
