import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { TextField } from './TextField';
import { CountStepper } from './CountStepper';
import { SegmentedControl } from './SegmentedControl';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { usePlaceSuggestions } from '../hooks/usePlaceSuggestions';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { placeLocationText, placeSubtitle, type PlaceResult } from '../utils/places';
import { editSavedPlace, addSavedPlace, findSavedPlace, type SavedPlace } from '../utils/savedPlaces';
import { editSavedEvent, type SavedEvent } from '../utils/savedEvents';
import { ALERT_CHOICES, describeAlert } from '../utils/quickEventSave';

type Pin = { latitude: number; longitude: number } | null;

interface PlaceFieldProps {
  text: string;
  onChangeText: (text: string) => void;
  /** Set when a suggestion is picked; cleared as soon as the text is typed over. */
  onPickPlace: (pin: Pin) => void;
  picked: boolean;
  placeholder: string;
  accessibilityLabel: string;
}

/**
 * An address field with Apple Maps suggestions under it. Picking one writes
 * the same text a new event's location gets (`placeLocationText`) and hands
 * back its pin. Suggestions answer to the same `placeSuggestionsEnabled`
 * switch as the new-event card, so with it off this is a plain text field.
 */
function PlaceAddressField({ text, onChangeText, onPickPlace, picked, placeholder, accessibilityLabel }: PlaceFieldProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { results } = usePlaceSuggestions(text, !picked);

  const pick = (place: PlaceResult) => {
    haptics.tap();
    onChangeText(placeLocationText(place));
    onPickPlace({ latitude: place.latitude, longitude: place.longitude });
  };

  return (
    <>
      <TextField
        style={styles.input}
        value={text}
        onChangeText={next => { onChangeText(next); onPickPlace(null); }}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel}
      />
      {results.length > 0 && (
        <View style={styles.placeList}>
          {results.map((place, index) => {
            const subtitle = placeSubtitle(place);
            return (
              <TouchableOpacity
                key={`${place.latitude},${place.longitude},${index}`}
                style={[styles.placeRow, index > 0 && styles.placeRowRuled]}
                onPress={() => pick(place)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Use ${placeLocationText(place)}`}
              >
                <Text style={styles.placeName} numberOfLines={1}>{place.name ?? place.address}</Text>
                {subtitle && <Text style={styles.placeAddress} numberOfLines={1}>{subtitle}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </>
  );
}

interface PlaceSheetProps {
  visible: boolean;
  /** The place being edited, or `'new'`; null while the sheet is closed. */
  subject: SavedPlace | 'new' | null;
  places: readonly SavedPlace[];
  /** The list with the change made. The host writes it. */
  onSave: (next: SavedPlace[]) => void;
  onClose: () => void;
}

/** Name and address for one saved place, from Settings. The new-event card is the other way in. */
export function SavedPlaceSheet({ visible, subject: liveSubject, places, onSave, onClose }: PlaceSheetProps) {
  const subject = useSheetSubject(liveSubject);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const finish = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [pin, setPin] = useState<Pin>(null);

  // Reseeds on each open: the subject outlives a close, so keying on it alone
  // would hand back last time's half-typed edit.
  useEffect(() => {
    if (!visible || !subject) return;
    const existing = subject === 'new' ? null : subject;
    setName(existing?.name ?? '');
    setText(existing?.text ?? '');
    setPin(existing && existing.latitude !== null && existing.longitude !== null
      ? { latitude: existing.latitude, longitude: existing.longitude }
      : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, subject === 'new' ? 'new' : subject?.id]);

  if (!subject) return null;
  const isNew = subject === 'new';

  const save = () => {
    if (!name.trim() || !text.trim()) {
      Alert.alert('Name and address needed', 'Enter a name and the address it stands for.');
      return;
    }
    const input = { name, text, place: pin };
    let next: SavedPlace[];
    if (isNew) {
      if (findSavedPlace(places, name)) {
        Alert.alert('Name already used', 'Another saved place has that name.');
        return;
      }
      next = addSavedPlace(places, input);
    } else {
      next = editSavedPlace(places, subject.id, input);
      if (!next.some(p => p.id === subject.id && p.name === name.trim())) {
        Alert.alert('Name already used', 'Another saved place has that name.');
        return;
      }
    }
    haptics.success();
    finish(() => onSave(next));
  };

  return (
    <CardSheet name="SavedPlaceSheet" visible={visible} controller={card} onRequestClose={() => finish()}>
      <View style={styles.header}>
        <SheetHeaderButton label="Cancel" role="cancel" onPress={() => finish()} />
        <Text style={styles.headerTitle}>{isNew ? 'New place' : 'Edit place'}</Text>
        <SheetHeaderButton label="Save" onPress={save} />
      </View>
      <View style={styles.body}>
        <Text style={styles.fieldLabel}>NAME</Text>
        <TextField
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Home"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="words"
          returnKeyType="next"
          accessibilityLabel="Place name"
        />
        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>ADDRESS</Text>
        <PlaceAddressField
          text={text}
          onChangeText={setText}
          onPickPlace={setPin}
          picked={pin !== null}
          placeholder="Search or type an address"
          accessibilityLabel="Place address"
        />
        <Text style={styles.hint}>Typing the name in a new event’s location fills in this address.</Text>
      </View>
    </CardSheet>
  );
}

interface EventSheetProps {
  visible: boolean;
  /** The event being edited, or `'new'`; null while the sheet is closed. */
  subject: SavedEvent | 'new' | null;
  events: readonly SavedEvent[];
  onSave: (next: SavedEvent[]) => void;
  onClose: () => void;
}

const NO_ALERT = -1;
const DEFAULT_LENGTH_MINUTES = 60;

/**
 * Title, location, length and alert for one saved event, from Settings.
 * The calendar, availability, booking interval and last start are kept as they
 * were: the interval has its own stepper on the list, and the rest follow from
 * adding the event again.
 */
export function SavedEventSheet({ visible, subject: liveSubject, events, onSave, onClose }: EventSheetProps) {
  const subject = useSheetSubject(liveSubject);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const finish = (after?: () => void) => card.close(() => { after?.(); onClose(); });

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [pin, setPin] = useState<Pin>(null);
  const [length, setLength] = useState<number | null>(DEFAULT_LENGTH_MINUTES);
  const [alert, setAlert] = useState<number>(NO_ALERT);

  useEffect(() => {
    if (!visible || !subject) return;
    const existing = subject === 'new' ? null : subject;
    setTitle(existing?.title ?? '');
    setLocation(existing?.location ?? '');
    setPin(existing?.place ?? null);
    setLength(existing ? existing.durationMinutes : DEFAULT_LENGTH_MINUTES);
    setAlert(existing?.alertMinutes ?? NO_ALERT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, subject === 'new' ? 'new' : subject?.title]);

  const alertOptions = useMemo(() => {
    const minutes = alert !== NO_ALERT && !ALERT_CHOICES.includes(alert) ? [...ALERT_CHOICES, alert] : ALERT_CHOICES;
    return [
      { value: NO_ALERT, label: 'None' },
      ...minutes.map(m => ({ value: m, label: describeAlert(m, length === null) })),
    ];
  }, [alert, length]);

  if (!subject) return null;
  const isNew = subject === 'new';

  const save = () => {
    if (!title.trim()) {
      Alert.alert('Title needed', 'Enter a title to identify this event.');
      return;
    }
    const next = editSavedEvent(events, isNew ? null : subject.title, {
      title,
      location: location.trim() || null,
      place: location.trim() ? pin : null,
      durationMinutes: length,
      alertMinutes: alert === NO_ALERT ? null : alert,
    }, Date.now());
    if (!next) {
      Alert.alert('Title already used', 'Another saved event has that title.');
      return;
    }
    haptics.success();
    finish(() => onSave(next));
  };

  return (
    <CardSheet name="SavedEventSheet" visible={visible} controller={card} onRequestClose={() => finish()}>
      <View style={styles.header}>
        <SheetHeaderButton label="Cancel" role="cancel" onPress={() => finish()} />
        <Text style={styles.headerTitle}>{isNew ? 'New saved event' : 'Edit saved event'}</Text>
        <SheetHeaderButton label="Save" onPress={save} />
      </View>
      <View style={styles.body}>
        <Text style={styles.fieldLabel}>TITLE</Text>
        <TextField
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Optometrist"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="words"
          returnKeyType="next"
          accessibilityLabel="Event title"
        />
        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>LOCATION</Text>
        <PlaceAddressField
          text={location}
          onChangeText={setLocation}
          onPickPlace={setPin}
          picked={pin !== null}
          placeholder="Optional"
          accessibilityLabel="Event location"
        />
        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>LENGTH</Text>
        <CountStepper
          value={length}
          onChange={setLength}
          min={15}
          max={24 * 60}
          step={15}
          allowNull
          start={DEFAULT_LENGTH_MINUTES}
          emptyLabel="All day"
          format={n => (n < 60 ? `${n} min` : n % 60 === 0 ? `${n / 60} hr` : `${Math.floor(n / 60)} hr ${n % 60} min`)}
          label="Event length"
        />
        <Text style={[styles.fieldLabel, styles.fieldLabelSpaced]}>ALERT</Text>
        <SegmentedControl
          options={alertOptions}
          value={alert}
          onChange={setAlert}
          columns={3}
          label="Alert"
        />
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.smd,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  body: { padding: spacing.md },
  fieldLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.xs, marginBottom: spacing.sm,
  },
  fieldLabelSpaced: { marginTop: spacing.lg },
  input: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
  },
  hint: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.md,
  },
  placeList: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  placeRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  placeRowRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  placeName: { color: colors.text, fontSize: font.md },
  placeAddress: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
});
