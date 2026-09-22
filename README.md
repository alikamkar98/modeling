# Wardrobe

Tells you what to wear from the clothes you actually own, based on where you're
going and what the weather in Linz is doing.

You type a destination, the app checks live conditions, and it returns three
complete outfits — each one scored on colour contrast, colour harmony, and
style coherence, shown on a figure so you can see the palette at a glance.

## Running it

It's a static site. No build step, no dependencies, no API keys.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from the filesystem won't work — ES modules and
`fetch` need a real origin. Any static server will do.

## Your photos stay on your device

The repository holds classifications, not pictures. On first use, open **My
clothes → Add photos from this device** and pick your garment photos; the app
keeps them in the browser's IndexedDB and matches them to catalog entries by
filename. Nothing is uploaded and nothing is committed.

The trade-off: browser storage is per-device, so opening the app on a different
device means picking the photos again there. HEIC works as-is in Safari, so
photos straight from an iPhone or iPad need no conversion.

Until your wardrobe is classified, the app shows a placeholder set so the
interface is explorable. It says so in **My clothes** — those aren't your
clothes.

## How a suggestion is made

1. **Weather** (`src/weather.js`) — live conditions from Open-Meteo, keyless
   and CORS-open. Feels-like temperature sets a warmth band; rain probability
   and the weather code call for waterproofs; wind argues for an outer layer.
   If the call fails the app says so and offers a manual control rather than
   inventing conditions.
2. **Destination** (`src/occasions.js`) — free text maps to an occasion
   profile, which declares the slots that must be filled and a formality band.
   Unrecognised text is flagged, not silently treated as a match.
3. **Candidates** (`src/outfits.js`) — items too warm for the day, or too far
   from the occasion's formality and style, are dropped. Items that are merely
   *thin* are kept: cold is answered by layering, so a cotton shirt is still
   valid at −2 °C once a coat goes over it.
4. **Scoring** — each combination is judged on harmony (32%), style coherence
   (26%), contrast (22%), and weather fit (20%).
5. **Figure** (`src/figure.js`) — an SVG diagram in each garment's real colour.
   It's a schematic of the palette, not a render of your clothes.

### What the colour rules actually check

- **Contrast** uses WCAG relative luminance. The failure it catches is the
  "muddy middle" — everything at one mid tone, which reads as an accident.
- **Harmony** judges hue relationships: monochrome, analogous (within ~45°),
  complementary (only as an accent, not a 50/50 split), and neutral-anchored —
  one colour carried by neutrals, the most reliable outfit there is. Hues
  45–150° apart are penalised: too far apart to match, too close to look
  deliberate.
- **Style** penalises formality spread and mixes of incompatible families, so a
  blazer never lands on running shorts. One loud pattern per outfit.

These weights are taste expressed as numbers. They're a starting point — expect
to adjust them in `WEIGHTS` in `src/outfits.js` once you disagree with a few
suggestions.

## Tests

```bash
node --test "test/*.test.js"
```

Covers the colour maths against known pairs, weather-to-requirement mapping,
destination parsing, and the core guarantee: across every occasion and a −5 °C
to 32 °C sweep, wet and dry, every returned outfit fills its required slots,
uses only real items, never repeats one, and a request that can't be filled
names what's missing instead of returning nothing.

## Adding clothes

See [`scripts/ingest.md`](scripts/ingest.md).

## Layout

| Path | Purpose |
|---|---|
| `index.html` | App shell |
| `src/app.js` | UI wiring and state |
| `src/outfits.js` | Candidate selection and scoring |
| `src/color.js` | Luminance, contrast, hue harmony, neutrality |
| `src/weather.js` | Linz conditions, with a manual fallback |
| `src/occasions.js` | Destination → slots and formality |
| `src/figure.js` | SVG figure renderer |
| `src/photos.js` | On-device photo storage |
| `data/wardrobe.json` | Your classified wardrobe |
| `data/demo-wardrobe.json` | Placeholders for exploring the UI |
