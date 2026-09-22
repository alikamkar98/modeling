# Ingesting the wardrobe

This is the runbook for turning the photos in Google Drive into
`data/wardrobe.json`. It is written for a Claude Code session, because the
classification step needs someone (or something) that can actually look at the
photos.

## Prerequisites

Both of these must be true, or the session cannot read the photos at all.

1. **Network policy allows Google Drive.** In the cloud environment settings
   (the cloud icon above the message box at claude.ai/code), set
   **Network access** to **Custom**, tick *"Also include default list of common
   package managers"*, and allow:

   ```
   drive.google.com
   drive.usercontent.google.com
   *.googleusercontent.com
   www.googleapis.com
   api.open-meteo.com
   ```

   A session copies the environment config at startup, so this only affects
   sessions started *after* the change.

2. **The `clothes` folder is link-shareable.** Share → General access →
   *Anyone with the link* (Viewer). Session credentials don't carry over to a
   plain download, so a private file returns a Google login page rather than an
   image. Set it back to private afterwards.

Folder: `clothes` — id `1k4wEOq6CNETGN9r8VekajKqla16sYokS`

## Steps

1. **List the folder.** Use the Drive connector with
   `parentId = '1k4wEOq6CNETGN9r8VekajKqla16sYokS'`, paginating on
   `pageToken` until it stops returning files. Keep `title` and `id` for each.

   Do *not* pull file bytes through the connector — it returns base64 inline,
   and a 2.7 MB HEIC becomes roughly 900k tokens. That is what the network
   policy above is for.

2. **Download and downscale.** Fetch each file to the scratchpad:

   ```
   https://drive.usercontent.google.com/download?id=<FILE_ID>&export=download
   ```

   Then convert to a small JPEG or PNG for viewing (`pillow` plus `pillow-heif`
   for HEIC; neither is preinstalled). ~600px on the long edge is plenty to
   classify from and keeps the vision pass cheap.

3. **Sample the dominant colour.** For each photo take the median colour of the
   centre region, excluding near-white pixels so the background doesn't win.
   This becomes `hex`. The engine needs a real colour value — the *name* of a
   colour can't tell you whether two navies contrast or merely fail to match.

4. **Classify.** Look at each image and write one entry per garment. Check the
   sampled `hex` against what you see and correct it if the sample caught a
   shadow or a label.

5. **Write `data/wardrobe.json`.** Photos that aren't clothing, or that you
   can't identify confidently, go in `skipped` with a reason — never guess.
   Report the skipped list to the user rather than quietly dropping them.

## Entry format

```jsonc
{
  "id": "item-007",
  "file": "IMG_9032.HEIC",   // original filename — how the app finds the photo
  "name": "navy oxford shirt",
  "category": "top",          // top | bottom | outerwear | shoes | swimwear | accessory
  "subtype": "oxford shirt",  // figure.js picks a silhouette from this
  "hex": "#26354f",
  "pattern": "solid",         // solid | striped | checked | printed
  "warmth": 2,                // 1 hot-weather … 5 deep winter
  "formality": 4,             // 1 gym/lounge … 5 formal
  "style": "smart-casual",    // sporty | casual | smart-casual | formal | outdoor
  "waterproof": false,        // outerwear only
  "openToe": false,           // shoes only
  "notes": "cotton, slim fit"
}
```

`file` matters: the app never stores photos itself. It matches the filename
against photos the user picked from their own device, held in IndexedDB. Get
the filename wrong and the item falls back to a plain colour swatch.

## Adding clothes later

Re-run against the folder, skip any `file` already present in
`data/wardrobe.json`, and append. Existing entries — including any the user
corrected by hand — are left alone.

## Verifying

```bash
node --test "test/*.test.js"
```

The suite runs against `data/demo-wardrobe.json`. To check the real catalog,
point the fixture at `data/wardrobe.json` and confirm every occasion still
returns complete outfits across the temperature sweep. Then open the app and
compare a sample of entries in **My clothes** against their photos — sampled
colours and guessed warmth ratings are the two things most worth spot-checking.
