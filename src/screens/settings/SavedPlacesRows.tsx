import React, { useState } from 'react';
import { Alert, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useColors } from '../../theme/ThemeContext';
import { iconSize } from '../../theme';
import { animateLayout } from '../../utils/layoutAnimation';
import { haptics } from '../../utils/haptics';
import { InlineAction } from '../../components/InlineAction';
import { SavedPlaceSheet } from '../../components/SavedEntrySheets';
import {
  readSavedPlaces,
  removeSavedPlace,
  writeSavedPlaces,
  type SavedPlace,
} from '../../utils/savedPlaces';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';

/**
 * The named places a new event's location can be typed as ("home"), in
 * Settings › Calendar. A place is added here or saved from the new-event card;
 * this is also where one is edited (name and address) and removed.
 *
 * Reads the list when the screen gains focus rather than subscribing: it is a
 * plain setting (`savedPlaces`), and a sync that lands while the screen is open
 * shows on the next visit.
 */
export function SavedPlacesRows() {
  const colors = useColors();
  const styles = makeSettingsStyles(colors);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SavedPlace | 'new' | null>(null);

  useFocusEffect(React.useCallback(() => { setPlaces(readSavedPlaces()); }, []));

  const commit = (next: SavedPlace[]) => {
    animateLayout();
    writeSavedPlaces(next);
    setPlaces(next);
    if (next.length === 0) setOpen(false);
  };

  const remove = (place: SavedPlace) => {
    Alert.alert(
      `Remove ${place.name}?`,
      'Events already saved keep their location. Typing the name will no longer fill in the address.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { haptics.warning(); commit(removeSavedPlace(places, place.id)); } },
      ],
    );
  };

  return (
    <>
      <View style={styles.sep} />
      <SettingsRow
        entryId="savedPlaces"
        icon="bookmark-outline"
        iconColor={places.length > 0 ? colors.accent : undefined}
        label="Saved places"
        hint="Type a name in a new event's location to fill in its address."
        value={places.length > 0 ? String(places.length) : undefined}
        expanded={open}
        onPress={() => { animateLayout(); setOpen(v => !v); }}
        accessibilityLabel="Saved places"
      />
      {open && places.map(place => (
        <React.Fragment key={place.id}>
          <View style={styles.sep} />
          <SettingsRow
            icon="location-outline"
            label={place.name}
            hint={place.text}
            alwaysShowHint
            onPress={() => setEditing(place)}
            accessibilityLabel={`Edit ${place.name}`}
            trailing={(
              <TouchableOpacity
                onPress={() => remove(place)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${place.name}`}
              >
                <Ionicons name="trash-outline" size={iconSize.sm} color={colors.red} />
              </TouchableOpacity>
            )}
          />
        </React.Fragment>
      ))}
      {open && (
        <View style={styles.addRow}>
          <InlineAction label="New place" icon="add" onPress={() => setEditing('new')} />
        </View>
      )}
      <SavedPlaceSheet
        visible={editing !== null}
        subject={editing}
        places={places}
        onSave={commit}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
