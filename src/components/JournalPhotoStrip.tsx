import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActionMenu } from './ActionMenu';
import { FadeInImage } from './FadeInImage';
import { PhotoViewer } from './PhotoViewer';
import { useSheetMount } from '../hooks/useSheetMount';
import type { CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { afterMenuDismissed } from '../utils/sheetModal';
import { alertPermissionOff } from '../utils/permissionAlert';
import { pickPhotoIntoFolder, storedFileName, type RecipePhotoSource } from '../utils/recipePhoto';
import { JOURNAL_PHOTO_FOLDER, MAX_JOURNAL_PHOTOS, journalPhotosOnDevice } from '../utils/journalPhotos';

interface Props {
  /** File names in the journal photo folder. Names whose file isn't here are left out. */
  photos: readonly string[];
  /** The viewer's title. */
  title: string;
  /** Omitted for a read-only strip (the journal list); given in the entry sheet. */
  onAdd?: (name: string) => void;
  onRemove?: (name: string) => void;
  /** Thumbnail edge, in points. */
  size?: number;
}

/**
 * A journal entry's photos as a row of thumbnails, each opening the full-width
 * viewer. In the entry sheet it also takes a photo or picks one, and each
 * thumbnail carries a remove button; the sheet decides what a removal means
 * (nothing is deleted until the entry is saved, see `useJournalStore`).
 */
export function JournalPhotoStrip({ photos, title, onAdd, onRemove, size = 64 }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const shown = useMemo(() => journalPhotosOnDevice({ photos: [...photos] }), [photos]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<CardAnchor | null>(null);
  const editable = !!onAdd;
  // Mounted on first use and kept: in the journal list every row has a strip,
  // and a closed viewer still costs a mounted component per row.
  const mountViewer = useSheetMount(viewing !== null);
  const mountMenu = useSheetMount(menuAnchor !== null);

  if (!editable && shown.length === 0) return null;

  const pick = async (source: RecipePhotoSource) => {
    await afterMenuDismissed();
    const result = await pickPhotoIntoFolder(JOURNAL_PHOTO_FOLDER, source);
    if (result.status === 'canceled') return;
    if (result.status === 'denied') {
      alertPermissionOff(
        source === 'camera' ? 'Camera access is off' : 'Photo access is off',
        'Turn it on in Settings to add a photo to this entry.',
      );
      return;
    }
    if (result.status === 'failed') {
      Alert.alert('Couldn’t add the photo', result.message);
      return;
    }
    const name = storedFileName(result.image.uri);
    if (name) { haptics.success(); onAdd?.(name); }
  };

  return (
    <View style={styles.row}>
      {shown.map((photo, index) => (
        <View key={photo.name} style={{ width: size, height: size }}>
          <TouchableOpacity
            onPress={() => { haptics.tap(); setViewing(index); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Photo ${index + 1} of ${shown.length}. Opens full size.`}
          >
            <FadeInImage source={{ uri: photo.uri }} style={[styles.thumb, { width: size, height: size }]} resizeMode="cover" />
          </TouchableOpacity>
          {!!onRemove && (
            <TouchableOpacity
              style={styles.remove}
              onPress={() => { haptics.tap(); onRemove(photo.name); }}
              hitSlop={8}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${index + 1}`}
            >
              <Ionicons name="close" size={12} color={colors.onFill} />
            </TouchableOpacity>
          )}
        </View>
      ))}
      {editable && photos.length < MAX_JOURNAL_PHOTOS && (
        <TouchableOpacity
          style={[styles.add, { width: size, height: size }]}
          onPress={(e: GestureResponderEvent) => {
            haptics.tap();
            setMenuAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
          }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Add a photo"
        >
          <Ionicons name="camera-outline" size={iconSize.md} color={colors.accentText} />
        </TouchableOpacity>
      )}
      {mountMenu && <ActionMenu
        visible={menuAnchor !== null}
        title="Add a photo"
        anchor={menuAnchor}
        actions={[
          { key: 'camera', label: 'Take a photo', icon: 'camera-outline', onPress: () => { void pick('camera'); } },
          { key: 'library', label: 'Choose from library', icon: 'images-outline', onPress: () => { void pick('library'); } },
        ]}
        onClose={() => setMenuAnchor(null)}
      />}
      {mountViewer && <PhotoViewer
        visible={viewing !== null}
        initialIndex={viewing ?? 0}
        title={title}
        shots={shown.map((photo, i) => ({ key: photo.name, uri: photo.uri, label: `Photo ${i + 1}. Tap to close.` }))}
        sheetName="JournalPhotoViewer"
        onClose={() => setViewing(null)}
      />}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { borderRadius: radius.sm, backgroundColor: colors.bgTertiary },
  remove: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backdrop,
  },
  add: {
    borderRadius: radius.sm, backgroundColor: colors.bgTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
});
