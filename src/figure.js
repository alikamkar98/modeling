// A figure wearing the actual garments.
//
// Each piece is cut out of its own photograph and laid over a drawn body, so
// what you see is your real clothes rather than a colour diagram of them. The
// drawn body only supplies head, hands and the parts no garment covers.
//
// The cut-outs are produced in the browser (see cutout.js), so nothing extra
// ships with the page; until they resolve, the body renders on its own.

import { cutout } from './cutout.js';

const SKIN = '#c9a88a';
const HAIR = '#3a2c22';

// Where each layer sits on the 200x300 body, as percentages of the frame.
// Tuned so a flat-laid garment lands where it would be worn: shoulders at the
// collarbone, a waistband at the hips, shoes on the ground.
const PLACEMENT = {
  top:       { top: 20, height: 30, width: 66, lie: 'wide' },
  swimwear:  { top: 47, height: 14, width: 46, lie: 'wide' },
  bottom:    { top: 46, height: 42, width: 46, lie: 'tall' },
  outerwear: { top: 18, height: 36, width: 80, lie: 'wide' },
  shoes:     { top: 83, height: 14, width: 42, lie: 'wide' },
};

// Trousers cover the hips; shorts stop above the knee — and a pair of shorts
// is naturally wider than it is tall, so it must not be stood upright the way
// trousers are.
function placementFor(item) {
  const base = PLACEMENT[item.category];
  if (!base) return null;
  if (item.category === 'bottom' && /short|bib/.test(item.subtype || '')) {
    return { ...base, height: 22, lie: 'wide' };
  }
  return base;
}

function bodySvg() {
  return `<svg class="figure__body" viewBox="0 0 200 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <ellipse cx="100" cy="30" rx="23" ry="21" fill="${HAIR}"/>
    <circle cx="100" cy="38" r="20" fill="${SKIN}"/>
    <rect x="93" y="55" width="14" height="12" fill="${SKIN}"/>
    <rect x="76" y="64" width="48" height="92" rx="12" fill="${SKIN}"/>
    <rect x="62" y="72" width="14" height="74" rx="7" fill="${SKIN}"/>
    <rect x="124" y="72" width="14" height="74" rx="7" fill="${SKIN}"/>
    <circle cx="69" cy="152" r="8" fill="${SKIN}"/>
    <circle cx="131" cy="152" r="8" fill="${SKIN}"/>
    <rect x="83" y="150" width="15" height="104" rx="7" fill="${SKIN}"/>
    <rect x="102" y="150" width="15" height="104" rx="7" fill="${SKIN}"/>
  </svg>`;
}

/**
 * Render the figure.
 *
 * Returns the markup immediately with the body only; call `dressFigure` on the
 * resulting element to lay the garments over it once their cut-outs are ready.
 */
export function renderFigure(items, { width = 200, height = 300 } = {}) {
  const label = items.map((i) => i.name).join(', ');
  return `<div class="figure" style="aspect-ratio:${width}/${height}"
    role="img" aria-label="Figure wearing ${label}">${bodySvg()}</div>`;
}

// Drawn body first, then what is worn over it, outermost last.
const ORDER = ['swimwear', 'bottom', 'top', 'outerwear', 'shoes'];

/** Lay the garments onto a figure element produced by `renderFigure`. */
export async function dressFigure(el, items) {
  const layers = ORDER
    .map((cat) => items.find((i) => i.category === cat))
    .filter(Boolean);

  for (const item of layers) {
    const place = placementFor(item);
    if (!place || !item.image) continue;

    let piece = null;
    try {
      piece = await cutout(item.image);
    } catch (err) {
      // Swallowing this silently once cost an afternoon: the figure rendered
      // empty and reported no errors at all.
      console.warn(`cut-out failed for ${item.name}`, err);
    }
    // Without a clean cut-out the photo would carry its floor onto the body,
    // which looks worse than leaving the layer off.
    if (!piece) continue;

    const img = document.createElement('img');
    img.className = 'figure__garment';
    img.src = piece.url;
    img.alt = item.name;
    img.style.top = `${place.top}%`;
    img.style.height = `${place.height}%`;
    img.style.width = `${place.width}%`;
    // Deskewing straightens a garment but can't know which way round it
    // belongs. Its proportions can: a shirt is wider than it is tall once the
    // sleeves are out, trousers are the other way round. Anything photographed
    // against that gets turned a quarter turn.
    const isWide = piece.width >= piece.height;
    const wantsWide = place.lie === 'wide';
    if (isWide !== wantsWide) {
      img.style.transform = 'translateX(-50%) rotate(90deg)';
    }
    el.appendChild(img);
  }
}
