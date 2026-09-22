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

// Boxes are percentages of the frame: [left, top, width, height].
//
// Nothing overlaps. Pieces stacked on top of one another hide exactly the
// detail you are trying to judge — a collar, a hem, the shape of a shoe — so
// each garment gets its own clear area, sized by how much of the look it
// carries: the bottom runs tall, shoes take the smallest corner.
const LAYOUTS = {
  'outerwear,top,bottom,shoes': {
    outerwear: [3, 3, 45, 45],
    top: [52, 3, 45, 45],
    bottom: [52, 52, 45, 45],
    shoes: [3, 52, 45, 45],
  },
  'top,bottom,shoes': {
    top: [4, 3, 52, 46],
    bottom: [59, 3, 37, 66],
    shoes: [4, 53, 44, 44],
  },
  'outerwear,top,bottom': {
    outerwear: [3, 3, 45, 49],
    top: [52, 3, 45, 45],
    bottom: [22, 55, 56, 42],
  },
  'top,bottom': {
    top: [5, 8, 44, 40],
    bottom: [53, 5, 42, 88],
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
 * The cut-outs are pre-made, so this is synchronous — the composition appears
 * with the card rather than filling in afterwards.
 */
export function composeCollage(el, items) {
  if (!el) return;
  const layout = layoutFor(items);
  el.innerHTML = '';

  // Without a matching layout, fall back to an even row so the outfit is still
  // shown rather than silently disappearing.
  const wearable = items.filter((i) => SLOT_ORDER.includes(i.category));
  const boxes = layout
    ? wearable.map((i) => [i, layout[i.category]])
    : wearable.map((i, n) => [i, [4 + n * (92 / wearable.length), 24, 92 / wearable.length - 5, 52]]);

  for (const [item, box] of boxes) {
    if (!box) continue;

    const img = document.createElement('img');
    img.className = `collage__piece collage__piece--${item.category}`;
    // Cut out offline by scripts/make_cutouts.py; the photograph is only a
    // fallback for a garment that somehow has none.
    img.src = item.cutout || item.image;
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
