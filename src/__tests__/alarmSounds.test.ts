import {
  customSoundId,
  customSoundRef,
  describeSound,
  describeSoundChoice,
  parseAlarmSound,
  parseAlarmSoundFiles,
  parseSoundPool,
  pickFromPool,
  soundChoiceFrom,
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

describe('sound pools', () => {
  it('reads a pool back with known sounds only, each once', () => {
    expect(parseSoundPool(['chime', 'kazoo', 'chime', 'rise'])).toEqual(['chime', 'rise']);
    expect(parseSoundPool('["beacon","rise"]')).toEqual(['beacon', 'rise']);
  });

  it('treats fewer than two as no pool', () => {
    expect(parseSoundPool(['chime'])).toEqual([]);
    expect(parseSoundPool(['chime', 'chime'])).toEqual([]);
    expect(parseSoundPool(null)).toEqual([]);
    expect(parseSoundPool('not json')).toEqual([]);
  });

  it('never picks the sound it already has when another is there', () => {
    const pool = ['chime', 'beacon', 'rise'];
    for (const r of [0, 0.4, 0.99]) expect(pickFromPool(pool, 'beacon', () => r)).not.toBe('beacon');
    expect(pickFromPool(pool, 'beacon', () => 0)).toBe('chime');
    expect(pickFromPool(pool, 'beacon', () => 0.99)).toBe('rise');
  });

  it('can pick any sound when it has none yet, and handles an empty pool', () => {
    expect(pickFromPool(['chime', 'rise'], null, () => 0.99)).toBe('rise');
    expect(pickFromPool([], 'chime')).toBe('chime');
  });

  it('turns the picker selection into a sound and a pool', () => {
    expect(soundChoiceFrom([])).toEqual({ sound: null, soundPool: [] });
    expect(soundChoiceFrom(['rise'])).toEqual({ sound: 'rise', soundPool: [] });
    expect(soundChoiceFrom(['rise', 'chime'])).toEqual({ sound: 'rise', soundPool: ['rise', 'chime'] });
  });

  it('describes a pool by its size', () => {
    expect(describeSoundChoice('chime', [], [])).toBe('Chime');
    expect(describeSoundChoice('chime', ['chime', 'rise', 'beacon'], [])).toBe('Random, 3 sounds');
  });
});
