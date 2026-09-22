// Regression tests against the real catalog. These encode judgements that were
// wrong in earlier versions of the engine and produced plausible-looking but
// unwearable outfits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { requirementsFrom } from '../src/weather.js';
import { suggestOutfits } from '../src/outfits.js';
import { OCCASIONS } from '../src/occasions.js';
import { activeItems } from '../src/retired.js';

const data = JSON.parse(readFileSync(new URL('../data/wardrobe.json', import.meta.url)));
const W = data.items;

const weather = (feelsLike, wet = false) => requirementsFrom({
  feelsLike,
  precipitationProbability: wet ? 80 : 0,
  precipitation: wet ? 1 : 0,
  windSpeed: 5,
  code: wet ? 63 : 0,
});

test('catalog is internally consistent', () => {
  const ids = new Set();
  for (const item of W) {
    assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
    ids.add(item.id);
    assert.match(item.hex, /^#[0-9a-f]{6}$/i, `${item.id} has a bad hex`);
    assert.ok(item.warmth >= 1 && item.warmth <= 5, `${item.id} warmth out of range`);
    assert.ok(item.formality >= 1 && item.formality <= 5, `${item.id} formality out of range`);
    assert.ok(item.image?.startsWith('assets/items/'), `${item.id} has no image`);
  }
});

test('gym outfits contain only sportswear', () => {
  // Regression: "casual is one step from sporty" once put work dungarees and a
  // knit sweater in a gym outfit.
  for (const t of [0, 12, 26]) {
    const r = suggestOutfits(W, 'sport', weather(t));
    assert.equal(r.ok, true, `sport @${t}C: ${r.reason}`);
    for (const outfit of r.outfits) {
      for (const item of outfit.items) {
        assert.equal(item.style, 'sporty', `${item.name} is not sportswear (sport @${t}C)`);
      }
    }
  }
});

test('formal outfits never drop below the occasion formality', () => {
  // Regression: a one-point slack let a polo shirt into a job interview.
  for (const t of [0, 12, 26]) {
    const r = suggestOutfits(W, 'formal', weather(t));
    assert.equal(r.ok, true, `formal @${t}C: ${r.reason}`);
    for (const outfit of r.outfits) {
      for (const item of outfit.items) {
        assert.ok(item.formality >= OCCASIONS.formal.formality.min,
          `${item.name} (formality ${item.formality}) is too casual for a formal occasion`);
      }
    }
  }
});

test('a warm downpour still produces an outfit, with a warning', () => {
  // Regression: rain promoted outerwear to required, and since no raincoat is
  // light enough for 32C the whole request failed rather than warning.
  const r = suggestOutfits(W, 'university', weather(32, true));
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.outfits[0].warnings.some((w) => /waterproof/.test(w)),
    'expected a warning about the rain');
});

test('cold weather still reaches for a coat when one fits', () => {
  const r = suggestOutfits(W, 'casual-out', weather(-5));
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.outfits.every((o) => o.items.some((i) => i.category === 'outerwear')),
    'freezing weather should produce an outer layer');
});

test('shorts are not suggested below 12C', () => {
  for (const key of ['university', 'casual-out', 'outdoors']) {
    const r = suggestOutfits(W, key, weather(4));
    assert.equal(r.ok, true, `${key}: ${r.reason}`);
    for (const outfit of r.outfits) {
      assert.ok(!outfit.items.some((i) => i.subtype?.includes('short')),
        `${key} suggested shorts at 4C`);
    }
  }
});

test('socks are catalogued but never fill an outfit slot', () => {
  assert.ok(W.some((i) => i.category === 'socks'), 'expected socks in the catalog');
  for (const key of Object.keys(OCCASIONS)) {
    const r = suggestOutfits(W, key, weather(15));
    if (!r.ok) continue;
    for (const outfit of r.outfits) {
      assert.ok(!outfit.items.some((i) => i.category === 'socks'), `${key} put socks in a slot`);
    }
  }
});

test('every occasion can be dressed across the whole year', () => {
  for (const key of Object.keys(OCCASIONS)) {
    for (const t of [-5, 0, 8, 15, 22, 32]) {
      for (const wet of [false, true]) {
        const r = suggestOutfits(W, key, weather(t, wet));
        // Cycling is the one exception, and for a real reason: every cycling
        // bottom in the wardrobe is shorts, and shorts are refused below 12C.
        // Cold-weather cycling needs tights that aren't owned, so the engine
        // says what is missing instead of putting bib shorts on a freezing ride.
        if (key === 'cycling' && t < 12) {
          assert.equal(r.ok, false, `cycling @${t}C should report the gap`);
          assert.match(r.reason, /bottom/);
          continue;
        }
        assert.equal(r.ok, true, `${key} @${t}C wet=${wet}: ${r.reason}`);
      }
    }
  }
});

test('cycling uses the dedicated kit, not general sportswear', () => {
  // Allowing 'sporty' here let running shoes and joggers outscore the cleats
  // and bibs, which is not what anyone means by "I'm going cycling".
  const r = suggestOutfits(W, 'cycling', weather(18));
  assert.equal(r.ok, true, r.reason);
  for (const outfit of r.outfits) {
    for (const item of outfit.items) {
      assert.equal(item.style, 'cycling', `${item.name} is not cycling kit`);
    }
  }
});

test('Swimming is gone, since there is no swimwear to fill it', () => {
  assert.ok(!('swimming' in OCCASIONS));
  assert.ok(!W.some((i) => i.category === 'swimwear'));
});

test('retiring an item keeps it out of every suggestion', () => {
  // The toggle only matters if the engine actually stops picking the item, so
  // this checks the filtered wardrobe rather than the storage helper.
  const req = weather(15);
  const before = suggestOutfits(W, 'university', req);
  assert.equal(before.ok, true);

  const picked = before.outfits[0].items.find((i) => i.category === 'top');
  const remaining = W.filter((i) => i.id !== picked.id);
  const after = suggestOutfits(remaining, 'university', req);

  assert.equal(after.ok, true);
  for (const outfit of after.outfits) {
    assert.ok(!outfit.items.some((i) => i.id === picked.id),
      `${picked.name} was retired but still suggested`);
  }
});

test('duplicate photographs never reach a suggestion', () => {
  // 9110 is the same pair of boots as 9109, shot from another angle. Counting
  // it as a second garment would overstate the wardrobe.
  const dupes = W.filter((i) => i.duplicateOf);
  assert.ok(dupes.length > 0, 'expected at least one flagged duplicate');
  for (const d of dupes) {
    assert.ok(W.some((i) => i.id === d.duplicateOf), `${d.id} points at a missing original`);
  }

  const active = activeItems(W, new Set());
  for (const d of dupes) {
    assert.ok(!active.some((i) => i.id === d.id), `${d.id} is still selectable`);
  }
});

test('no two active garments share a name', () => {
  // Two identically labelled items in a result are indistinguishable to the
  // reader, whether or not they are the same garment.
  const names = activeItems(W, new Set()).map((i) => i.name);
  const dupes = names.filter((n, idx) => names.indexOf(n) !== idx);
  assert.deepEqual([...new Set(dupes)], [], 'duplicate names among active items');
});
