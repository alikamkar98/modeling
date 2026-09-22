// Colour maths for judging an outfit: contrast, harmony, and neutrality.
//
// Everything here works from a garment's sampled hex. Working from the colour
// *name* ("navy") is not enough — two navies can sit far enough apart in
// lightness to read as a deliberate contrast, or close enough to look like a
// failed match, and only the actual value tells you which.

export function hexToRgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  return { h: h * 360, s, l };
}

export const hexToHsl = (hex) => rgbToHsl(hexToRgb(hex));

// WCAG relative luminance — the standard perceptual "how light is this"
// measure, which weights green far above blue as the eye does.
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio, 1 (identical) to 21 (black on white).
export function contrastRatio(hexA, hexB) {
  const a = luminance(hexA);
  const b = luminance(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Shortest distance between two hues on the wheel, 0-180.
export function hueDistance(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

// A neutral carries so little chroma that it sits beside any hue without
// competing: black, white, the greys, and the off-neutrals a wardrobe leans
// on — navy, beige, cream, khaki, denim.
export function isNeutral(hex) {
  const { s, l } = hexToHsl(hex);
  if (s < 0.15) return true;              // greyscale
  if (l < 0.22) return true;              // near-black reads neutral whatever its hue
  if (l > 0.88 && s < 0.30) return true;  // cream, off-white
  const { h } = hexToHsl(hex);
  const navy = h >= 200 && h <= 260 && l < 0.35;       // navy
  const earth = h >= 20 && h <= 50 && s < 0.45 && l > 0.35; // beige, khaki, tan
  return navy || earth;
}

/**
 * Judge the colour relationship across a whole outfit.
 *
 * Returns a 0-1 score plus a plain-language label, so the app can tell the
 * user *why* a set works rather than just handing them a number.
 */
export function harmonyOf(hexes) {
  const colors = hexes.filter(Boolean);
  if (colors.length < 2) return { score: 0.7, scheme: 'single colour', reasons: [] };

  const reasons = [];
  const accents = colors.filter((c) => !isNeutral(c));
  const neutralCount = colors.length - accents.length;

  // Every-neutral outfits are safe but can go flat; contrast scoring below
  // decides whether this one did.
  if (accents.length === 0) {
    return { score: 0.78, scheme: 'all neutrals', reasons: ['neutral palette — safe in any setting'] };
  }

  // One colour carried by neutrals is the most reliable outfit there is.
  if (accents.length === 1 && neutralCount >= 1) {
    return {
      score: 0.95,
      scheme: 'neutral-anchored',
      reasons: ['one colour against neutrals — always reads deliberate'],
    };
  }

  const hues = accents.map((c) => hexToHsl(c).h);
  let worst = 0;
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      worst = Math.max(worst, hueDistance(hues[i], hues[j]));
    }
  }

  let score;
  let scheme;
  if (worst <= 15) {
    score = 0.92; scheme = 'monochrome';
    reasons.push('one hue at different depths');
  } else if (worst <= 45) {
    score = 0.88; scheme = 'analogous';
    reasons.push('neighbouring hues — quiet and cohesive');
  } else if (worst >= 150) {
    // Complementary works as an accent, not as a half-and-half split.
    const balanced = accents.length === 2 && neutralCount === 0;
    score = balanced ? 0.55 : 0.84;
    scheme = 'complementary';
    reasons.push(balanced
      ? 'opposite hues in equal measure — loud, needs a neutral between them'
      : 'opposite hues, one as an accent');
  } else {
    // 45-150 degrees: far enough apart to argue, too close to look intentional.
    score = 0.35; scheme = 'clashing';
    reasons.push('hues too far apart to match and too close to contrast');
  }

  // More than two saturated colours starts to look accidental regardless of
  // where they sit on the wheel.
  const loud = accents.filter((c) => hexToHsl(c).s > 0.55).length;
  if (loud > 2) {
    score -= 0.25;
    reasons.push(`${loud} strong colours competing`);
  }

  return { score: Math.max(0, Math.min(1, score)), scheme, reasons };
}

/**
 * Score the tonal structure of an outfit.
 *
 * The failure this catches is the "muddy middle": three garments all at the
 * same mid lightness, which reads as an accident rather than a choice. A good
 * outfit usually has a clear light/dark step somewhere in it.
 */
export function contrastOf(hexes) {
  const colors = hexes.filter(Boolean);
  if (colors.length < 2) return { score: 0.7, reasons: [] };

  const lums = colors.map(luminance).sort((a, b) => a - b);
  const spread = lums[lums.length - 1] - lums[0];
  const reasons = [];

  let score;
  if (spread < 0.05) {
    // Near-identical tones. Fine if the colours genuinely match, poor if not.
    score = 0.45;
    reasons.push('everything at one tone — flat');
  } else if (spread < 0.15) {
    score = 0.55;
    reasons.push('tones close enough to look like a near-miss');
  } else if (spread < 0.55) {
    score = 0.95;
    reasons.push('clear light–dark structure');
  } else {
    score = 0.82;
    reasons.push('strong light–dark contrast');
  }

  return { score, spread, reasons };
}
