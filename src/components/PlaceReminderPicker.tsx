import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { InlineAction } from './InlineAction';
import { SegmentedControl } from './SegmentedControl';
import { HelpText } from './HelpText';
import { NameSheet, type NameRequest } from './NameSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { addSavedPlace, readSavedPlaces, savedPlaceKey, writeSavedPlaces, type SavedPlace } from '../utils/savedPlaces';
import { remindablePlaces } from '../utils/placeReminders';
import { getCurrentLocation, requestLocationPermission } from '../utils/weatherLocation';
import { alertPermissionOff } from '../utils/permissionAlert';
import { isDemoModeActive } from '../utils/demoState';

interface Props {
  placeId: string | null;
  on: 'arrive' | 'leave';
  onChange: (placeId: string | null, on: 'arrive' | 'leave') => void;
}

/**
 * The body of the task editor's "Remind me at a place" row: which saved place,
 * and whether it rings on arriving or on leaving (`src/utils/placeReminders.ts`).
 *
 * Only places with a map pin are offered, since the system needs a point to
 * watch. "Save where I am now" reads the location once, in the foreground, and
 * files it as a saved place under a name the person types, the same list
 * Settings › Calendar › Places keeps. Picking a place asks for when-in-use
 * location permission, which is all the system's own watching needs.
 */
export function PlaceReminderPicker({ placeId, on, onChange }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [saving, setSaving] = useState(false);
  const [naming, setNaming] = useState<NameRequest | null>(null);

  useEffect(() => { setPlaces(remindablePlaces(readSavedPlaces())); }, []);

  const pick = async (id: string) => {
    haptics.tap();
    if (id === placeId) { onChange(null, on); return; }
    onChange(id, on);
    const granted = await requestLocationPermission();
    if (!granted) {
      alertPermissionOff(
        'Location access is off',
        'A reminder at a place needs location access while using the app. iPhone then watches for the place itself.',
      );
    }
  };

  const saveHere = async () => {
    if (saving || isDemoModeActive()) return;
    setSaving(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        alertPermissionOff('Location access is off', 'Turn it on in Settings to save where you are.');
        return;
      }
      const here = await getCurrentLocation({ accuracy: 'balanced' });
      if (!here) {
        Alert.alert('Couldn’t find where you are', 'Try again in a moment, or add the place in Settings › Calendar › Places.');
        return;
      }
      // Past the limit addSavedPlace hands the list back without the new
      // name, so the same call is the refusal, said under the field.
      const added = (name: string) => addSavedPlace(readSavedPlaces(), {
        name,
        text: name,
        place: { latitude: here.latitude, longitude: here.longitude },
      });
      const savedIn = (next: SavedPlace[], name: string) => next.find(p => savedPlaceKey(p.name) === savedPlaceKey(name));
      setNaming({
        title: 'Save place',
        initial: '',
        placeholder: 'e.g. Home',
        hint: 'Saves where you are now under this name.',
        refusal: name => (savedIn(added(name), name) ? null : 'Too many saved places. Remove one in Settings, under Calendar, to save another.'),
        onSave: trimmed => {
          const next = added(trimmed);
          const saved = savedIn(next, trimmed);
          if (!saved) return;
          writeSavedPlaces(next);
          setPlaces(remindablePlaces(next));
          haptics.success();
          onChange(saved.id, on);
        },
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.body}>
      {places.length > 0 ? (
        <View style={styles.pills}>
          {places.map(place => {
            const active = place.id === placeId;
            return (
              <TouchableOpacity
                key={place.id}
                style={[styles.pill, active && styles.pillOn]}
                onPress={() => { void pick(place.id); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.pillText, active && styles.pillTextOn]}>{place.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <Text style={styles.empty}>No saved places with a map pin yet.</Text>
      )}
      <InlineAction
        icon="locate-outline"
        label="Save where I am now"
        variant="neutral"
        surface="card"
        style={styles.saveHere}
        disabled={saving}
        onPress={() => { void saveHere(); }}
      />
      {placeId !== null && (
        <SegmentedControl
          options={[
            { value: 'arrive' as const, label: 'When I arrive' },
            { value: 'leave' as const, label: 'When I leave' },
          ]}
          value={on}
          onChange={next => onChange(placeId, next)}
          label="When the reminder rings"
        />
      )}
      <HelpText style={styles.hint}>
        iPhone watches for this itself and shows the reminder. The app never reads your location in the background.
      </HelpText>
      {/* Rendered here, so it presents from whichever sheet holds this picker. */}
      <NameSheet request={naming} onClose={() => setNaming(null)} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  body: { paddingLeft: spacing.md + 18 + spacing.md, paddingRight: spacing.md, paddingBottom: spacing.md, gap: spacing.smd },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: { paddingHorizontal: 14, paddingVertical: spacing.sm, borderRadius: radius.full, backgroundColor: colors.bgTertiary },
  pillOn: { backgroundColor: colors.accentFill },
  pillText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  pillTextOn: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  empty: { color: colors.textSecondary, fontSize: font.sm },
  saveHere: { alignSelf: 'flex-start' },
  hint: { color: colors.textSecondary, fontSize: font.xs },
});
