// Regression tests against the real catalog. These encode judgements that were
// wrong in earlier versions of the engine and produced plausible-looking but
// unwearable outfits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { requirementsFrom } from '../src/weather.js';
import { suggestOutfits } from '../src/outfits.js';
import { OCCASIONS } from '../src/occasions.js';

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

test('every occasion except swimming can be dressed across the whole year', () => {
  // Swimming is the one real gap: there is no swimwear among the 105 photos,
  // and the engine says so rather than improvising.
  for (const key of Object.keys(OCCASIONS)) {
    for (const t of [-5, 0, 8, 15, 22, 32]) {
      for (const wet of [false, true]) {
        const r = suggestOutfits(W, key, weather(t, wet));
        if (key === 'swimming') {
          assert.equal(r.ok, false);
          assert.match(r.reason, /swimwear/);
          continue;
        }
        assert.equal(r.ok, true, `${key} @${t}C wet=${wet}: ${r.reason}`);
      }
    }
  }
});
