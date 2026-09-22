// An outfit laid out as a styled flat lay.
//
// Each garment is cut out of its own photograph and placed into a composed
// arrangement — outerwear and top across the upper half, the bottom running
// down the middle, shoes grounding the lower corner. No body, no mannequin:
// the clothes themselves carry the picture, which is how styling apps and
// lookbooks have always shown an outfit.
//
// Layouts are chosen by which slots the outfit actually fills, so a three-piece
// look isn't laid out with a hole where the jacket would have been.

import { cutout } from './cutout.js';

// Boxes are percentages of the frame: [left, top, width, height].
// They deliberately overlap a little — touching pieces read as one outfit,
// evenly spaced ones read as a catalogue page.
const LAYOUTS = {
  'outerwear,top,bottom,shoes': {
    outerwear: [2, 4, 46, 44],
    top: [50, 10, 40, 34],
    bottom: [10, 44, 42, 50],
    shoes: [54, 60, 38, 30],
  },
  'top,bottom,shoes': {
    top: [6, 4, 50, 42],
    bottom: [46, 26, 46, 54],
    shoes: [8, 60, 38, 32],
  },
  'outerwear,top,bottom': {
    outerwear: [2, 6, 46, 46],
    top: [52, 8, 42, 36],
    bottom: [24, 48, 50, 48],
  },
  'top,bottom': {
    top: [10, 4, 52, 44],
    bottom: [34, 42, 50, 54],
  },
};

const SLOT_ORDER = ['outerwear', 'top', 'bottom', 'shoes'];

/** Pick the layout matching the slots this outfit fills. */
function layoutFor(items) {
  const present = SLOT_ORDER.filter((slot) => items.some((i) => i.category === slot));
  return LAYOUTS[present.join(',')] ?? null;
}

export function renderCollage(items, { id = '' } = {}) {
  const label = items.map((i) => i.name).join(', ');
  return `<div class="collage" data-collage="${id}" role="img" aria-label="Outfit: ${label}"></div>`;
}

/**
 * Fill a collage element with the cut-out garments.
 *
 * Async because the cut-outs are computed from the photographs in the browser.
 * A garment whose cut-out fails is drawn from its original photo instead —
 * better a visible garment with a bit of floor behind it than a gap in the
 * composition.
 */
export async function composeCollage(el, items) {
  if (!el) return;
  const layout = layoutFor(items);
  el.innerHTML = '';

  // Without a matching layout, fall back to an even row so the outfit is still
  // shown rather than silently disappearing.
  const wearable = items.filter((i) => SLOT_ORDER.includes(i.category));
  const boxes = layout
    ? wearable.map((i) => [i, layout[i.category]])
    : wearable.map((i, n) => [i, [4 + n * (92 / wearable.length), 20, 92 / wearable.length - 4, 56]]);

  for (const [item, box] of boxes) {
    if (!box) continue;

    // Only garments that separate cleanly from the floor get cut out; the rest
    // are shown as photographs. See scripts/check_cutouts.py — a cream shirt on
    // pale wood cannot be segmented by colour, and a shredded cut-out looks far
    // worse than an honest photo.
    let piece = null;
    if (item.cutoutOk) {
      try {
        piece = await cutout(item.image);
      } catch (err) {
        console.warn(`cut-out failed for ${item.name}`, err);
      }
    }

    const img = document.createElement('img');
    img.className = `collage__piece collage__piece--${item.category}`
      + (piece ? '' : ' collage__piece--photo');
    img.src = piece ? piece.url : item.image;
    img.alt = item.name;
    img.loading = 'lazy';
    const [left, top, width, height] = box;
    img.style.left = `${left}%`;
    img.style.top = `${top}%`;
    img.style.width = `${width}%`;
    img.style.height = `${height}%`;
    el.appendChild(img);
  }
}
