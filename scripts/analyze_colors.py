#!/usr/bin/env python3
"""Measure each garment's colour from its own photograph.

Writes dominant and secondary colour, brightness, saturation, warm/cool and
neutrality back into data/wardrobe.json. Everything here is measured, not
guessed: the styling rules downstream are only as good as these numbers.

Usage:  python3 scripts/analyze_colors.py
"""

import colorsys
import json
import pathlib
from collections import Counter

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent


def garment_pixels(path):
    """Pixels belonging to the garment, with floor and shadow discarded."""
    im = Image.open(path).convert('RGB')
    w, h = im.size
    box = im.crop((int(w * .18), int(h * .18), int(w * .82), int(h * .82)))
    box = box.resize((90, 90), Image.LANCZOS)
    out = []
    for r, g, b in box.getdata():
        mx, mn = max(r, g, b), min(r, g, b)
        if mx > 238 and mx - mn < 18:   # blown-out floor
            continue
        if mx < 16:                     # crushed shadow
            continue
        out.append((r, g, b))
    return out or list(box.getdata())


def cluster(pixels, bucket=24):
    """Coarse colour histogram, refined to the mean of each bucket."""
    counts = Counter((r // bucket, g // bucket, b // bucket) for r, g, b in pixels)
    result = []
    for key, n in counts.most_common(6):
        members = [p for p in pixels
                   if (p[0] // bucket, p[1] // bucket, p[2] // bucket) == key]
        r = sum(p[0] for p in members) // len(members)
        g = sum(p[1] for p in members) // len(members)
        b = sum(p[2] for p in members) // len(members)
        result.append(((r, g, b), n / len(pixels)))
    return result


def hex_of(rgb):
    return '#%02x%02x%02x' % rgb


def describe(rgb):
    r, g, b = [c / 255 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    hue = h * 360
    # Warmth by hue family. Reds through yellows read warm, cyans through
    # violets cool; a colour with almost no chroma is neither.
    if s < 0.12:
        temp = 'neutral'
    elif hue < 75 or hue > 320:
        temp = 'warm'
    elif 75 <= hue < 150:
        temp = 'cool' if hue > 110 else 'warm'
    else:
        temp = 'cool'
    return {
        'hue': round(hue),
        'brightness': round(l, 3),
        'saturation': round(s, 3),
        'temperature': temp,
    }


def is_neutral(rgb):
    """Neutrals sit beside any hue without competing."""
    d = describe(rgb)
    s, l, hue = d['saturation'], d['brightness'], d['hue']
    if s < 0.15 or l < 0.22:
        return True
    if l > 0.88 and s < 0.30:
        return True
    if 200 <= hue <= 260 and l < 0.35:          # navy
        return True
    if 20 <= hue <= 50 and s < 0.45 and l > 0.35:   # beige, khaki, tan
        return True
    return False


NAMES = [
    (0, 12, 'red'), (12, 42, 'orange'), (42, 70, 'yellow'), (70, 160, 'green'),
    (160, 200, 'teal'), (200, 250, 'blue'), (250, 290, 'purple'),
    (290, 330, 'pink'), (330, 361, 'red'),
]


def colour_name(rgb):
    d = describe(rgb)
    if d['saturation'] < 0.12:
        if d['brightness'] > 0.80: return 'white'
        if d['brightness'] > 0.55: return 'light grey'
        if d['brightness'] > 0.28: return 'grey'
        return 'black'
    base = next(n for lo, hi, n in NAMES if lo <= d['hue'] < hi)
    if base == 'blue' and d['brightness'] < 0.32: return 'navy'
    if base == 'orange' and d['saturation'] < 0.45 and d['brightness'] > 0.45: return 'beige'
    if base == 'orange' and d['brightness'] < 0.32: return 'brown'
    if base == 'green' and d['saturation'] < 0.35: return 'olive'
    if d['brightness'] < 0.28: return f'dark {base}'
    if d['brightness'] > 0.72: return f'light {base}'
    return base


def main():
    path = ROOT / 'data' / 'wardrobe.json'
    data = json.loads(path.read_text())

    for item in data['items']:
        pixels = garment_pixels(ROOT / item['image'])
        clusters = cluster(pixels)
        dominant = clusters[0][0]

        # Secondary: the next cluster that is visibly a different colour, so a
        # navy shirt with navy shadows doesn't report two navies.
        secondary = None
        for rgb, share in clusters[1:]:
            far = sum(abs(a - b) for a, b in zip(rgb, dominant)) > 90
            if far and share > 0.06:
                secondary = rgb
                break

        d = describe(dominant)
        item['hex'] = hex_of(dominant)
        item['color'] = {
            'name': colour_name(dominant),
            'dominant': hex_of(dominant),
            'secondary': hex_of(secondary) if secondary else None,
            'secondaryName': colour_name(secondary) if secondary else None,
            'brightness': d['brightness'],
            'saturation': d['saturation'],
            'hue': d['hue'],
            'temperature': d['temperature'],
            'neutral': is_neutral(dominant),
        }

    path.write_text(json.dumps(data, indent=1))

    named = Counter(i['color']['name'] for i in data['items'])
    print(f"{len(data['items'])} items analysed")
    print('palette:', ', '.join(f'{n}×{c}' for n, c in named.most_common()))
    print('neutral:', sum(1 for i in data['items'] if i['color']['neutral']),
          '· warm:', sum(1 for i in data['items'] if i['color']['temperature'] == 'warm'),
          '· cool:', sum(1 for i in data['items'] if i['color']['temperature'] == 'cool'))


if __name__ == '__main__':
    main()
