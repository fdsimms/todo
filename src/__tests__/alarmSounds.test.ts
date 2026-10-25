import {
  customSoundId,
  customSoundRef,
  describeSound,
  describeWakeSong,
  normalizeWakeSong,
  parseAlarmSound,
  parseAlarmSoundFiles,
  parseWakeSong,
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

  it('keeps a song only with a persistent id', () => {
    const song = { persistentId: '18446744073709551615', title: ' Mr. Blue Sky ', artist: 'ELO' };
    expect(normalizeWakeSong(song)).toEqual({ persistentId: '18446744073709551615', title: 'Mr. Blue Sky', artist: 'ELO' });
    expect(normalizeWakeSong({ persistentId: '0', title: 'x' })).toBeNull();
    expect(normalizeWakeSong({ persistentId: 12, title: 'x' })).toBeNull();
    expect(normalizeWakeSong({ persistentId: '5', title: '', artist: '' })).toEqual({ persistentId: '5', title: 'Untitled song', artist: null });
    expect(parseWakeSong(JSON.stringify(song))?.title).toBe('Mr. Blue Sky');
    expect(parseWakeSong('nope')).toBeNull();
  });

  it('describes a song with its artist when it has one', () => {
    expect(describeWakeSong({ persistentId: '1', title: 'Mr. Blue Sky', artist: 'ELO' })).toBe('Mr. Blue Sky · ELO');
    expect(describeWakeSong({ persistentId: '1', title: 'Mr. Blue Sky', artist: null })).toBe('Mr. Blue Sky');
  });
});
