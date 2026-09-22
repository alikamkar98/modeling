#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file.

The published artifact can't fetch anything — not its own sibling files, not
the weather API — so the page has to arrive complete: CSS inlined, modules
concatenated, the catalog embedded, and every garment photo as a data URI.

Usage:  python3 scripts/bundle.py [output.html]
"""

import base64
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Dependency order: each module may only use names defined above it, because
# concatenation replaces the import graph.
ORDER = ['color.js', 'occasions.js', 'weather.js', 'collage.js',
         'retired.js', 'outfits.js', 'app.js']


def strip_module(src):
    """Turn an ES module into plain script source."""
    src = re.sub(r"^\s*import\s+.*?from\s+['\"][^'\"]+['\"];\s*$", "", src, flags=re.M)
    src = re.sub(r"^\s*export\s+(?=(const|function|async function|class|let))", "", src, flags=re.M)
    return src


def build():
    # A module added to src/ but not to ORDER produces a page that throws on
    # load with no other symptom, so fail loudly here instead.
    on_disk = {p.name for p in (ROOT / 'src').glob('*.js')}
    missing = on_disk - set(ORDER)
    if missing:
        raise SystemExit(f"scripts/bundle.py: add {', '.join(sorted(missing))} to ORDER")
    stale = set(ORDER) - on_disk
    if stale:
        raise SystemExit(f"scripts/bundle.py: ORDER lists missing file(s) {', '.join(sorted(stale))}")

    js = "\n".join(strip_module((ROOT / 'src' / f).read_text()) for f in ORDER)

    wardrobe = json.loads((ROOT / 'data' / 'wardrobe.json').read_text())
    for item in wardrobe['items']:
        cut = ROOT / item['cutout']
        data_uri = 'data:image/webp;base64,' + base64.b64encode(cut.read_bytes()).decode()
        item['cutout'] = data_uri
        # The photograph is only a fallback, and the cut-out is derived from it;
        # shipping both would double the file for no visible gain.
        item['image'] = data_uri

    # The catalog ships inside the page, so there is nothing to fetch.
    js = re.sub(
        r"async function loadWardrobe\(\) \{.*?\n\}\n",
        "async function loadWardrobe() {\n  return { items: WARDROBE.items, isDemo: false };\n}\n",
        js, flags=re.S)

    css = (ROOT / 'src' / 'style.css').read_text()
    html = (ROOT / 'index.html').read_text()
    body = html.split('<body>')[1].split('</body>')[0]
    body = body.replace('<script type="module" src="src/app.js"></script>', '')

    # No doctype/html/head/body: the artifact runtime supplies that wrapper.
    return f"""<title>Wardrobe</title>
<style>
{css}
</style>
{body}
<script>
const WARDROBE = {json.dumps(wardrobe)};
{js}
</script>
"""


if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'dist' / 'wardrobe.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    page = build()
    out.write_text(page)
    mb = len(page.encode()) / 1e6
    print(f"{out}  {mb:.2f} MB")
    if mb > 16:
        raise SystemExit("over the 16 MB artifact limit")
