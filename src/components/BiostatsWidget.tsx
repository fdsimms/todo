import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle } from 'react-native-svg';
import type { ContextRow, NutrientKey } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { biostatsCollapsed, type BiostatsMark } from '../utils/biostatsWidget';
import { RING_ORDER, describeRing } from '../utils/activityRings';
import { ProgressBar } from './ProgressBar';
import { RotatingChevron } from './RotatingChevron';
import { AnimatedCollapsible } from './AnimatedCollapsible';
import { ActivityRingsGlyph, ringColor } from './ActivityRingsCard';

interface Props {
  /** Today's Health readings and nutrition rows, already filtered by their switches. */
  rows: readonly ContextRow[];
  collapsed: boolean;
  onToggle: () => void;
  /** A tile for a nutrient was tapped: open its food contribution breakdown. */
  onNutrientPress: (key: NutrientKey) => void;
}

const RING_SIZE = 44;
const RING_STROKE = 5;
const BAR_HEIGHT = 6;
const ROW_MIN_HEIGHT = 48;

/**
 * Biostats, at the top of Today: Health's readings and the day's nutrition
 * against its limits and goals, in one card that folds to a calorie ring and the
 * two bars most worth a glance, and opens to a tile per reading.
 *
 * It used to be a category of rows in the list. A day's readings are not tasks
 * and have no use for a category's ordering, dragging or section header, so this
 * sits in the list header with the strips and the pinned block and scrolls away
 * with the rows (see `todayListHeader`). Its rows come from the same builders as
 * before (`healthContextRows`, `limitContextRows`, `goalContextRows`); what
 * changed is where they draw. Which marks the folded card shows is
 * `biostatsCollapsed`, which is pure and tested.
 *
 * The folded and open headers share one `minHeight`, so the card doesn't jump
 * by a line as the content under it eases open.
 */
export function BiostatsWidget({ rows, collapsed, onToggle, onNutrientPress }: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const marks = useMemo(() => biostatsCollapsed(rows), [rows]);
  if (rows.length === 0) return null;

  const spoken = rows.map(r => r.title).join(', ');
  const toneColor = (tone: ContextRow['tone']) =>
    tone === 'over' ? colors.red : tone === 'near' ? colors.orange : colors.accent;

  const renderMark = (mark: BiostatsMark) => (
    <View key={mark.id} style={styles.mark}>
      <View style={styles.markLabelRow}>
        <Text style={styles.markLabel} numberOfLines={1}>{mark.label}</Text>
        <Text
          style={[
            styles.markValue,
            mark.tone === 'over' && { color: colors.redText },
            mark.tone === 'near' && { color: colors.orangeText },
          ]}
          numberOfLines={1}
        >
          {mark.value}
        </Text>
      </View>
      <ProgressBar progress={mark.fraction} height={BAR_HEIGHT} color={toneColor(mark.tone)} decorative />
    </View>
  );

  const radiusPx = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radiusPx;

  const foldedContent = (
    <View style={styles.marks}>
      {marks.ring && (
        <View style={styles.ring} importantForAccessibility="no-hide-descendants">
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={radiusPx} fill="none" stroke={colors.bgTertiary} strokeWidth={RING_STROKE} />
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={radiusPx}
              fill="none"
              stroke={colors.accent}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${circumference * marks.ring.fraction} ${circumference}`}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </Svg>
          <Text style={styles.ringLabel}>{marks.ring.label}</Text>
        </View>
      )}
      {/* With no bar beside it the ring would sit alone in an empty row, so it
          says what it measures. With bars the row is full and the percentage is enough. */}
      {marks.ring && marks.bars.length === 0 && (
        <View style={styles.ringCaption}>
          <Text style={styles.markLabel} numberOfLines={1}>{marks.ring.name}</Text>
          {!!marks.ring.detail && <Text style={styles.ringDetail} numberOfLines={1}>{marks.ring.detail}</Text>}
        </View>
      )}
      {marks.bars.map(renderMark)}
      {!marks.ring && marks.bars.length === 0 && (
        <Text style={styles.fallback} numberOfLines={2}>{marks.text}</Text>
      )}
    </View>
  );

  const openHeader = (
    <View style={styles.openHeader}>
      <Ionicons name="stats-chart-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={styles.openLabel}>Biostats</Text>
    </View>
  );

  return (
    <View style={[styles.card, shadows.card]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => { haptics.tap(); onToggle(); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={`Biostats. ${spoken}`}
        accessibilityHint={collapsed ? 'Shows every reading' : 'Folds to a summary'}
        accessibilityState={{ expanded: !collapsed }}
      >
        <View style={styles.headerBody}>{collapsed ? foldedContent : openHeader}</View>
        <RotatingChevron open={!collapsed} closed="forward" size={iconSize.sm} color={colors.textTertiary} />
      </TouchableOpacity>
      <AnimatedCollapsible expanded={!collapsed} lazy>
        <View style={styles.grid}>
          {rows.map(row => {
            if (row.visual?.type === 'rings') {
              const rings = row.visual.rings;
              return (
                <View key={row.id} style={[styles.tile, styles.tileWide, styles.ringsTile]} accessible accessibilityLabel={row.title}>
                  <View style={styles.legend}>
                    {RING_ORDER.filter(id => (rings[id].value ?? 0) > 0).map(id => (
                      <View key={id} style={styles.legendRow}>
                        <View style={[styles.legendDot, { backgroundColor: ringColor(id, colors) }]} />
                        <Text style={styles.legendText} numberOfLines={1}>{describeRing(id, rings[id])}</Text>
                      </View>
                    ))}
                  </View>
                  <ActivityRingsGlyph rings={rings} size={44} stroke={6} gap={2} />
                </View>
              );
            }
            const reading = row.reading;
            if (!reading) return null;
            const key = row.nutrientKey;
            const body = (
              <>
                <Text style={styles.tileLabel} numberOfLines={1}>{reading.label}</Text>
                <Text
                  style={[
                    styles.tileFigure,
                    row.tone === 'over' && { color: colors.redText },
                    row.tone === 'near' && { color: colors.orangeText },
                  ]}
                  numberOfLines={1}
                >
                  {reading.figure}
                  {reading.of ? <Text style={styles.tileOf}>{` / ${reading.of}`}</Text> : null}
                </Text>
                {row.visual?.type === 'bar' && (
                  <ProgressBar
                    progress={row.visual.fraction}
                    height={BAR_HEIGHT}
                    color={row.visual.hue === 'move' ? colors.red : toneColor(row.tone)}
                    trackColor={colors.separator}
                    decorative
                  />
                )}
              </>
            );
            return key ? (
              <TouchableOpacity
                key={row.id}
                style={styles.tile}
                onPress={() => { haptics.tap(); onNutrientPress(key); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={row.title}
                accessibilityHint="Shows which foods contributed"
              >
                {body}
              </TouchableOpacity>
            ) : (
              <View key={row.id} style={styles.tile} accessible accessibilityLabel={row.title}>{body}</View>
            );
          })}
        </View>
      </AnimatedCollapsible>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // The same card edge a task row and a context row have, in the list header's
  // margins (OnCallStrip, MealStrip).
  card: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.bgSecondary,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    minHeight: ROW_MIN_HEIGHT,
    paddingHorizontal: spacing.smd,
    paddingVertical: spacing.sm,
  },
  headerBody: { flex: 1, justifyContent: 'center' },
  marks: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ring: { width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center' },
  ringLabel: {
    position: 'absolute',
    fontSize: font.xxs,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  ringCaption: { flex: 1, minWidth: 0 },
  ringDetail: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text, fontVariant: ['tabular-nums'] },
  mark: { flex: 1, minWidth: 0 },
  markLabelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs, marginBottom: spacing.xs },
  markLabel: { flexShrink: 1, fontSize: font.xs, color: colors.textSecondary },
  markValue: { fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.text, fontVariant: ['tabular-nums'] },
  fallback: { fontSize: font.md, color: colors.textSecondary },
  openHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Section-label treatment: uppercase xs semibold textSecondary.
  openLabel: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.smd,
    paddingBottom: spacing.smd,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 0,
    padding: spacing.smd,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.bgTertiary,
  },
  tileWide: { flexBasis: '100%' },
  tileLabel: { fontSize: font.xs, color: colors.textSecondary },
  tileFigure: {
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xxs,
    marginBottom: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  tileOf: { fontSize: font.xs, fontWeight: fontWeight.regular, color: colors.textSecondary },
  ringsTile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.smd },
  legend: { flex: 1, gap: spacing.xxs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xsm },
  legendDot: { width: 8, height: 8, borderRadius: radius.full },
  legendText: { fontSize: font.sm, color: colors.text },
});
