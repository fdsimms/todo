import { StyleSheet } from 'react-native';
import { spacing, radius, font, fontWeight, type Colors } from '../../theme';
import { disclosureValue } from '../../theme/textStyles';

/**
 * One stylesheet for every settings group, so eight files can't drift apart on
 * row padding or pill tint the way eighteen inline sections were starting to.
 */
export const makeSettingsStyles = (colors: Colors) => StyleSheet.create({
  section: { paddingHorizontal: spacing.md, marginTop: spacing.xl },
  sectionLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: spacing.sm, paddingHorizontal: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden',
  },
  sectionFooter: {
    color: colors.textTertiary, fontSize: font.sm,
    paddingHorizontal: spacing.sm, marginTop: spacing.sm, lineHeight: 19,
    marginBottom: spacing.sm,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  // A row sitting directly on top of its own pill row: the pills carry the
  // bottom padding, so the label mustn't double it.
  rowTight: { paddingBottom: spacing.xs },
  rowStacked: { alignItems: 'flex-start', paddingVertical: spacing.md },
  rowContent: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: font.md },
  rowHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  rowValue: disclosureValue(colors),
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },

  pillRow: { flexDirection: 'row', padding: spacing.sm, gap: spacing.sm },
  pillRowAttached: { paddingTop: 0 },
  // A stepper paired with its own unit pills, sitting under a `tight` row —
  // the unit pills stay one group and wrap together rather than splitting off
  // on their own at a narrow width (same idiom as ProjectEditor's cadenceRow).
  cadenceRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  cadenceUnitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  pillActive: { backgroundColor: colors.accent + '22' },
  pillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  pillTextActive: { color: colors.accent, fontWeight: fontWeight.semibold },

  toggle: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: colors.bgTertiary,
    justifyContent: 'center', padding: 2,
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textSecondary },
  toggleKnobOn: { backgroundColor: colors.onAccent, alignSelf: 'flex-end' },

  picker: { height: 180 },
  pickerButtons: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
  },
  pickerBtn: {
    flex: 1, paddingVertical: 11, borderRadius: radius.md,
    alignItems: 'center', backgroundColor: colors.bgTertiary,
  },
  pickerBtnPrimary: { backgroundColor: colors.accent },
  pickerBtnText: { fontSize: font.md, fontWeight: fontWeight.semibold },

  // Fixed width so the "Aa" specimens line up down the column even though the
  // faces are different widths — a condensed sample is much narrower than a mono one.
  fontSample: { width: 34, color: colors.textSecondary, fontSize: font.xl, textAlign: 'center' },
  fontSampleActive: { color: colors.accent },
  fontName: { color: colors.text, fontSize: font.md },
  fontNameActive: { color: colors.accent, fontWeight: fontWeight.semibold },

  apiKeyInput: {
    fontSize: font.sm, marginTop: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 6, paddingTop: 2,
  },
});

export type SettingsStyles = ReturnType<typeof makeSettingsStyles>;
