import React, { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FadeInImage } from './FadeInImage';
import { SheetModal } from './SheetModal';
import { darkColors, font, fontWeight, iconSize, interaction, radius, spacing } from '../theme';

export interface PhotoViewerShot {
  key: string;
  uri: string;
  /** Under the photo while it is the one showing. */
  caption?: string;
  /** The page's accessibility label. */
  label: string;
}

interface Props {
  visible: boolean;
  initialIndex: number;
  title: string;
  shots: readonly PhotoViewerShot[];
  /** Every shot's shape when known (the exercise library's are 3:2); otherwise each fills the page, letterboxed. */
  aspectRatio?: number;
  /** `SheetModal`'s name, for its clash report. */
  sheetName?: string;
  onClose: () => void;
}

/**
 * The full-width photo viewer: an exercise's form photos, a journal entry's
 * photos, a task's attachments. Pages are one window wide inside a paging
 * `ScrollView`, so the swipe between photos is the platform's own. The width is
 * measured rather than read from `Dimensions`, since the app can be a column
 * narrower than the window on an iPad. Always the dark palette: a photo is
 * looked at against black whatever theme is on.
 */
export function PhotoViewer({ visible, initialIndex, title, shots, aspectRatio, sheetName = 'PhotoViewer', onClose }: Props) {
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

  const caption = shots[page]?.caption;
  return (
    <SheetModal
      name={sheetName}
      visible={visible}
      presentationStyle="fullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.root} onLayout={onLayout}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.headerSide} />
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <View style={styles.headerSide}>
            <TouchableOpacity
              style={styles.close}
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
          style={styles.pager}
          contentContainerStyle={styles.pagerContent}
        >
          {shots.map(shot => (
            <TouchableOpacity
              key={shot.key}
              style={[{ width }, aspectRatio === undefined && styles.pageFill]}
              onPress={onClose}
              activeOpacity={1}
              accessibilityRole="button"
              accessibilityLabel={shot.label}
            >
              <FadeInImage
                source={{ uri: shot.uri }}
                style={aspectRatio === undefined ? styles.imageFill : [styles.image, { aspectRatio }]}
                resizeMode="contain"
              />
            </TouchableOpacity>
          ))}
        </ScrollView>
        {(!!caption || shots.length > 1) && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            {!!caption && <Text style={styles.caption}>{caption}</Text>}
            {shots.length > 1 && (
              <View style={styles.dots}>
                {shots.map((shot, i) => (
                  <View key={shot.key} style={[styles.dot, i === page && styles.dotActive]} />
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: darkColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  headerSide: { width: 44, alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', color: darkColors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  close: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: darkColors.bgTertiary },
  pager: { flex: 1 },
  pagerContent: { alignItems: 'center' },
  pageFill: { height: '100%' },
  image: { width: '100%' },
  imageFill: { width: '100%', height: '100%' },
  footer: { alignItems: 'center', gap: spacing.smd, paddingTop: spacing.md },
  caption: { color: darkColors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  dots: { flexDirection: 'row', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: darkColors.textTertiary },
  dotActive: { backgroundColor: darkColors.text },
});
