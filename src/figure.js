// A schematic figure showing how an outfit's colours sit together.
//
// This is deliberately not a rendering of your actual garments — it is a
// diagram of the palette in the shape of a person, so a clash is visible at a
// glance. The real photos beside it carry the detail.

const SKIN = '#c9a88a';

const shapes = {
  // Bottoms
  shorts: (c) => `<path d="M62 150 h76 l-5 52 h-30 l-3 -30 -3 30 h-30 z" fill="${c}"/>`,
  trousers: (c) => `<path d="M62 150 h76 l-6 98 h-26 l-6 -72 -6 72 h-26 z" fill="${c}"/>`,
  skirt: (c) => `<path d="M62 150 h76 l14 60 h-104 z" fill="${c}"/>`,

  // Tops
  tshirt: (c) => `
    <path d="M70 68 q30 -12 60 0 l16 12 -10 22 -8 -6 v58 h-56 v-58 l-8 6 -10 -22 z" fill="${c}"/>`,
  longsleeve: (c) => `
    <path d="M70 68 q30 -12 60 0 l18 14 -6 62 -16 -4 4 -32 -2 46 h-56 v-46 l-2 32 -16 4 -6 -62 z" fill="${c}"/>`,
  tank: (c) => `
    <path d="M80 66 q20 -8 40 0 l4 10 -6 6 v72 h-36 v-72 l-6 -6 z" fill="${c}"/>`,

  // Outer layer, drawn over the top
  jacket: (c) => `
    <path d="M66 70 q12 -8 20 -4 l14 10 14 -10 q8 -4 20 4 l14 12 -8 64 -14 -4 4 -30 -2 52 h-64 v-52 l-2 30 -14 4 -8 -64 z"
      fill="${c}" opacity="0.96"/>`,

  // Feet
  shoes: (c) => `
    <path d="M78 248 h22 v10 q0 6 -11 6 t-11 -6 z" fill="${c}"/>
    <path d="M100 248 h22 v10 q0 6 -11 6 t-11 -6 z" fill="${c}"/>`,
  sandals: (c) => `
    <path d="M80 252 h18 v6 h-18 z M102 252 h18 v6 h-18 z" fill="${c}"/>`,

  swimwear: (c) => `<path d="M64 152 h72 l-6 34 h-60 z" fill="${c}"/>`,
};

function pickShape(item) {
  const s = (item.subtype || '').toLowerCase();
  switch (item.category) {
    case 'bottom':
      if (s.includes('short')) return shapes.shorts;
      if (s.includes('skirt') || s.includes('dress')) return shapes.skirt;
      return shapes.trousers;
    case 'top':
      if (s.includes('tank') || s.includes('vest')) return shapes.tank;
      if (s.includes('shirt') && !s.includes('t-shirt')) return shapes.longsleeve;
      if (s.includes('sweater') || s.includes('jumper') || s.includes('hoodie') || s.includes('long')) return shapes.longsleeve;
      return shapes.tshirt;
    case 'outerwear':
      return shapes.jacket;
    case 'shoes':
      return item.openToe || s.includes('sandal') || s.includes('flip') ? shapes.sandals : shapes.shoes;
    case 'swimwear':
      return shapes.swimwear;
    default:
      return null;
  }
}

// Stripes and checks read as texture at this size; the point is only to show
// that the garment is not plain.
function patternDefs(items) {
  const used = new Set(items.map((i) => i.pattern).filter((p) => p && p !== 'solid'));
  if (!used.size) return '';
  return `<defs>
    ${used.has('striped') ? `<pattern id="p-striped" width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="rgba(255,255,255,0)"/>
      <rect width="4" height="8" fill="rgba(0,0,0,0.18)"/></pattern>` : ''}
    ${used.has('checked') ? `<pattern id="p-checked" width="10" height="10" patternUnits="userSpaceOnUse">
      <rect width="10" height="10" fill="rgba(255,255,255,0)"/>
      <rect width="5" height="10" fill="rgba(0,0,0,0.12)"/>
      <rect width="10" height="5" fill="rgba(0,0,0,0.12)"/></pattern>` : ''}
    ${used.has('printed') ? `<pattern id="p-printed" width="9" height="9" patternUnits="userSpaceOnUse">
      <rect width="9" height="9" fill="rgba(255,255,255,0)"/>
      <circle cx="4.5" cy="4.5" r="2" fill="rgba(0,0,0,0.16)"/></pattern>` : ''}
  </defs>`;
}

function overlayFor(item, shape) {
  if (!item.pattern || item.pattern === 'solid') return '';
  return shape(`url(#p-${item.pattern})`);
}

/**
 * Render an outfit as an SVG string.
 *
 * Layers are drawn body-first so outerwear lands on top of the shirt, the way
 * it would be worn.
 */
export function renderFigure(items, { width = 200, height = 300 } = {}) {
  const order = ['bottom', 'swimwear', 'top', 'outerwear', 'shoes'];
  const layered = order
    .map((cat) => items.find((i) => i.category === cat))
    .filter(Boolean);

  const garments = layered.map((item) => {
    const shape = pickShape(item);
    if (!shape) return '';
    return shape(item.hex || '#888888') + overlayFor(item, shape);
  }).join('\n');

  return `<svg viewBox="0 0 200 300" width="${width}" height="${height}" role="img"
    aria-label="Figure wearing ${items.map((i) => i.name).join(', ')}"
    xmlns="http://www.w3.org/2000/svg">
    ${patternDefs(layered)}
    <!-- body -->
    <circle cx="100" cy="38" r="22" fill="${SKIN}"/>
    <rect x="92" y="58" width="16" height="12" fill="${SKIN}"/>
    <rect x="76" y="66" width="48" height="90" rx="10" fill="${SKIN}"/>
    <rect x="62" y="74" width="14" height="70" rx="7" fill="${SKIN}"/>
    <rect x="124" y="74" width="14" height="70" rx="7" fill="${SKIN}"/>
    <rect x="82" y="150" width="14" height="100" rx="7" fill="${SKIN}"/>
    <rect x="104" y="150" width="14" height="100" rx="7" fill="${SKIN}"/>
    <!-- A hairline keeps pale garments (white shirts, cream shoes) legible
         against the figure instead of dissolving into the background. -->
    <g stroke="rgba(0,0,0,0.22)" stroke-width="1" stroke-linejoin="round">
      ${garments}
    </g>
  </svg>`;
}
