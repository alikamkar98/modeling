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


def segment(bgr, inset, iters):
    h, w = bgr.shape[:2]
    mask = np.zeros((h, w), np.uint8)
    rect = (int(w * inset), int(h * inset), int(w * (1 - 2 * inset)), int(h * (1 - 2 * inset)))
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, rect, bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # One garment per photo: drop everything but the largest piece, then close
    # the small gaps that grabCut leaves along a soft edge.
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n > 1:
        biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        fg = np.where(lbl == biggest, 255, 0).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    # Fill enclosed holes — the gap between two shoes is background, but a
    # hole inside a sweater is the sweater.
    filled = fg.copy()
    flood = np.zeros((fg.shape[0] + 2, fg.shape[1] + 2), np.uint8)
    cv2.floodFill(filled, flood, (0, 0), 255)
    fg = fg | cv2.bitwise_not(filled)
    return fg


def cut(path):
    bgr = cv2.imread(str(path))
    if bgr is None:
        return None, 0.0

    fg = segment(bgr, inset=0.06, iters=5)
    coverage = float(fg.mean()) / 255

    # A garment that came back nearly empty means the rectangle clipped it.
    # Retry from almost the whole frame before giving up on it.
    if coverage < 0.12:
        retry = segment(bgr, inset=0.02, iters=8)
        if float(retry.mean()) / 255 > coverage:
            fg, coverage = retry, float(retry.mean()) / 255

    # Feather the edge by a pixel so cut-outs don't look stamped out.
    alpha = cv2.GaussianBlur(fg, (3, 3), 0)
    rgba = np.dstack([cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), alpha])
    im = Image.fromarray(rgba)

    ys, xs = np.where(fg > 0)
    if len(xs) == 0:
        return None, 0.0
    im = im.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    return im, coverage


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    path = ROOT / 'data' / 'wardrobe.json'
    data = json.loads(path.read_text())

    weak = []
    total = 0
    for item in data['items']:
        im, coverage = cut(ROOT / item['image'])
        if im is None:
            item.pop('cutout', None)
            weak.append((item['name'], 0.0))
            continue
        name = pathlib.Path(item['image']).stem + '.webp'
        im.save(OUT / name, 'WEBP', quality=82, method=6)
        item['cutout'] = f'assets/cutouts/{name}'
        item['cutoutCoverage'] = round(coverage, 3)
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
