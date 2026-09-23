// Mood boards: the looks you (or your stylist) want to move towards.
//
// A mood is a palette plus a few preferences. It nudges the ranking — outfits
// whose colours sit near the palette and whose pieces match the preferred
// families rise — but it never overrides weather, formality or proportion.
//
// Custom moods come from inspiration photos: the browser samples each photo's
// dominant colours, so the palette is taken from pictures you chose rather
// than from a label.

import { hexToRgb, hexToHsl, isNeutral } from './color.js';

export const PRESET_MOODS = [
  { id: 'quiet-luxury', label: 'Quiet luxury', palette: ['#1f2a3a', '#c8b89a', '#e9e4d8', '#5a4636', '#8a8d91'],
    prefer: { styles: ['smart-casual', 'formal'], plain: true, collar: true } },
  { id: 'scandi', label: 'Scandi minimal', palette: ['#f2f0eb', '#1c1c1e', '#8a8d91', '#c9c3b6'],
    prefer: { plain: true } },
  { id: 'italian', label: 'Italian earth tones', palette: ['#6b4a32', '#c2a57e', '#e8dcc4', '#5b5e3a', '#2d3a4f'],
    prefer: { styles: ['smart-casual'], collar: true } },
  { id: 'street', label: 'Streetwear', palette: ['#111111', '#f0f0f0', '#6b7c93', '#556b2f'],
    prefer: { styles: ['casual'], loose: true } },
  { id: 'outdoor', label: 'Outdoor / gorpcore', palette: ['#556b2f', '#8b7355', '#2f4f4f', '#c19a6b', '#d2691e'],
    prefer: { styles: ['outdoor'] } },
  { id: 'athleisure', label: 'Athleisure', palette: ['#1c1c1e', '#8a8d91', '#9caf88', '#ffffff'],
    prefer: { styles: ['sporty', 'casual'] } },
  { id: 'mono', label: 'Monochrome', palette: ['#000000', '#3a3a3a', '#8a8a8a', '#ffffff'],
    prefer: { plain: true } },
];

function rgbDistance(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  // Redmean — cheap and closer to perception than straight RGB distance.
  const r = (x.r + y.r) / 2;
  const dr = x.r - y.r, dg = x.g - y.g, db = x.b - y.b;
  return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db);
}

/** 0-1: how close each garment colour is to its nearest palette colour. */
function paletteFit(items, palette) {
  if (!palette?.length) return 1;
  const fits = items.map((i) => {
    const d = Math.min(...palette.map((p) => rgbDistance(i.hex, p)));
    return Math.max(0, 1 - d / 300);
  });
  return fits.reduce((a, b) => a + b, 0) / fits.length;
}

export function moodScore(items, mood) {
  const reasons = [];
  const colour = paletteFit(items, mood.palette);
  let prefs = 1;
  const p = mood.prefer ?? {};
  if (p.styles) {
    const share = items.filter((i) => p.styles.includes(i.style)).length / items.length;
    prefs = 0.5 + share * 0.5;
  }
  if (p.plain && items.some((i) => i.pattern && i.pattern !== 'solid')) prefs -= 0.2;
  if (p.collar && items.some((i) => i.collar)) prefs += 0.1;
  if (p.loose && items.some((i) => ['baggy', 'wide', 'relaxed'].includes(i.fit))) prefs += 0.1;

  const score = Math.max(0, Math.min(1, colour * 0.65 + Math.min(1, prefs) * 0.35));
  if (colour > 0.7) reasons.push(`on your ${mood.label} board`);
  return { score, colour, reasons };
}

/**
 * Pull a small palette out of an image's pixels (RGBA array), skipping
 * near-white and near-black backgrounds unless the whole picture is that.
 * Simple k-means on a sample — good enough to tell "earthy" from "navy".
 */
export function extractPalette(data, k = 5) {
  const px = [];
  for (let i = 0; i < data.length; i += 4 * 17) {
    if (data[i + 3] < 128) continue;
    px.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!px.length) return [];
  let centers = Array.from({ length: k }, (_, n) => px[Math.floor((n + 0.5) * px.length / k)]);
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let best = 0, bd = Infinity;
      centers.forEach((c, j) => {
        const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      });
      const s = sums[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    centers = sums.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[j]));
    centers.counts = sums.map((s) => s[3]);
  }
  const counts = centers.counts ?? centers.map(() => 1);
  const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  return centers
    .map((c, j) => ({ hex: hex(c), n: counts[j] }))
    .sort((a, b) => b.n - a.n)
    .map((c) => c.hex);
}

/** Guess style preferences from a custom palette, so photo boards aren't colour-only. */
export function moodFromPalette(id, label, palette) {
  const chroma = palette.filter((h) => !isNeutral(h)).map((h) => hexToHsl(h).s);
  const quiet = chroma.length <= 1 || Math.max(...chroma) < 0.4;
  return { id, label, palette, custom: true, prefer: quiet ? { plain: true } : {} };
}

const MOODS_KEY = 'wardrobe.moods.v1';

export function loadMoods() {
  try {
    const raw = JSON.parse(localStorage.getItem(MOODS_KEY) ?? '{}');
    return { active: raw.active ?? null, custom: Array.isArray(raw.custom) ? raw.custom : [] };
  } catch {
    return { active: null, custom: [] };
  }
}

export function saveMoods(state) {
  try { localStorage.setItem(MOODS_KEY, JSON.stringify(state)); } catch { /* private mode: board lasts this visit */ }
}

export function allMoods(state) {
  return [...PRESET_MOODS, ...state.custom];
}
