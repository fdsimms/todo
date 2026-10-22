import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { TaskAttachment } from '../types';
import { ActionMenu } from './ActionMenu';
import { FadeInImage } from './FadeInImage';
import { InlineAction } from './InlineAction';
import { PhotoViewer } from './PhotoViewer';
import { useSheetMount } from '../hooks/useSheetMount';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { afterMenuDismissed } from '../utils/sheetModal';
import { alertPermissionOff } from '../utils/permissionAlert';
import { pickPhotoIntoFolder, storedFileName, type RecipePhotoSource } from '../utils/recipePhoto';
import { MAX_TASK_ATTACHMENTS, TASK_FILE_FOLDER, attachmentBadge, taskAttachmentsOnDevice } from '../utils/taskFiles';
import { openTaskFile, pickTaskDocument } from '../utils/taskFilePick';

interface Props {
  attachments: readonly TaskAttachment[];
  /** The viewer's title: the task's. */
  title: string;
  /** Given in the editor; a read-only strip (the expanded row) leaves both out. */
  onAdd?: (attachment: TaskAttachment) => void;
  onRemove?: (name: string) => void;
  size?: number;
}

/**
 * A task's photos and files as a row of tiles: a photo's thumbnail, or a
 * document's extension and name. A photo opens the full-width viewer and a
 * document the share sheet, which previews it. A file that hasn't arrived from
 * another device yet is drawn faded and says so when tapped.
 *
 * In the editor it also adds (camera, library, or a document) and removes.
 * Removing only drops the name: the file stays until the launch sweep finds
 * nothing naming it, so an undo of the edit has a file to come back to.
 */
export function TaskAttachmentStrip({ attachments, title, onAdd, onRemove, size = 64 }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const shown = useMemo(() => taskAttachmentsOnDevice(attachments), [attachments]);
  const photos = shown.filter(a => a.kind === 'photo' && a.present);
  const [viewing, setViewing] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const mountViewer = useSheetMount(viewing !== null);
  const mountMenu = useSheetMount(menuOpen);
  const editable = !!onAdd;

  if (!editable && shown.length === 0) return null;

  const pickPhoto = async (source: RecipePhotoSource) => {
    await afterMenuDismissed();
    const result = await pickPhotoIntoFolder(TASK_FILE_FOLDER, source);
    if (result.status === 'canceled') return;
    if (result.status === 'denied') {
      alertPermissionOff(
        source === 'camera' ? 'Camera access is off' : 'Photo access is off',
        'Turn it on in Settings to add a photo to this task.',
      );
      return;
    }
    if (result.status === 'failed') { Alert.alert('Couldn’t add the photo', result.message); return; }
    const name = storedFileName(result.image.uri);
    if (name) { haptics.success(); onAdd?.({ name, kind: 'photo', title: 'Photo' }); }
  };

  const pickFile = async () => {
    await afterMenuDismissed();
    const result = await pickTaskDocument(attachments.length);
    if (result.status === 'canceled') return;
    if (result.status === 'refused') { Alert.alert('Couldn’t add the file', result.message); return; }
    if (result.status === 'failed') { Alert.alert('Couldn’t add the file', result.message); return; }
    haptics.success();
    onAdd?.({ name: result.name, kind: 'file', title: result.title });
  };

  const open = (item: (typeof shown)[number]) => {
    if (!item.present) {
      Alert.alert('Not on this device yet', 'It will arrive the next time your other device syncs.');
      return;
    }
    haptics.tap();
    if (item.kind === 'photo') {
      setViewing(photos.findIndex(p => p.name === item.name));
      return;
    }
    void openTaskFile(item.uri, item.title).then(opened => {
      if (!opened) Alert.alert('Couldn’t open the file', 'Nothing on this device can show it.');
    });
  };

  return (
    <View style={styles.wrap}>
      {shown.length > 0 && (
        <View style={styles.row}>
          {shown.map((item, index) => (
            <View key={item.name} style={{ width: size }}>
              <TouchableOpacity
                onPress={() => open(item)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={item.kind === 'photo'
                  ? `Photo ${index + 1}${item.present ? '' : ', not on this device yet'}`
                  : `${item.title}${item.present ? '' : ', not on this device yet'}`}
                style={!item.present && styles.missing}
              >
                {item.kind === 'photo' && item.present ? (
                  <FadeInImage source={{ uri: item.uri }} style={[styles.tile, { width: size, height: size }]} resizeMode="cover" />
                ) : (
                  <View style={[styles.tile, styles.fileTile, { width: size, height: size }]}>
                    <Ionicons
                      name={item.kind === 'photo' ? 'image-outline' : 'document-outline'}
                      size={iconSize.md}
                      color={colors.textSecondary}
                    />
                    {item.kind === 'file' && <Text style={styles.badge}>{attachmentBadge(item.title)}</Text>}
                  </View>
                )}
              </TouchableOpacity>
              {item.kind === 'file' && (
                <Text style={styles.fileName} numberOfLines={1}>{item.title}</Text>
              )}
              {!!onRemove && (
                <TouchableOpacity
                  style={styles.remove}
                  onPress={() => { haptics.tap(); onRemove(item.name); }}
                  hitSlop={8}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={item.kind === 'photo' ? `Remove photo ${index + 1}` : `Remove ${item.title}`}
                >
                  <Ionicons name="close" size={12} color={colors.onFill} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
      {editable && attachments.length < MAX_TASK_ATTACHMENTS && (
        <InlineAction
          icon="attach-outline"
          label="Add photo or file"
          surface="card"
          style={styles.add}
          onPress={() => setMenuOpen(true)}
        />
      )}
      {mountMenu && <ActionMenu
        visible={menuOpen}
        title="Add to this task"
        actions={[
          { key: 'camera', label: 'Take a photo', icon: 'camera-outline', onPress: () => { void pickPhoto('camera'); } },
          { key: 'library', label: 'Choose from library', icon: 'images-outline', onPress: () => { void pickPhoto('library'); } },
          { key: 'file', label: 'Choose a file', icon: 'document-outline', onPress: () => { void pickFile(); } },
        ]}
        onClose={() => setMenuOpen(false)}
      />}
      {mountViewer && <PhotoViewer
        visible={viewing !== null}
        initialIndex={viewing ?? 0}
        title={title}
        shots={photos.map((p, i) => ({ key: p.name, uri: p.uri, label: `Photo ${i + 1}. Tap to close.` }))}
        sheetName="TaskPhotoViewer"
        onClose={() => setViewing(null)}
      />}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { borderRadius: radius.sm, backgroundColor: colors.bgTertiary },
  fileTile: { alignItems: 'center', justifyContent: 'center', gap: spacing.xxs },
  badge: { color: colors.textSecondary, fontSize: font.xxs, fontWeight: fontWeight.semibold },
  fileName: { color: colors.textSecondary, fontSize: font.xxs, marginTop: spacing.xxs },
  missing: { opacity: 0.5 },
  remove: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.backdrop,
  },
  add: { alignSelf: 'flex-start' },
});
