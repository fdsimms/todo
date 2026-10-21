import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { HelpText } from './HelpText';
import { TextField } from './TextField';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useColors } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { WORKOUT_NAME_MAX_LENGTH } from '../utils/workoutData';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  versionId: string | null;
  /** What it is called now, or null for no name yet. */
  current: string | null;
  onClose: () => void;
}

/** A name for one version of a routine ("Shoulder-friendly"). Saving it blank takes the name off. */
export function VersionLabelSheet({ visible, versionId, current, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (visible) setLabel(current ?? '');
  }, [visible, current]);

  const save = () => {
    if (versionId) useWorkoutStore.getState().labelRoutineVersion(versionId, label);
    haptics.success();
    dismiss();
  };

  return (
    <CardSheet name="VersionLabelSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title="Name this version"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} />}
        />
        <View style={styles.body}>
          <TextField
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="e.g. Shoulder-friendly"
            placeholderTextColor={colors.textTertiary}
            maxLength={WORKOUT_NAME_MAX_LENGTH}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            accessibilityLabel="Version name"
          />
          <HelpText style={styles.hint}>Shown beside its number in History. Leave it empty for no name.</HelpText>
        </View>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    body: { padding: spacing.md },
    input: {
      color: colors.text, fontSize: font.md, backgroundColor: colors.bgTertiary,
      borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44,
    },
    hint: { marginTop: spacing.md, color: colors.textSecondary, fontSize: font.sm },
  });
}
