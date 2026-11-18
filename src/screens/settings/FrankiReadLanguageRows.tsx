import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { CountStepper } from '../../components/CountStepper';
import type { SegmentOption } from '../../components/SegmentedControl';
import { useFrankiStore } from '../../store/useFrankiStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useColors } from '../../theme/ThemeContext';
import {
  FRANKI_ROTATE_COUNT_DEFAULT,
  FRANKI_ROTATE_COUNT_MAX,
  FRANKI_ROTATE_COUNT_MIN,
  frankiReadModeOf,
  type FrankiReadMode,
  type FrankiReadListen,
} from '../../utils/frankiTasks';
import { SettingsRow } from './SettingsRow';
import { SettingsSegments } from './SettingsSegments';
import { makeSettingsStyles } from './settingsStyles';

/**
 * How each Read & Listen language is handled, under the Read & Listen switch:
 * Every day, Rotate or Off for each language Franki has a text waiting in (or
 * that was set before), and how many rotating languages get a task a day. The
 * rules are `plannedFrankiReadLanguages` in `src/utils/frankiTasks.ts`.
 */

const MODE_OPTIONS: SegmentOption<FrankiReadMode>[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'rotate', label: 'Rotate' },
  { value: 'off', label: 'Off' },
];

const NO_LANGUAGES: FrankiReadListen[] = [];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function FrankiReadLanguageRows(): React.ReactElement {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const readLanguages = useFrankiStore(s => s.snapshot?.readLanguages ?? NO_LANGUAGES);
  const s = useSettingsStore(useShallow(st => ({
    modes: st.frankiReadLanguages,
    rotateCount: st.frankiReadRotateCount,
    setMode: st.setFrankiReadLanguageMode,
    setRotateCount: st.setFrankiReadRotateCount,
  })));
  // A language with nothing waiting is listed only once it has a choice of its own, so one set to Every day doesn't vanish.
  const shown = readLanguages.filter(l => l.waiting > 0 || s.modes[l.language] !== undefined);

  if (shown.length === 0) {
    return (
      <>
        <View style={styles.sep} />
        <SettingsRow
          entryId="frankiReadLanguages"
          label="Languages"
          hint="Languages appear here once Franki has a text waiting in them."
          alwaysShowHint
        />
      </>
    );
  }

  return (
    <>
      {shown.map(language => (
        <React.Fragment key={language.language}>
          <View style={styles.sep} />
          <SettingsRow
            entryId={language.language === shown[0].language ? 'frankiReadLanguages' : undefined}
            label={language.name}
            value={plural(language.waiting, 'text waiting', 'texts waiting')}
            tight
          />
          <SettingsSegments
            attached
            options={MODE_OPTIONS}
            selected={frankiReadModeOf(s.modes, language.language)}
            onSelect={mode => s.setMode(language.language, mode)}
            accessibilityLabelFor={o => `${language.name} Read & Listen task: ${o.label}`}
          />
        </React.Fragment>
      ))}

      <View style={styles.sep} />
      <SettingsRow
        entryId="frankiReadRotateCount"
        label="Rotating languages a day"
        hint="Every day always gets a task while a text is waiting. Rotate languages take turns, up to this many a day, the one read least recently first. Off gets none."
        value={plural(s.rotateCount, 'language', 'languages')}
        tight
      />
      <View style={styles.cadenceRow}>
        <CountStepper
          value={s.rotateCount}
          onChange={next => s.setRotateCount(next ?? FRANKI_ROTATE_COUNT_DEFAULT)}
          min={FRANKI_ROTATE_COUNT_MIN}
          max={FRANKI_ROTATE_COUNT_MAX}
          label="Rotating languages"
          describeValue={n => plural(n ?? FRANKI_ROTATE_COUNT_DEFAULT, 'language', 'languages')}
        />
      </View>
    </>
  );
}
