#!/usr/bin/env node
/**
 * Generates the app icons in assets/, the connector icon in
 * mcp/src/serverIcon.ts, and the separate layers in assets/icon-layers/ that
 * Icon Composer builds the layered (Liquid Glass) icon from.
 *
 * The mark is "the beat": two dots and a check on one floor, ink on gold. It is
 * drawn from the geometry in `beatMark()` below rather than from an exported
 * image, so a change to the weight, spacing or colors is a one-line edit here
 * and one re-run. Deliberately dependency-free (only node's zlib) so it can be
 * re-run from a fresh clone: `node scripts/generate-icon.js` rewrites every
 * file it owns.
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

/** Distance from p to the segment ab. */
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
 * The mark, in normalized 0..1 icon space: two dots and a round-capped check.
 *
 * Laid out on a 100-unit grid first, where the reasons are easiest to state:
 * - the check's stroke is 13 units, and the dots are drawn 10% fuller than half
 *   of it, because a circle reads lighter than a stroke of the same width;
 * - the dots' bottoms sit on the check's lowest point, so all three share one
 *   floor;
 * - the gap between the two dots and between the second dot and the check is
 *   the same 7 units. Closer than that and the second dot fuses with the check
 *   at the 29 pt size Settings and Spotlight draw.
 * Then the whole group is scaled to `width` of the icon and centered.
 */
function beatMark(width = 0.7) {
  const w = 13;
  const gap = 7;
  const r = w * 0.55;
  const dotY = w / 2 - r;
  const S = [-10, -10];
  const V = [0, 0];
  const E = [19, -24];
  // The second dot clears the check's short arm by `gap`; the nearest point on
  // that arm is its round-capped start S.
  const x2 = S[0] - Math.sqrt((w / 2 + r + gap) ** 2 - (dotY - S[1]) ** 2);
  const x1 = x2 - (2 * r + gap);

  const x0 = x1 - r;
  const xMax = E[0] + w / 2;
  const y0 = E[1] - w / 2;
  const yMax = w / 2;
  const k = width / (xMax - x0);
  const cx = (x0 + xMax) / 2;
  const cy = (y0 + yMax) / 2;
  const T = ([x, y]) => [0.5 + (x - cx) * k, 0.5 + (y - cy) * k];
  return {
    dots: [T([x1, dotY]), T([x2, dotY])].map(([x, y]) => ({ x, y, r: r * k })),
    check: [T(S), T(V), T(E)],
    halfStroke: (w / 2) * k,
  };
}

const MARK = beatMark();

/**
 * Whether a point lies on the mark. `scale` shrinks the mark about the icon
 * center, so the same mark can be drawn at the size each target wants; the
 * point is mapped back into unscaled space, which shrinks the stroke along with
 * the skeleton and keeps every target looking like the same logo.
 */
function onMark(x, y, scale, parts = 'all') {
  const px = (x - 0.5) / scale + 0.5;
  const py = (y - 0.5) / scale + 0.5;
  if (parts !== 'check') {
    for (const d of MARK.dots) if (Math.hypot(px - d.x, py - d.y) <= d.r) return true;
  }
  if (parts === 'dots') return false;
  const [a, b, c] = MARK.check;
  return (
    distToSegment(px, py, a[0], a[1], b[0], b[1]) <= MARK.halfStroke ||
    distToSegment(px, py, b[0], b[1], c[0], c[1]) <= MARK.halfStroke
  );
}

// ------------------------------------------------------------------ painting

const GOLD = [0xff, 0xb0, 0x20];
const INK = [0x17, 0x13, 0x1c];
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

/**
 * @param {object} opts
 * @param {number} opts.size        output edge length in px
 * @param {number[]} opts.mark      mark color
 * @param {number[]} [opts.background] opaque full-bleed fill; omitted = transparent
 * @param {number} opts.scale       mark scale about the center
 * @param {string} [opts.parts]     'dots' or 'check' to draw only that part of the
 *                                  mark; omitted = the whole mark
 */
function render({ size, mark, background, scale, parts }) {
  const ss = size <= 256 ? 8 : 4; // supersampling per axis
  const channels = background ? 3 : 4;
  const out = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let markHits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (x + (sx + 0.5) / ss) / size;
          const ny = (y + (sy + 0.5) / ss) / size;
          if (onMark(nx, ny, scale, parts)) markHits++;
        }
      }
      const m = markHits / (ss * ss);
      const i = (y * size + x) * channels;
      if (background) {
        for (let c = 0; c < 3; c++) out[i + c] = Math.round(background[c] + (mark[c] - background[c]) * m);
      } else {
        for (let c = 0; c < 3; c++) out[i + c] = mark[c];
        out[i + 3] = Math.round(m * 255);
      }
    }
  }
  return encodePng(out, size, channels);
}

// --------------------------------------------------------------------- write

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const files = [
  // Full-bleed iOS / default icon. iOS applies its own rounded-rect mask.
  ['icon.png', { size: 1024, mark: INK, background: GOLD, scale: 1 }],
  // iOS dark appearance: transparent, so iOS draws its own dark backdrop behind
  // it (Expo keeps the alpha for this variant only). Gold on that backdrop.
  ['icon-dark.png', { size: 1024, mark: GOLD, scale: 1 }],
  // iOS tinted appearance: iOS reads it as grayscale and tints the light parts,
  // so white mark on black. Opaque, because Expo flattens a tinted icon's
  // transparency onto white.
  ['icon-tinted.png', { size: 1024, mark: WHITE, background: BLACK, scale: 1 }],
  // Android adaptive foreground: transparent, over the gold background color in
  // app.json. The launcher shows only the central ~2/3 of this canvas, so 0.66
  // makes the mark fill that visible area in the same proportion it fills the
  // iOS icon, and leaves it inside the 66% safe zone the mask may clip to.
  ['adaptive-icon.png', { size: 1024, mark: INK, scale: 0.66 }],
  // Splash art: the mark alone on transparent, over the splash background set
  // in the `expo-splash-screen` plugin options in app.json. Light is the icon
  // blown up to the whole screen (ink on gold); dark is `icon-dark.png`'s pair
  // (gold on ink). Both share the icon's canvas and scale, so the plugin's
  // `imageWidth` sizes the mark at 0.7 of it.
  ['splash-icon.png', { size: 1024, mark: INK, scale: 1 }],
  ['splash-icon-dark.png', { size: 1024, mark: GOLD, scale: 1 }],
];

for (const [name, opts] of files) {
  fs.writeFileSync(path.join(assetsDir, name), render(opts));
  console.log(`wrote assets/${name} (${opts.size}x${opts.size})`);
}

// The layers for Icon Composer, which builds the layered icon iOS 26 renders
// as Liquid Glass. The background is a fill set in Icon Composer itself (see the
// README beside these), so only the two foreground groups are drawn, at the
// same 1024 canvas and position as icon.png so they stack back into it. Each is
// written as an SVG too, since Icon Composer keeps a vector layer sharp at every
// size; the SVG is built from the same geometry, and a round-capped,
// round-joined stroke is exactly the distance test `onMark` draws.
const layersDir = path.join(assetsDir, 'icon-layers');
fs.mkdirSync(layersDir, { recursive: true });
const hex = rgb => '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
const px = v => +(v * 1024).toFixed(2);
const svg = body =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">\n${body}\n</svg>\n`;
const layers = [
  ['dots', svg(MARK.dots.map(d => `  <circle cx="${px(d.x)}" cy="${px(d.y)}" r="${px(d.r)}" fill="${hex(INK)}"/>`).join('\n'))],
  ['check', svg(
    `  <polyline points="${MARK.check.map(([x, y]) => `${px(x)},${px(y)}`).join(' ')}" fill="none" ` +
    `stroke="${hex(INK)}" stroke-width="${px(MARK.halfStroke * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`
  )],
];
for (const [part, source] of layers) {
  fs.writeFileSync(path.join(layersDir, `${part}.png`), render({ size: 1024, mark: INK, scale: 1, parts: part }));
  fs.writeFileSync(path.join(layersDir, `${part}.svg`), source);
  console.log(`wrote assets/icon-layers/${part}.png and ${part}.svg`);
}

// The connector's icon (MCP `serverInfo.icons`) is the app icon at 128px,
// inlined as a data URI. Only the URI inside the file is rewritten.
const serverIconFile = path.join(root, 'mcp', 'src', 'serverIcon.ts');
const serverIcon = render({ size: 128, mark: INK, background: GOLD, scale: 1 }).toString('base64');
const source = fs.readFileSync(serverIconFile, 'utf8');
const updated = source.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/, `data:image/png;base64,${serverIcon}`);
if (updated === source && !source.includes(serverIcon)) throw new Error('no data URI found in mcp/src/serverIcon.ts');
fs.writeFileSync(serverIconFile, updated);
console.log('wrote mcp/src/serverIcon.ts (128x128)');
