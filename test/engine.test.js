// Run with: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contrastRatio, luminance, isNeutral, harmonyOf, contrastOf, hueDistance, hexToHsl } from '../src/color.js';
import { requirementsFrom, manualWeather, describeCode, buildUrl } from '../src/weather.js';
import { resolveOccasion, OCCASIONS } from '../src/occasions.js';
import { suggestOutfits } from '../src/outfits.js';

const demo = JSON.parse(readFileSync(new URL('../data/demo-wardrobe.json', import.meta.url)));
const WARDROBE = demo.items;

test('luminance and contrast match known values', () => {
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9);
  assert.ok(Math.abs(luminance('#000000')) < 1e-9);
  // Black on white is the maximum WCAG ratio.
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  assert.equal(Math.round(contrastRatio('#777777', '#777777')), 1);
});

test('hue distance wraps around the wheel', () => {
  assert.equal(hueDistance(10, 350), 20);
  assert.equal(hueDistance(0, 180), 180);
  assert.equal(hueDistance(200, 200), 0);
});

test('neutrals are recognised, real colours are not', () => {
  for (const hex of ['#000000', '#ffffff', '#8a8d91', '#26354f', '#c8b393', '#1c1c1e']) {
    assert.ok(isNeutral(hex), `${hex} should count as neutral`);
  }
  for (const hex of ['#d81b1b', '#1bd83a', '#a4552c', '#7a1fd8']) {
    assert.ok(!isNeutral(hex), `${hex} should not count as neutral`);
  }
});

test('harmony: one colour against neutrals scores best', () => {
  const anchored = harmonyOf(['#a4552c', '#c8b393', '#ececea']);
  assert.equal(anchored.scheme, 'neutral-anchored');
  assert.ok(anchored.score > 0.9);
});

test('harmony: red with green is penalised as clashing or complementary-loud', () => {
  const clash = harmonyOf(['#d81b1b', '#1bd83a']);
  const anchored = harmonyOf(['#a4552c', '#c8b393', '#ececea']);
  assert.ok(clash.score < anchored.score, 'red+green must score below a neutral-anchored set');
  assert.ok(clash.score <= 0.6, `red+green scored ${clash.score}`);
});

test('harmony: neighbouring hues beat distant ones', () => {
  const analogous = harmonyOf(['#d84a1b', '#d8951b']);   // orange + amber
  const awkward = harmonyOf(['#d81b1b', '#1b9ad8']);     // red + cyan-blue, in the awkward band
  assert.ok(analogous.score > awkward.score);
});

test('contrast: different colours at one depth read muddy', () => {
  // Navy beside near-black at the same lightness is the classic failed match.
  const muddy = contrastOf(['#1f2a44', '#1c1c1e']);
  const structured = contrastOf(['#1c1c1e', '#ececea', '#5b3a24']);
  assert.ok(muddy.score < structured.score, 'muddy middle must lose to clear structure');
  assert.ok(muddy.score < 0.7);
});

test('contrast: a tonal set in one colour family is a deliberate look', () => {
  assert.ok(contrastOf(['#7a7a7a', '#7d7d7d', '#787878']).tonal);
  assert.ok(contrastOf(['#c8b393', '#bfae91']).score >= 0.85);
});

test('weather requirements scale with feels-like temperature', () => {
  assert.equal(requirementsFrom({ feelsLike: 30, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 }).warmth.label, 'hot');
  assert.equal(requirementsFrom({ feelsLike: -3, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 }).warmth.label, 'freezing');
  const cool = requirementsFrom({ feelsLike: 8, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 });
  assert.equal(cool.warmth.label, 'cool');
  assert.equal(cool.coverLegs, true);
});

test('rain is detected from probability, amount, or weather code', () => {
  const base = { feelsLike: 15, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 };
  assert.equal(requirementsFrom(base).needsRainProtection, false);
  assert.equal(requirementsFrom({ ...base, precipitationProbability: 70 }).needsRainProtection, true);
  assert.equal(requirementsFrom({ ...base, code: 63 }).needsRainProtection, true);
  assert.equal(requirementsFrom({ ...base, precipitation: 0.4 }).needsRainProtection, true);
});

test('weather URL targets Linz and asks for feels-like', () => {
  const url = buildUrl();
  assert.match(url, /latitude=48\.3069/);
  assert.match(url, /longitude=14\.2858/);
  assert.match(url, /apparent_temperature/);
  assert.equal(describeCode(63), 'rain');
});

test('destinations map to occasions, unknown text is flagged', () => {
  assert.equal(resolveOccasion('university').key, 'university');
  assert.equal(resolveOccasion('going to the JKU library').key, 'university');
  assert.equal(resolveOccasion('gym').key, 'gym');
  assert.equal(resolveOccasion('job interview').key, 'interview');

  const vague = resolveOccasion('somewhere entirely unspecified');
  assert.equal(vague.confident, false, 'unrecognised text must not be passed off as a confident match');
});

// The core guarantee: every returned outfit is wearable and real.
test('every occasion returns valid, complete, non-repeating outfits across the weather range', () => {
  const ids = new Set(WARDROBE.map((i) => i.id));

  for (const key of Object.keys(OCCASIONS)) {
    for (const feelsLike of [-5, 0, 8, 15, 22, 32]) {
      for (const wet of [false, true]) {
        const req = requirementsFrom({
          feelsLike,
          precipitationProbability: wet ? 80 : 0,
          precipitation: wet ? 1 : 0,
          windSpeed: 5,
          code: wet ? 63 : 0,
        });
        const result = suggestOutfits(WARDROBE, key, req);
        const label = `${key} @ ${feelsLike}C wet=${wet}`;

        if (!result.ok) {
          // A refusal must explain itself rather than return an empty list.
          assert.ok(result.reason && result.reason.length > 0, `${label}: refusal without a reason`);
          continue;
        }

        assert.ok(result.outfits.length > 0, `${label}: ok but no outfits`);
        for (const outfit of result.outfits) {
          const seen = new Set();
          for (const item of outfit.items) {
            assert.ok(ids.has(item.id), `${label}: invented item ${item.id}`);
            assert.ok(!seen.has(item.id), `${label}: item ${item.id} used twice in one outfit`);
            seen.add(item.id);
          }
          for (const slot of OCCASIONS[key].required) {
            assert.ok(outfit.items.some((i) => i.category === slot), `${label}: missing required ${slot}`);
          }
          assert.ok(outfit.total > 0 && outfit.total <= 1, `${label}: score out of range (${outfit.total})`);
        }
      }
    }
  }
});

test('an unfillable request names what is missing instead of failing silently', () => {
  const noShoes = WARDROBE.filter((i) => i.category !== 'shoes');
  const req = requirementsFrom({ feelsLike: 15, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 });
  const result = suggestOutfits(noShoes, 'university', req);
  assert.equal(result.ok, false);
  assert.match(result.reason, /shoes/);
});

test('unknown occasion is rejected cleanly', () => {
  const result = suggestOutfits(WARDROBE, 'moon-landing', null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unknown occasion/);
});

test('cold weather pulls in an outer layer', () => {
  const req = requirementsFrom({ feelsLike: -2, precipitationProbability: 0, precipitation: 0, windSpeed: 5, code: 0 });
  const result = suggestOutfits(WARDROBE, 'coffee', req);
  assert.equal(result.ok, true);
  assert.ok(result.outfits.every((o) => o.items.some((i) => i.category === 'outerwear')),
    'freezing weather must require outerwear');
});

test('hot weather keeps the winter coat out', () => {
  const req = requirementsFrom({ feelsLike: 30, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 });
  const result = suggestOutfits(WARDROBE, 'coffee', req);
  assert.equal(result.ok, true);
  const warmthUsed = result.outfits.flatMap((o) => o.items).map((i) => i.warmth);
  assert.ok(Math.max(...warmthUsed) <= 3, 'nothing heavy should survive 30 degrees');
});

test('formal occasions do not return gym clothes', () => {
  const req = requirementsFrom({ feelsLike: 16, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 });
  const result = suggestOutfits(WARDROBE, 'interview', req);
  assert.equal(result.ok, true);
  for (const outfit of result.outfits) {
    assert.ok(!outfit.items.some((i) => i.style === 'sporty'), 'sporty items must not reach a formal outfit');
  }
});

test('results are deterministic', () => {
  const req = requirementsFrom({ feelsLike: 15, precipitationProbability: 0, precipitation: 0, windSpeed: 2, code: 0 });
  const a = suggestOutfits(WARDROBE, 'university', req);
  const b = suggestOutfits(WARDROBE, 'university', req);
  assert.deepEqual(a.outfits.map((o) => o.items.map((i) => i.id)), b.outfits.map((o) => o.items.map((i) => i.id)));
});

test('manual fallback is marked as manual', () => {
  const w = manualWeather('cold');
  assert.equal(w.source, 'manual');
  assert.match(w.description, /by hand/);
});


test('Vienna trip without network falls back to climate or a checked day', async () => {
  const { climateWeather, VIENNA } = await import('../src/weather.js');
  const checked = climateWeather(VIENNA, '2026-09-23');
  assert.equal(checked.source, 'checked');
  assert.equal(checked.place, 'Vienna');
  const jan = climateWeather(VIENNA, '2027-01-15');
  assert.equal(jan.source, 'climate');
  assert.equal(requirementsFrom(jan).warmth.label, 'cold');
});

test('mood palette is pulled from pixels', async () => {
  const { extractPalette } = await import('../src/moods.js');
  const data = new Uint8ClampedArray(4 * 400);
  for (let i = 0; i < 400; i++) data.set(i < 300 ? [120, 80, 50, 255] : [240, 235, 225, 255], i * 4);
  const pal = extractPalette(data, 2);
  assert.equal(pal.length, 2);
  assert.equal(pal[0], '#785032');
});
