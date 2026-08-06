#!/usr/bin/env node
/**
 * Generates the placeholder app icons in assets/.
 *
 * Placeholder art: a white checkmark on the app's accent blue. Deliberately
 * dependency-free (only node's zlib) so it can be re-run from a fresh clone —
 * `node scripts/generate-icon.js` rewrites every file it owns.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG writer

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * @param {Buffer} pixels  size * size * channels, 8-bit
 * @param {number} size
 * @param {number} channels 3 for RGB, 4 for RGBA. iOS app icons are rejected if
 *   they carry an alpha channel, so the launcher icon is written as RGB.
 */
function encodePng(pixels, size, channels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // color type: RGBA / RGB
  const stride = size * channels;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ geometry

/** Distance from p to the segment ab, all in normalized 0..1 icon space. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * The checkmark: two round-capped strokes. `scale` shrinks it about the icon
 * center, so the same mark can be drawn at the size each target wants.
 *
 * The comparison is against `stroke / 2` in the *unscaled* space, which makes
 * the stroke shrink along with the skeleton. Dividing by `scale` here instead
 * would hold the stroke at a constant width while the mark shrinks around it,
 * rendering a visibly stubbier check at smaller scales than the one on the iOS
 * icon — the two targets have to look like the same logo.
 */
function checkCoverage(x, y, scale, stroke) {
  const px = (x - 0.5) / scale + 0.5;
  const py = (y - 0.5) / scale + 0.5;
  const d = Math.min(
    distToSegment(px, py, 0.265, 0.53, 0.425, 0.685),
    distToSegment(px, py, 0.425, 0.685, 0.745, 0.325)
  );
  return d <= stroke / 2 ? 1 : 0;
}

// ------------------------------------------------------------------ painting

const SS = 4; // supersampling factor per axis

const ACCENT_TOP = [51, 153, 255];
const ACCENT_BOTTOM = [0, 90, 214];
const WHITE = [255, 255, 255];

/**
 * @param {object} opts
 * @param {number} opts.size        output edge length in px
 * @param {boolean} opts.background fill the accent gradient, or leave transparent
 * @param {number} opts.scale       checkmark scale about the center
 */
function render({ size, background, scale }) {
  const stroke = 0.112;
  const channels = background ? 3 : 4;
  const out = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          hits += checkCoverage(nx, ny, scale, stroke);
        }
      }
      const mark = hits / (SS * SS);

      const i = (y * size + x) * channels;
      if (background) {
        const t = y / (size - 1);
        for (let c = 0; c < 3; c++) {
          const bg = ACCENT_TOP[c] + (ACCENT_BOTTOM[c] - ACCENT_TOP[c]) * t;
          out[i + c] = Math.round(bg + (WHITE[c] - bg) * mark);
        }
      } else {
        for (let c = 0; c < 3; c++) out[i + c] = WHITE[c];
        out[i + 3] = Math.round(mark * 255);
      }
    }
  }
  return encodePng(out, size, channels);
}

// --------------------------------------------------------------------- write

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const files = [
  // Full-bleed iOS / default icon. iOS applies its own rounded-rect mask.
  ['icon.png', { size: 1024, background: true, scale: 1 }],
  // Android adaptive foreground: transparent. The launcher shows only the
  // central ~2/3 of this canvas, so 0.66 makes the mark fill that visible area
  // in the same proportion it fills the iOS icon, and leaves it inside the 66%
  // safe zone the mask is allowed to clip to.
  ['adaptive-icon.png', { size: 1024, background: false, scale: 0.66 }],
  // Splash art, drawn over the black splash background. `resizeMode: contain`
  // fits this square image to the screen width on a portrait phone, so the
  // mark lands at ~32% of screen width.
  ['splash-icon.png', { size: 512, background: false, scale: 0.54 }],
];

for (const [name, opts] of files) {
  const file = path.join(assetsDir, name);
  fs.writeFileSync(file, render(opts));
  console.log(`wrote assets/${name} (${opts.size}x${opts.size})`);
}
