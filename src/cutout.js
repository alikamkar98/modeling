// Lifts a garment off the floor it was photographed on.
//
// Every photo is a flat lay on the same wooden floor, which makes the
// background the one thing that always touches the frame edge. So: flood from
// the border across pixels close to the floor's colour, keep what the flood
// can't reach, then discard everything but the largest piece — that removes the
// stray shadow patches and offcuts of rug that survive the colour test.
//
// This runs in the browser at render time rather than shipping a second set of
// cut-out images, which would roughly double the size of the page.

const cache = new Map();

const TOLERANCE = 34 * 3;   // summed per-channel distance from the floor colour

function floorColour(data, w, h) {
  const samples = [];
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < w; x += 2) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += 2) { push(0, y); push(w - 1, y); }
  // Median per channel: robust to a garment that happens to touch an edge.
  return [0, 1, 2].map((c) => {
    const vs = samples.map((s) => s[c]).sort((a, b) => a - b);
    return vs[vs.length >> 1];
  });
}

function floodBackground(data, w, h, ref) {
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;

  const seed = (x, y) => {
    const p = y * w + x;
    if (bg[p]) return;
    const i = p * 4;
    if (Math.abs(data[i] - ref[0]) + Math.abs(data[i + 1] - ref[1]) + Math.abs(data[i + 2] - ref[2]) < TOLERANCE) {
      bg[p] = 1; queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }

  while (head < tail) {
    const p = queue[head++];
    const x = p % w, y = (p / w) | 0;
    const tryPixel = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const np = ny * w + nx;
      if (bg[np]) return;
      const i = np * 4;
      if (Math.abs(data[i] - ref[0]) + Math.abs(data[i + 1] - ref[1]) + Math.abs(data[i + 2] - ref[2]) < TOLERANCE) {
        bg[np] = 1; queue[tail++] = np;
      }
    };
    tryPixel(x + 1, y); tryPixel(x - 1, y); tryPixel(x, y + 1); tryPixel(x, y - 1);
  }
  return bg;
}

/** Keep only the biggest connected blob of foreground — the garment itself. */
function largestBlob(bg, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let best = -1, bestSize = 0, current = 0;

  for (let p = 0; p < w * h; p++) {
    if (bg[p] || label[p] !== -1) continue;
    let head = 0, tail = 0, size = 0;
    label[p] = current; queue[tail++] = p;
    while (head < tail) {
      const q = queue[head++]; size++;
      const x = q % w, y = (q / w) | 0;
      const visit = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const np = ny * w + nx;
        if (bg[np] || label[np] !== -1) return;
        label[np] = current; queue[tail++] = np;
      };
      visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1);
    }
    if (size > bestSize) { bestSize = size; best = current; }
    current++;
  }
  return { label, best };
}

/**
 * Find the tilt of a mask, in radians.
 *
 * Garments are photographed at whatever angle they happened to land, so a
 * sweater can arrive lying diagonally. Rotating to the angle whose axis-aligned
 * bounding box is smallest straightens it without having to guess which end is
 * the collar. Measured on a coarse grid because a few degrees either way is
 * invisible and the search is quadratic in resolution.
 */
function deskewAngle(mask, w, h) {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 120));
  const pts = [];
  let cx = 0, cy = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (mask[y * w + x]) { pts.push(x, y); cx += x; cy += y; }
    }
  }
  const n = pts.length / 2;
  if (n < 20) return 0;
  cx /= n; cy /= n;

  let best = 0, bestArea = Infinity;
  // Clamped to a modest range: beyond about 20 degrees the smallest bounding
  // box stops meaning "straight" and starts meaning "lying on its side", which
  // the caller decides from the garment's own shape instead.
  for (let deg = -20; deg <= 20; deg += 2) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const dx = pts[i] - cx, dy = pts[i + 1] - cy;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area < bestArea) { bestArea = area; best = a; }
  }
  return best;
}

/**
 * Cut a garment out of its photo.
 *
 * Resolves to `{ url, width, height }` — a transparent PNG cropped to the
 * garment — or `null` if the image can't be read, in which case the caller
 * should fall back to the photo as-is.
 */
export async function cutout(src) {
  if (cache.has(src)) return cache.get(src);

  const promise = (async () => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    try {
      await img.decode();
    } catch {
      return null;
    }

    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    let image;
    try {
      image = ctx.getImageData(0, 0, w, h);
    } catch {
      return null;   // tainted canvas
    }
    const data = image.data;

    const bg = floodBackground(data, w, h, floorColour(data, w, h));
    const { label, best } = largestBlob(bg, w, h);

    let minX = w, minY = h, maxX = 0, maxY = 0, kept = 0;
    for (let p = 0; p < w * h; p++) {
      if (label[p] === best && !bg[p]) {
        kept++;
        const x = p % w, y = (p / w) | 0;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      } else {
        data[p * 4 + 3] = 0;
      }
    }
    // A garment that fills almost nothing means the segmentation failed.
    if (kept < w * h * 0.04) return null;

    ctx.putImageData(image, 0, 0);

    // Straighten, then crop to what is left.
    const mask = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) mask[p] = (label[p] === best && !bg[p]) ? 1 : 0;
    const angle = deskewAngle(mask, w, h);

    let source = canvas;
    if (Math.abs(angle) > 0.02) {
      const diag = Math.ceil(Math.hypot(w, h));
      const rot = document.createElement('canvas');
      rot.width = diag; rot.height = diag;
      const rctx = rot.getContext('2d', { willReadFrequently: true });
      rctx.translate(diag / 2, diag / 2);
      rctx.rotate(angle);
      rctx.drawImage(canvas, -w / 2, -h / 2);
      source = rot;
      // Re-measure the bounds of the straightened garment.
      const rd = rctx.getImageData(0, 0, diag, diag).data;
      minX = diag; minY = diag; maxX = 0; maxY = 0;
      for (let y = 0; y < diag; y++) {
        for (let x = 0; x < diag; x++) {
          if (rd[(y * diag + x) * 4 + 3] > 8) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
    }

    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    if (cw < 2 || ch < 2) return null;
    const cropped = document.createElement('canvas');
    cropped.width = cw; cropped.height = ch;
    cropped.getContext('2d').drawImage(source, minX, minY, cw, ch, 0, 0, cw, ch);

    return { url: cropped.toDataURL('image/png'), width: cw, height: ch };
  })();

  cache.set(src, promise);
  return promise;
}
