import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FadeInImage } from './FadeInImage';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { exercisePhotos } from '../utils/exerciseImages';

/**
 * The start and end photos on an exercise's page, for a built-in exercise the
 * map has photos for (`src/utils/exerciseImages.ts`).
 *
 * Renders nothing in three cases, and the page reads the same as it did before
 * photos existed: the setting is off (it ships off, and nothing is requested
 * until it's on), the exercise has none, or a photo failed to load. A failed
 * load hides the pair rather than leaving one photo beside an empty box, so an
 * offline phone sees the cue and nothing that looks broken.
 */
export function ExercisePhotos({ exerciseId, name }: { exerciseId: string; name: string }) {
  const enabled = useSettingsStore(s => s.exerciseImagesEnabled);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const photos = enabled ? exercisePhotos(exerciseId) : null;
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [exerciseId]);

  if (!photos || failed) return null;
  const shots = [
    { uri: photos.start, caption: 'Start' },
    { uri: photos.end, caption: 'End' },
  ];
  return (
    <View style={styles.row}>
      {shots.map(shot => (
        <View key={shot.caption} style={styles.shot}>
          <FadeInImage
            source={{ uri: shot.uri }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setFailed(true)}
            accessibilityLabel={`${name}, ${shot.caption.toLowerCase()} position`}
          />
          <Text style={styles.caption}>{shot.caption}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.smd },
  shot: { flex: 1, gap: spacing.xs },
  // The dataset's photos are all 850 by 567.
  image: { width: '100%', aspectRatio: 3 / 2, borderRadius: radius.md, backgroundColor: colors.bgSecondary },
  caption: { color: colors.textSecondary, fontSize: font.xxs, textAlign: 'center' },
});
