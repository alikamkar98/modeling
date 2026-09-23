#!/usr/bin/env python3
"""Cut every garment out of its photograph, once, offline.

Colour flooding could not do this. The photos are flat lays on pale wood, and a
cream shirt on cream floorboards is not separable by colour distance — the
flood walks into the garment and shreds it. GrabCut is: it learns foreground
and background colour models from a rough rectangle and refines the boundary,
so it separates garments that merely *resemble* the floor.

Doing it here rather than in the browser also means the app ships finished
cut-outs instead of segmenting 105 photographs on every device.

Output: assets/cutouts/<name>.webp — transparent, trimmed, ~420px.
WebP because a PNG of a photograph with alpha is several hundred KB, and 105 of
those would not fit the published single-file build.

Usage:  python3 scripts/make_cutouts.py
"""

import json
import pathlib

import cv2
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'cutouts'
MAX_EDGE = 420


HINTS = {k: v for k, v in json.loads((ROOT / 'scripts' / 'cutout_hints.json').read_text()).items()
         if not k.startswith('_')}


def floor_model(bgr):
    """Median colour of the frame edge, and how much it varies."""
    edge = np.concatenate([bgr[0], bgr[-1], bgr[:, 0], bgr[:, -1]]).astype(np.float32)
    med = np.median(edge, axis=0)
    spread = float(np.percentile(np.abs(edge - med).sum(1), 80))
    return med, max(spread, 18.0)


def grabcut_rect(bgr, inset, iters):
    h, w = bgr.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    rect = (int(w * inset), int(h * inset), int(w * (1 - 2 * inset)), int(h * (1 - 2 * inset)))
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, rect, bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    return np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)


def grabcut_hinted(bgr, hint, iters=8):
    """GrabCut seeded from hand-placed boxes, the way it is meant to be used.

    Unlike the plain rectangle, the garment area may touch the frame edge, so a
    shoe running off the photo is not declared background.
    """
    h, w = bgr.shape[:2]

    def box(b):
        x0, y0, x1, y1 = b
        return slice(int(y0 * h), max(int(y0 * h) + 1, int(y1 * h))), \
               slice(int(x0 * w), max(int(x0 * w) + 1, int(x1 * w)))

    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    ys, xs = box(hint['rect'])
    mask[ys, xs] = cv2.GC_PR_FGD
    for b in hint.get('bg', []):
        ys, xs = box(b)
        mask[ys, xs] = cv2.GC_BGD
    for b in hint.get('fg', []):
        ys, xs = box(b)
        mask[ys, xs] = cv2.GC_FGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, None, bgd, fgd, iters, cv2.GC_INIT_WITH_MASK)
    return np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)


def clean(fg, hole_frac=0.012):
    h, w = fg.shape
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n > 1:
        # Keep the main piece and any other piece at least a third its size:
        # a pair of shoes or socks is two separate blobs, a scrap of floor is
        # not that big.
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = [i + 1 for i, a in enumerate(areas) if a >= areas.max() / 3]
        fg = np.isin(lbl, keep).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    # Fill only SMALL enclosed holes. A crease inside a sweater is a hole to
    # fill; the gap between two shoes is floor and must stay open. Filling every
    # enclosed hole is what trapped floorboards between shoe pairs.
    inv = cv2.bitwise_not(fg)
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(inv, 4)
    for i in range(1, n):
        x, y, bw, bh, a = stats[i]
        touches = x == 0 or y == 0 or x + bw >= w or y + bh >= h
        if not touches and a < hole_frac * h * w:
            fg[lbl == i] = 255
    return fg


def peel_floor(bgr, fg, strength=1.5):
    """Remove floor-coloured fringe attached to the outside of a garment.

    Only ever applied to garments far from the floor colour. On a pale garment
    the floor-coloured pixels ARE the garment, and peeling shreds it.
    """
    med, spread = floor_model(bgr)
    dist = np.abs(bgr.astype(np.float32) - med).sum(2)
    floorish = (dist < spread * strength) & (fg > 0)
    region = (floorish | (fg == 0)).astype(np.uint8)
    _, lbl = cv2.connectedComponents(region, connectivity=4)
    outside = set(np.unique(lbl[fg == 0])) - {0}
    peel = np.isin(lbl, list(outside)) & floorish
    out = fg.copy()
    out[peel] = 0
    return out


def distance_from_floor(bgr, fg):
    med, _ = floor_model(bgr)
    px = bgr[fg > 0].astype(np.float32)
    return float(np.abs(np.median(px, axis=0) - med).sum()) if len(px) else 0.0


def cut(path):
    bgr = cv2.imread(str(path))
    if bgr is None:
        return None, 0.0, 'unreadable'

    hint = HINTS.get(path.stem)
    if hint:
        fg = clean(grabcut_hinted(bgr, hint))
        method = 'hinted'
    else:
        fg = clean(grabcut_rect(bgr, inset=0.06, iters=5))
        if float(fg.mean()) / 255 < 0.12:
            retry = clean(grabcut_rect(bgr, inset=0.02, iters=8))
            if retry.mean() > fg.mean():
                fg = retry
        method = 'auto'
        # Peel attached floor off dark garments only. Measured on this
        # wardrobe: pale grey running shoes sit near 220 and shred; every dark
        # garment is above 340.
        if distance_from_floor(bgr, fg) >= 330:
            fg = clean(peel_floor(bgr, fg))
            method = 'auto+peel'

    coverage = float(fg.mean()) / 255
    alpha = cv2.GaussianBlur(fg, (3, 3), 0)
    rgba = np.dstack([cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), alpha])
    im = Image.fromarray(rgba)
    ys, xs = np.where(fg > 0)
    if len(xs) == 0:
        return None, 0.0, method
    im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    return im, coverage, method


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    path = ROOT / 'data' / 'wardrobe.json'
    data = json.loads(path.read_text())

    weak = []
    total = 0
    for item in data['items']:
        im, coverage, method = cut(ROOT / item['image'])
        if im is None:
            item.pop('cutout', None)
            weak.append((item['name'], 0.0))
            continue
        name = pathlib.Path(item['image']).stem + '.webp'
        im.save(OUT / name, 'WEBP', quality=82, method=6)
        item['cutout'] = f'assets/cutouts/{name}'
        item['cutoutCoverage'] = round(coverage, 3)
        item['cutoutMethod'] = method
        total += (OUT / name).stat().st_size
        # Flag the extremes for review: a sliver is a clipped garment, and
        # almost the whole frame means the floor came along too.
        if coverage < 0.12 or coverage > 0.72:
            weak.append((item['name'], coverage))

    # cutoutOk / floorDistance described the old colour-flood method and no
    # longer mean anything.
    for item in data['items']:
        item.pop('cutoutOk', None)
        item.pop('floorDistance', None)

    path.write_text(json.dumps(data, indent=1))
    print(f"{len(data['items'])} cut out · {total/1e6:.1f} MB total")
    if weak:
        print('worth a look:')
        for name, c in weak:
            print(f'  {name:36s} coverage {c*100:.0f}%')


if __name__ == '__main__':
    main()
