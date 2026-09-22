# Ingesting the wardrobe

Runbook for turning photos in Google Drive into `data/wardrobe.json` and
`assets/items/`. Written for a Claude Code session, because the classification
step needs something that can look at the photos.

Source folder: `clothes` — id `1k4wEOq6CNETGN9r8VekajKqla16sYokS`

## The one thing worth knowing

**No network policy change is needed, and the folder does not need to be
shared.** The route that works is the Drive connector, whose oversized results
the harness spills to a file instead of the conversation.

Two paths that look plausible and do not work:

- **Direct download** (`drive.usercontent.google.com`, `drive.google.com`) —
  blocked at CONNECT by the default network policy. A session copies that policy
  at startup, so changing it never helps the session you are in.
- **`read_file_content`** — rejects HEIC outright as an unsupported mime type.

## Steps

1. **List the folder** with `search_files`,
   `parentId = '1k4wEOq6CNETGN9r8VekajKqla16sYokS' and mimeType contains 'image/'`,
   paginating on `pageToken`. Note that pages can overlap — de-duplicate by id.
   Write id/title pairs to a scratch TSV; the listing is large and re-reading it
   from context is wasteful.

2. **Download in batches** with `download_file_content`. Each call returns an
   "exceeds maximum allowed tokens" error naming a file it saved the JSON to —
   that error *is* the success path. About 15 parallel calls per turn works well;
   each costs only the few hundred tokens of the error message.

3. **Decode and convert.** Each saved file is
   `{content, id, mimeType, title}` with `content` base64. Decode it, open with
   Pillow (`pip install pillow pillow-heif`; neither is preinstalled, and
   `pillow_heif.register_heif_opener()` is required for HEIC), downscale to
   ~460px, save as JPEG into `assets/items/<title>.jpg`.

   Delete each tool-result file as you go — the raw base64 is ~4 MB apiece and
   the session's disk allowance is finite.

4. **Sample the dominant colour** while the full-size image is open: median
   colour of the centre ~56% of the frame, discarding near-white pixels (the
   floor) and near-black ones (shadow). This becomes `hex`.

   The sampler runs dark on flat-lay photos because of shadow, so check the
   result against the image and override where it is clearly off — pale garments
   and anything photographed against a wooden floor are the usual offenders.

5. **Classify.** Look at every image and write one entry per garment. Build
   contact sheets (a grid of ~30 thumbnails with filenames) to see the whole
   wardrobe at once; it is far faster than opening 105 images individually, and
   makes categories and duplicates obvious.

6. **Write `data/wardrobe.json`.** Anything that isn't clothing, or that you
   can't identify confidently, goes in `skipped` with a reason — never guess.
   Record genuine absences in `gaps` and tell the user; "you own no swimwear" is
   the useful answer to "what do I wear swimming?".

## Entry format

```jsonc
{
  "id": "item-9032_2",
  "file": "IMG_9032_2.jpg",
  "image": "assets/items/IMG_9032_2.jpg",  // what the app renders
  "name": "baggy blue jeans",
  "category": "bottom",     // top | bottom | outerwear | shoes | swimwear | socks
  "subtype": "jeans",       // figure.js picks a silhouette from this
  "hex": "#243a5f",
  "pattern": "solid",       // solid | striped | checked | printed
  "warmth": 3,              // 1 hot-weather … 5 deep winter
  "formality": 2,           // 1 gym/lounge … 5 formal
  "style": "casual",        // sporty | casual | smart-casual | formal | outdoor
  "waterproof": false,      // outerwear and shoes only
  "openToe": false          // shoes only
}
```

`category` and `style` are the two fields that decide whether an outfit is
wearable, because both are hard filters — an item outside the occasion's style
families or formality band is never suggested. Get `style` wrong and a garment
either never appears or appears somewhere absurd.

`socks` is a real category that no occasion lists as a slot, so socks are
catalogued and browsable without ever being picked for an outfit.

## Adding clothes later

Re-run against the folder, skip any `file` already in `data/wardrobe.json`, and
append. Leave existing entries alone — including any the user corrected by hand.

## Verifying

```bash
node --test "test/*.test.js"
```

`test/wardrobe.test.js` runs against the real catalog: it checks every entry has
a valid hex, warmth and image, and that every occasion can be dressed from −5 °C
to 32 °C wet and dry. Then open the app, browse **My clothes**, and spot-check
entries against their photos — sampled colours and guessed warmth ratings are
the two things most worth a second look.
