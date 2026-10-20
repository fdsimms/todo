import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FadeInImage } from './FadeInImage';
import { SheetModal } from './SheetModal';
import { RotatingChevron } from './RotatingChevron';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { darkColors, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { exercisePhotos } from '../utils/exerciseImages';
import { animateLayout } from '../utils/layoutAnimation';
import { haptics } from '../utils/haptics';

/**
 * The start and end photos on an exercise's page, for a built-in exercise the
 * map has photos for (`src/utils/exerciseImages.ts`).
 *
 * Renders nothing in three cases, and the page reads the same as it did before
 * photos existed: the setting is off (it ships off, and nothing is requested
 * until it's on), the exercise has none, or a photo failed to load. A failed
 * load hides the pair rather than leaving one photo beside an empty box, so an
 * offline phone sees the cue and nothing that looks broken.
 *
 * With `onToggle` the pair sits behind a "Show form photos" row and `open` says
 * which way it is. That is workout mode's shape: its sets are the point of the
 * screen, so photos add nothing above them until asked for, and the host keeps
 * `open` for the session so it stays open from one exercise to the next. The
 * exercise's own page passes neither and shows the pair.
 *
 * Tapping a photo opens it full width on black, with the other one a swipe
 * away. The viewer is always black in every theme, the way a photo viewer is,
 * so it reads `darkColors.bg` rather than the current theme's page colour.
 */
export function ExercisePhotos({ exerciseId, name, open = true, onToggle }: {
  exerciseId: string;
  name: string;
  open?: boolean;
  onToggle?: () => void;
}) {
  const enabled = useSettingsStore(s => s.exerciseImagesEnabled);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const photos = enabled ? exercisePhotos(exerciseId) : null;
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  // Kept after the viewer closes so its content stays put while it fades.
  const lastViewed = useRef(0);
  if (viewing !== null) lastViewed.current = viewing;

  useEffect(() => { setFailed(false); }, [exerciseId]);

  if (!photos || failed) return null;
  const shots = [
    { uri: photos.start, caption: 'Start' },
    { uri: photos.end, caption: 'End' },
  ];
  const pair = (
    <View style={styles.row}>
      {shots.map((shot, i) => (
        <TouchableOpacity
          key={shot.caption}
          style={styles.shot}
          onPress={() => { haptics.tap(); setViewing(i); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Enlarge ${name}, ${shot.caption.toLowerCase()} position`}
        >
          <FadeInImage
            source={{ uri: shot.uri }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setFailed(true)}
            accessibilityLabel={`${name}, ${shot.caption.toLowerCase()} position`}
          />
          <Text style={styles.caption}>{shot.caption}</Text>
        </TouchableOpacity>
      ))}
      <PhotoViewer
        visible={viewing !== null}
        initialIndex={lastViewed.current}
        name={name}
        shots={shots}
        onClose={() => setViewing(null)}
      />
    </View>
  );
  if (!onToggle) return pair;
  return (
    <View>
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => { haptics.tap(); animateLayout(); onToggle(); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? 'Hide' : 'Show'} form photos for ${name}`}
      >
        <Text style={styles.toggleText}>{open ? 'Hide form photos' : 'Show form photos'}</Text>
        <RotatingChevron open={open} size={iconSize.sm} color={colors.accentText} />
      </TouchableOpacity>
      {open && pair}
    </View>
  );
}

/**
 * The full-width viewer. Pages are one window wide inside a paging
 * `ScrollView`, so the swipe between Start and End is the platform's own. The
 * width is measured rather than read from `Dimensions`, since the app can be a
 * column narrower than the window on an iPad.
 */
function PhotoViewer({ visible, initialIndex, name, shots, onClose }: {
  visible: boolean;
  initialIndex: number;
  name: string;
  shots: { uri: string; caption: string }[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(initialIndex);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { if (visible) setPage(initialIndex); }, [visible, initialIndex]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w === width) return;
    setWidth(w);
    scrollRef.current?.scrollTo({ x: initialIndex * w, animated: false });
  };
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <SheetModal
      name="ExercisePhotoViewer"
      visible={visible}
      presentationStyle="fullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={viewerStyles.root} onLayout={onLayout}>
        <View style={[viewerStyles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={viewerStyles.headerSide} />
          <Text style={viewerStyles.title} numberOfLines={1}>{name}</Text>
          <View style={viewerStyles.headerSide}>
            <TouchableOpacity
              style={viewerStyles.close}
              onPress={onClose}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
            >
              <Ionicons name="close" size={iconSize.md} color={darkColors.text} />
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          style={viewerStyles.pager}
          contentContainerStyle={viewerStyles.pagerContent}
        >
          {shots.map(shot => (
            <TouchableOpacity
              key={shot.caption}
              style={{ width }}
              onPress={onClose}
              activeOpacity={1}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${shot.caption.toLowerCase()} position. Tap to close.`}
            >
              <FadeInImage source={{ uri: shot.uri }} style={viewerStyles.image} resizeMode="contain" />
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={[viewerStyles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={viewerStyles.caption}>{shots[page]?.caption}</Text>
          <View style={viewerStyles.dots}>
            {shots.map((shot, i) => (
              <View key={shot.caption} style={[viewerStyles.dot, i === page && viewerStyles.dotActive]} />
            ))}
          </View>
        </View>
      </View>
    </SheetModal>
  );
}

const viewerStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: darkColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerSide: { width: 44, alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', color: darkColors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  close: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: darkColors.bgTertiary },
  pager: { flex: 1 },
  pagerContent: { alignItems: 'center' },
  // The dataset's photos are all 850 by 567.
  image: { width: '100%', aspectRatio: 3 / 2 },
  footer: { alignItems: 'center', gap: spacing.smd, paddingTop: spacing.md },
  caption: { color: darkColors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  dots: { flexDirection: 'row', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: darkColors.textTertiary },
  dotActive: { backgroundColor: darkColors.text },
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.smd },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm },
  toggleText: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
  shot: { flex: 1, gap: spacing.xs },
  // The dataset's photos are all 850 by 567.
  image: { width: '100%', aspectRatio: 3 / 2, borderRadius: radius.md, backgroundColor: colors.bgSecondary },
  caption: { color: colors.textSecondary, fontSize: font.xxs, textAlign: 'center' },
});
