#!/usr/bin/env node
/**
 * Generates assets/sounds/beat.wav: the three notes the All clear beat plays
 * (src/utils/beatSound.ts) when the setting is on. Two short C5s and a held
 * G5, 240 ms apart, matching the mark's dot, dot, check and the haptic's
 * light, light, heavy. Synthesised rather than recorded so a change to the
 * pitches or timing is an edit here and one re-run:
 * `node scripts/generate-beat-sound.js`.
 */

const fs = require('fs');
const path = require('path');

const RATE = 44100;
const LENGTH_S = 1.3;

// [start (s), frequency (Hz), decay length (s), peak]
const NOTES = [
  [0.0, 523.25, 0.16, 0.30],
  [0.24, 523.25, 0.16, 0.30],
  [0.48, 783.99, 0.75, 0.36],
];
const ATTACK_S = 0.008;

const samples = new Float64Array(Math.round(RATE * LENGTH_S));
for (const [start, freq, decay, peak] of NOTES) {
  const from = Math.round(start * RATE);
  const to = Math.min(samples.length, from + Math.round((ATTACK_S + decay * 1.6) * RATE));
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE;
    // Linear attack, then an exponential fall to -60 dB over `decay`.
    const env = t < ATTACK_S ? t / ATTACK_S : Math.pow(10, (-3 * (t - ATTACK_S)) / decay);
    // A sine with a little of its second and third harmonics: rounder than a
    // pure tone, softer than a square.
    const phase = 2 * Math.PI * freq * t;
    const tone = Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.08 * Math.sin(3 * phase);
    samples[i] += peak * env * tone / 1.33;
  }
}

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
header.writeUInt32LE(16, 16); // fmt chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36, 'ascii');
header.writeUInt32LE(data.length, 40);

const out = path.join(__dirname, '..', 'assets', 'sounds', 'beat.wav');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log(`wrote assets/sounds/beat.wav (${LENGTH_S}s)`);
