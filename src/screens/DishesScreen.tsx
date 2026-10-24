import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import type { DishRating, DishVerdict } from '../types';
import { useDishRatingStore } from '../store/useDishRatingStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { EmptyNote } from '../components/EmptyNote';
import { SegmentedControl } from '../components/SegmentedControl';
import { FadeInImage } from '../components/FadeInImage';
import { Fab, FAB_SIZE } from '../components/Fab';
import { DishSheet } from '../components/DishSheet';
import { ScrollToTopButton } from '../components/ScrollToTopButton';
import { useSheetMount } from '../hooks/useSheetMount';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dishPhotoUri } from '../utils/dishPhotos';
import { DISH_VERDICT_LABELS, groupDishesByPlace, type DishPlaceGroup } from '../utils/dishRating';

type Answer = DishVerdict | 'all';

const ANSWER_OPTIONS: { value: Answer; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'loved', label: 'Loved' },
  { value: 'fine', label: 'Fine' },
  { value: 'avoid', label: 'Avoid' },
];

const THUMB_SIZE = 44;

interface Section {
  key: string;
  title: string;
  data: DishRating[];
}

/**
 * What you ordered at restaurants and whether you would order it again — see
 * `DishRating` in `types/index.ts`.
 *
 * Grouped under the place each dish was had at, places alphabetical with the
 * dishes that have none last, and loved before fine before avoid inside each
 * (`groupDishesByPlace`). The filter narrows by answer. A dish with no answer
 * yet shows in All only, which is what "no opinion" means: it is neither of
 * the three.
 */
export function DishesScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const dishes = useDishRatingStore(s => s.dishes);
  const [answer, setAnswer] = useState<Answer>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DishRating | null>(null);
  const mountSheet = useSheetMount(sheetOpen);
  const scrollTop = useListScrollToTop();

  const groups: DishPlaceGroup[] = useMemo(
    () => groupDishesByPlace(dishes, answer === 'all' ? null : answer),
    [dishes, answer],
  );
  const sections: Section[] = useMemo(
    () => groups.map(g => ({ key: g.placeKey || 'none', title: g.place ?? 'No place', data: g.dishes })),
    [groups],
  );

  const openNew = () => { haptics.tap(); setEditing(null); setSheetOpen(true); };
  const openEdit = useCallback((dish: DishRating) => { haptics.tap(); setEditing(dish); setSheetOpen(true); }, []);

  const renderItem = ({ item, index, section }: { item: DishRating; index: number; section: Section }) => (
    <DishRow
      dish={item}
      first={index === 0}
      last={index === section.data.length - 1}
      colors={colors}
      styles={styles}
      onOpen={openEdit}
    />
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Dishes"
        subtitle={dishes.length > 0 ? `${dishes.length} ${dishes.length === 1 ? 'dish' : 'dishes'}` : undefined}
      />
      <HubPills hub="kitchen" active="Dishes" />

      {dishes.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="No dishes yet"
          subtitle="Keep track of what you ordered at a restaurant and whether you would order it again."
          actionLabel="Add a dish"
          onAction={openNew}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <>
          <View style={styles.filter}>
            <SegmentedControl<Answer>
              label="Show dishes"
              surface="page"
              options={ANSWER_OPTIONS}
              value={answer}
              onChange={setAnswer}
            />
          </View>
          <SectionList
            ref={scrollTop.ref}
            refreshControl={pullSearch.refreshControl}
            {...scrollTop.listProps}
            sections={sections}
            keyExtractor={d => d.id}
            renderItem={renderItem}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader} numberOfLines={1}>{section.title}</Text>
            )}
            stickySectionHeadersEnabled={false}
            ListEmptyComponent={
              <View style={styles.emptyFilter}>
                <EmptyNote icon="restaurant-outline">
                  {`No dishes marked “${DISH_VERDICT_LABELS[answer as DishVerdict] ?? ''}” yet.`}
                </EmptyNote>
              </View>
            }
            contentContainerStyle={{ paddingBottom: tabBarHeight + FAB_SIZE + spacing.xl }}
          />
        </>
      )}

      <Fab onPress={openNew} accessibilityLabel="Add dish" />

      {mountSheet && (
        <DishSheet
          visible={sheetOpen}
          dish={editing}
          onClose={() => setSheetOpen(false)}
        />
      )}

      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

/** The answer as a small pill, in the same three tints the Recipes vote uses. */
function verdictPill(verdict: DishVerdict, colors: Colors) {
  if (verdict === 'loved') return { bg: colors.accentSubtle, fg: colors.accentText };
  if (verdict === 'fine') return { bg: colors.bgTertiary, fg: colors.textSecondary };
  return { bg: colors.red + '1F', fg: colors.redText };
}

const DishRow = React.memo(function DishRow({
  dish, first, last, colors, styles, onOpen,
}: {
  dish: DishRating;
  first: boolean;
  last: boolean;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
  onOpen: (dish: DishRating) => void;
}) {
  const photoUri = dishPhotoUri(dish.photo);
  const detail = dish.note
    ?? (dish.lastHadAt ? `Last had ${format(new Date(dish.lastHadAt), 'MMM d')}` : null);
  const pill = dish.verdict ? verdictPill(dish.verdict, colors) : null;
  const spoken = [
    dish.name,
    dish.verdict ? DISH_VERDICT_LABELS[dish.verdict] : 'No answer yet',
    dish.place,
    detail,
  ].filter(Boolean).join('. ');

  return (
    <TouchableOpacity
      style={[styles.row, first && styles.rowFirst, last ? styles.rowLast : styles.rowDivider]}
      onPress={() => onOpen(dish)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={spoken}
    >
      {photoUri && <FadeInImage source={{ uri: photoUri }} style={styles.thumb} resizeMode="cover" />}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{dish.name}</Text>
        {detail && <Text style={styles.detail} numberOfLines={1}>{detail}</Text>}
      </View>
      {pill && dish.verdict && (
        <View style={[styles.pill, { backgroundColor: pill.bg }]}>
          <Text style={[styles.pillText, { color: pill.fg }]} numberOfLines={1}>{DISH_VERDICT_LABELS[dish.verdict]}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  filter: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.md + spacing.xs,
  },
  emptyFilter: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  // One card per place: the first and last rows round their outer corners and
  // every row but the last draws the divider, so the group reads as one card.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
  },
  rowFirst: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  rowLast: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: radius.sm, backgroundColor: colors.bgTertiary },
  info: { flex: 1, gap: spacing.xxs },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  detail: { color: colors.textSecondary, fontSize: font.sm },
  pill: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  pillText: { fontSize: font.xxs, fontWeight: fontWeight.semibold },
});
