import {
  customSoundId,
  customSoundRef,
  describeSound,
  parseAlarmSound,
  parseAlarmSoundFiles,
  soundFileName,
  soundNameFromFile,
} from '../utils/alarmSounds';

const rooster = { id: 'snd1', name: 'Rooster', addedAt: '2026-10-14T07:00:00.000Z' };

describe('alarm sounds', () => {
  it('names the file each sound is installed as', () => {
    expect(soundFileName(null)).toBeNull();
    expect(soundFileName('chime')).toBe('dundundun-chime.caf');
    expect(soundFileName(customSoundRef('snd1'))).toBe('dundundun-custom-snd1.caf');
    expect(soundFileName('custom:')).toBeNull();
    expect(soundFileName('kazoo')).toBeNull();
  });

  it('reads back only a sound it knows', () => {
    expect(parseAlarmSound('rise')).toBe('rise');
    expect(parseAlarmSound('custom:snd1')).toBe('custom:snd1');
    expect(parseAlarmSound('kazoo')).toBeNull();
    expect(parseAlarmSound(null)).toBeNull();
    expect(customSoundId('custom:snd1')).toBe('snd1');
    expect(customSoundId('chime')).toBeNull();
  });

  it('describes a sound, and an import since deleted as the default', () => {
    expect(describeSound(null, [])).toBe('Default');
    expect(describeSound('beacon', [])).toBe('Beacon');
    expect(describeSound('custom:snd1', [rooster])).toBe('Rooster');
    expect(describeSound('custom:gone', [rooster])).toBe('Default');
  });

  it('names an imported sound after its file', () => {
    expect(soundNameFromFile('Rooster.mp3')).toBe('Rooster');
    expect(soundNameFromFile('morning_birds.m4a')).toBe('morning birds');
    expect(soundNameFromFile('.mp3')).toBe('.mp3');
    expect(soundNameFromFile('')).toBe('Imported sound');
    expect(soundNameFromFile(null)).toBe('Imported sound');
    expect(soundNameFromFile(`${'a'.repeat(60)}.wav`)).toHaveLength(40);
  });

  it('reads the imported list, dropping anything malformed', () => {
    expect(parseAlarmSoundFiles(JSON.stringify([rooster, { id: '', name: 'x', addedAt: 'y' }, 3]))).toEqual([rooster]);
    expect(parseAlarmSoundFiles('{')).toEqual([]);
    expect(parseAlarmSoundFiles(null)).toEqual([]);
  });
});
