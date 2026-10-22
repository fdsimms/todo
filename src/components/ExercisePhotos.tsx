import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FadeInImage } from './FadeInImage';
import { PhotoViewer } from './PhotoViewer';
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
 * so `PhotoViewer` reads `darkColors.bg` rather than the current theme's page colour.
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
        title={name}
        sheetName="ExercisePhotoViewer"
        shots={shots.map(shot => ({ key: shot.caption, uri: shot.uri, caption: shot.caption, label: `${name}, ${shot.caption.toLowerCase()} position. Tap to close.` }))}
        // The dataset's photos are all 850 by 567.
        aspectRatio={3 / 2}
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

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.smd },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', marginTop: spacing.sm },
  toggleText: { color: colors.accentText, fontSize: font.sm, fontWeight: fontWeight.semibold },
  shot: { flex: 1, gap: spacing.xs },
  // The dataset's photos are all 850 by 567.
  image: { width: '100%', aspectRatio: 3 / 2, borderRadius: radius.md, backgroundColor: colors.bgSecondary },
  caption: { color: colors.textSecondary, fontSize: font.xxs, textAlign: 'center' },
});
