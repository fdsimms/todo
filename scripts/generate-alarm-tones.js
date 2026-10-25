#!/usr/bin/env node
/**
 * Generates the built-in alarm ringtones in assets/sounds/ (BUILT_IN_SOUNDS in
 * src/utils/alarmSounds.ts): Chime, Beacon and Rise. Each is a short pattern
 * repeated to 20 seconds, under the 30 a system alert sound may run, and the
 * app converts and installs it for AlarmKit at first use (alarmSchedule.ts).
 * Synthesised rather than recorded, the way beat.wav is, so a change to a tone
 * is an edit here and one re-run: `node scripts/generate-alarm-tones.js`.
 */

const fs = require('fs');
const path = require('path');

// Half CD rate: these are alarm tones, not music, and it halves what they add to the app.
const RATE = 22050;
const LENGTH_S = 20;
const ATTACK_S = 0.008;

/** A bell-ish note: a sine with a little of its second and third harmonics, falling to -60 dB over `decay`. */
function addNote(samples, start, freq, decay, peak) {
  const from = Math.round(start * RATE);
  const to = Math.min(samples.length, from + Math.round((ATTACK_S + decay * 1.6) * RATE));
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE;
    const env = t < ATTACK_S ? t / ATTACK_S : Math.pow(10, (-3 * (t - ATTACK_S)) / decay);
    const phase = 2 * Math.PI * freq * t;
    samples[i] += peak * env * (Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase)) / 1.33;
  }
}

/** A flat beep with short ramps, for the tones that should cut through sleep. */
function addBeep(samples, start, freq, length, peak) {
  const from = Math.round(start * RATE);
  const n = Math.round(length * RATE);
  const ramp = Math.round(0.01 * RATE);
  for (let i = 0; i < n && from + i < samples.length; i++) {
    const env = Math.min(1, i / ramp, (n - i) / ramp);
    samples[from + i] += peak * env * Math.sin((2 * Math.PI * freq * i) / RATE);
  }
}

const TONES = {
  // A rising arpeggio, every 2 seconds: gentle, for a nap.
  chime: s => {
    for (let t = 0; t < LENGTH_S - 1.5; t += 2) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => addNote(s, t + i * 0.18, f, 0.9, 0.32));
    }
  },
  // Four quick beeps a second apart: the classic alarm clock.
  beacon: s => {
    for (let t = 0; t < LENGTH_S - 1; t += 1) {
      for (let k = 0; k < 4; k++) addBeep(s, t + k * 0.12, 880, 0.07, 0.42);
    }
  },
  // Notes that climb and get louder over the whole 20 seconds.
  rise: s => {
    const scale = [392, 440, 493.88, 523.25, 587.33, 659.25, 739.99, 783.99];
    let i = 0;
    for (let t = 0; t < LENGTH_S - 1; t += 0.5, i++) {
      const peak = 0.12 + 0.3 * (t / LENGTH_S);
      addNote(s, t, scale[i % scale.length] * (i >= scale.length * 2 ? 2 : 1), 0.4, peak);
    }
  },
};

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

for (const [name, draw] of Object.entries(TONES)) {
  const samples = new Float64Array(RATE * LENGTH_S);
  draw(samples);
  const out = path.join(__dirname, '..', 'assets', 'sounds', `alarm-${name}.wav`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, wav(samples));
  console.log(`wrote assets/sounds/alarm-${name}.wav (${LENGTH_S}s)`);
}
