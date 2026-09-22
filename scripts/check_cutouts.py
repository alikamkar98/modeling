#!/usr/bin/env python3
"""Decide, per garment, whether background removal can be trusted.

Every photo is a flat lay on pale wood. Whether a garment can be lifted off it
comes down to one thing: how far the garment's colour sits from the floor's.
Navy jeans separate cleanly. A cream shirt does not — colour alone cannot tell
it from the floorboards, so the flood walks into the garment and shreds it.

Geometry does not predict this. A shredded white t-shirt can score *better* on
area and solidity than a cleanly cut pair of jeans, because the fragments still
fill their bounding box. Colour distance does predict it, so that is what this
measures, with a conservative threshold: a garment shown as a plain photograph
looks deliberate, a shredded cut-out never does.

Usage:  python3 scripts/check_cutouts.py
"""

import json
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Summed per-channel distance between garment and floor. Measured across the
# wardrobe, clean cut-outs sit at 380+ and every failure below 210; 250 leaves
# a margin on the side of falling back.
THRESHOLD = 250


def floor_colour(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    samples = ([px[x, 0] for x in range(0, w, 3)] + [px[x, h - 1] for x in range(0, w, 3)]
               + [px[0, y] for y in range(0, h, 3)] + [px[w - 1, y] for y in range(0, h, 3)])
    return tuple(sorted(c[i] for c in samples)[len(samples) // 2] for i in range(3))


def main():
    path = ROOT / 'data' / 'wardrobe.json'
    data = json.loads(path.read_text())

    ok = 0
    for item in data['items']:
        floor = floor_colour(ROOT / item['image'])
        hexv = item['color']['dominant'].lstrip('#')
        garment = tuple(int(hexv[i:i + 2], 16) for i in (0, 2, 4))
        distance = sum(abs(a - b) for a, b in zip(floor, garment))
        item['cutoutOk'] = distance >= THRESHOLD
        item['floorDistance'] = distance
        ok += item['cutoutOk']

    path.write_text(json.dumps(data, indent=1))
    print(f"{ok} of {len(data['items'])} garments cut out cleanly; "
          f"{len(data['items']) - ok} shown as photographs")


if __name__ == '__main__':
    main()
