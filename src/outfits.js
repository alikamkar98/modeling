// The recommendation engine: pick complete outfits from the wardrobe that suit
// where you're going and what the weather is doing, then rank them on colour
// and style.
//
// Pure functions over plain data, no DOM, no network — so it can be tested
// under node and reasoned about on its own.

import { harmonyOf, contrastOf, isNeutral, hexToHsl } from './color.js';
import { OCCASIONS } from './occasions.js';

const STYLE_DISTANCE = {
  formal: 4, 'smart-casual': 3, casual: 2, outdoor: 2, sporty: 1,
};

const WEIGHTS = {
  harmony: 0.26,
  contrast: 0.16,
  style: 0.22,
  proportion: 0.18,
  weather: 0.18,
};

/** Items that can fill a given slot. */
function candidatesFor(slot, wardrobe) {
  return wardrobe.filter((item) => item.category === slot);
}

/**
 * How well one garment suits the occasion and conditions, before we know what
 * it will be worn with. Returns null when the item is disqualified outright.
 */
function itemFit(item, profile, req) {
  // Formality is a hard boundary, not a preference. Slack here is what puts a
  // polo shirt in a job-interview outfit, so there is none: if the occasion
  // calls for 4-5, a 3 is simply the wrong garment.
  if (item.formality < profile.formality.min) return null;
  if (item.formality > profile.formality.max) return null;

  // Same for style family. Allowing "neighbouring" families sounds reasonable
  // and in practice puts work dungarees in a gym outfit, because casual sits
  // one step from sporty. An occasion lists the families that belong to it.
  if (profile.styles.length && item.style && !profile.styles.includes(item.style)) return null;

  let score = 1;

  if (!profile.ignoreWeather && req) {
    // Too warm for today disqualifies an item outright: a parka at 28 degrees
    // is not a matter of taste. Shoes are the exception — leather boots in
    // summer are merely warm, not absurd, and rejecting them outright leaves
    // a formal outfit with nothing on its feet.
    if (item.category !== 'shoes' && item.warmth > req.warmth.max + 1) return null;

    // Too *thin*, though, does not. Cold is answered by layering, so a cotton
    // shirt is perfectly valid at -2 once a coat goes over it. Only the
    // finished set has to clear the warmth bar; here we just prefer the
    // heavier option where one exists.
    const tooThin = Math.max(0, req.warmth.min - item.warmth);
    const tooWarm = Math.max(0, item.warmth - req.warmth.max);
    score -= tooWarm * 0.3 + tooThin * 0.08;

    if (req.coverLegs && item.category === 'bottom' && item.subtype?.includes('short')) return null;
    if (req.needsSnowFootwear && item.category === 'shoes' && item.openToe) return null;
  }

  const mid = (profile.formality.min + profile.formality.max) / 2;
  score -= Math.abs(item.formality - mid) * 0.06;

  return Math.max(0.05, score);
}

// A relaxed leg needs a shoe with some visual weight under it. Put a thin
// dress shoe below baggy jeans and the proportions collapse — the outfit reads
// as two people's clothes. This is the single most common way a set that
// scores well on colour still looks wrong.
const LOOSE_FITS = new Set(['baggy', 'wide', 'relaxed']);

function proportionScore(items) {
  const bottom = items.find((i) => i.category === 'bottom');
  const shoe = items.find((i) => i.category === 'shoes');
  if (!bottom || !shoe) return { score: 1, reasons: [] };

  if (LOOSE_FITS.has(bottom.fit) && shoe.dressy) {
    return {
      score: 0.15,
      clash: true,
      reasons: [`${shoe.name} is too dressy under a ${bottom.fit} leg`],
    };
  }
  // The mirror image: a dress shoe is what a tailored leg is cut for, so a
  // slim or wide tailored trouser with a chunky trainer is merely a miss, not
  // a clash.
  if (bottom.fit === 'slim' && shoe.dressy) {
    return { score: 1, reasons: ['tailored leg over a clean shoe'] };
  }
  return { score: 1, reasons: [] };
}

/** Style coherence across a finished set. */
function styleScore(items) {
  const formalities = items.map((i) => i.formality);
  const spread = Math.max(...formalities) - Math.min(...formalities);
  const reasons = [];

  // Two steps of formality inside one outfit is the point where it starts to
  // look like you got dressed in two different moods.
  let score = spread <= 1 ? 1 : spread === 2 ? 0.7 : 0.3;
  if (spread >= 3) reasons.push('formality is all over the place');
  else if (spread === 0) reasons.push('consistent register');

  const families = [...new Set(items.map((i) => i.style).filter(Boolean))];
  if (families.length > 1) {
    const distances = families.map((f) => STYLE_DISTANCE[f] ?? 2);
    const gap = Math.max(...distances) - Math.min(...distances);
    if (gap >= 3) {
      score -= 0.4;
      reasons.push(`${families.join(' + ')} don't belong together`);
    } else if (gap === 2) {
      score -= 0.15;
    }
  }

  const patterned = items.filter((i) => i.pattern && i.pattern !== 'solid');
  if (patterned.length > 1) {
    const subtle = patterned.filter((i) => isNeutral(i.hex)).length;
    if (patterned.length - subtle > 1) {
      score -= 0.35;
      reasons.push('competing patterns');
    } else {
      score -= 0.1;
    }
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/** How well the set handles today's conditions. */
function weatherScore(items, profile, req) {
  if (profile.ignoreWeather || !req) return { score: 1, reasons: [], warnings: [] };

  const reasons = [];
  const warnings = [];
  let score = 1;

  // Layers add up: two mid-weight pieces beat one in the cold.
  const covering = items.filter((i) => ['top', 'bottom', 'outerwear'].includes(i.category));
  const effective = covering.length
    ? Math.max(...covering.map((i) => i.warmth)) + (covering.filter((i) => i.warmth >= 3).length > 1 ? 0.5 : 0)
    : 0;

  if (effective < req.warmth.min) {
    score -= 0.5 * (req.warmth.min - effective);
    warnings.push(`might be cold for ${req.warmth.label} weather`);
  } else if (effective > req.warmth.max + 1) {
    score -= 0.3;
    warnings.push('likely too warm');
  } else {
    reasons.push(`right weight for ${req.warmth.label} weather`);
  }

  if (req.needsRainProtection) {
    const shielded = items.some((i) => i.waterproof);
    if (shielded) reasons.push('rain-ready');
    else { score -= 0.25; warnings.push('nothing waterproof — rain is likely'); }
  }

  if (req.needsWindLayer && !items.some((i) => i.category === 'outerwear')) {
    score -= 0.2;
    warnings.push('windy — an outer layer would help');
  }

  return { score: Math.max(0, Math.min(1, score)), reasons, warnings };
}

function scoreOutfit(items, profile, req) {
  const hexes = items.map((i) => i.hex).filter(Boolean);
  const harmony = harmonyOf(hexes);
  const contrast = contrastOf(hexes);
  const style = styleScore(items);
  const proportion = proportionScore(items);
  const weather = weatherScore(items, profile, req);

  const total =
    harmony.score * WEIGHTS.harmony +
    contrast.score * WEIGHTS.contrast +
    style.score * WEIGHTS.style +
    proportion.score * WEIGHTS.proportion +
    weather.score * WEIGHTS.weather;

  return {
    total,
    parts: { harmony, contrast, style, proportion, weather },
    warnings: weather.warnings,
    // The scheme name already says what harmony.reasons would repeat, so only
    // one of the two goes in.
    rationale: [
      harmony.scheme,
      ...contrast.reasons.slice(0, 1),
      ...style.reasons.slice(0, 1),
      ...proportion.reasons.slice(0, 1),
      ...weather.reasons.slice(0, 1),
    ].filter(Boolean),
  };
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((combo) => list.map((item) => [...combo, item])), [[]]);
}

/**
 * Suggest outfits.
 *
 * @returns {{ok: true, outfits: Array}|{ok: false, reason: string, missing: string[]}}
 *   A failure names the empty slot rather than returning nothing, because
 *   "you own no swimwear" is the useful answer to "what do I wear swimming?".
 */
export function suggestOutfits(wardrobe, occasionKey, weatherRequirements, { count = 3, beam = 8 } = {}) {
  const profile = OCCASIONS[occasionKey];
  if (!profile) return { ok: false, reason: `unknown occasion "${occasionKey}"`, missing: [] };

  const slots = [...profile.required];
  const req = weatherRequirements;

  // Cold or wet weather calls for an outer layer. It is *wanted*, not
  // required: if nothing suitable exists — no raincoat light enough for a warm
  // downpour — the right answer is the rest of the outfit plus a warning, not
  // a refusal to dress the user at all.
  const wanted = new Set();
  if (!profile.ignoreWeather && req && (req.warmth.min >= 4 || req.needsRainProtection || req.needsWindLayer)
      && profile.optional.includes('outerwear')) {
    slots.push('outerwear');
    wanted.add('outerwear');
  }

  const missing = [];
  const pools = [];
  for (const slot of slots) {
    const scored = candidatesFor(slot, wardrobe)
      .map((item) => ({ item, fit: itemFit(item, profile, req) }))
      .filter((c) => c.fit !== null)
      .sort((a, b) => b.fit - a.fit);

    if (!scored.length) {
      if (wanted.has(slot)) continue;   // nice to have, not a blocker
      const owned = candidatesFor(slot, wardrobe).length;
      missing.push(owned === 0 ? `no ${slot} in your wardrobe` : `no ${slot} suitable for ${profile.label.toLowerCase()} in this weather`);
      continue;
    }
    // Keep the field narrow: every slot multiplies the search, and the weakest
    // candidates never win anyway.
    pools.push(scored.slice(0, beam).map((c) => c.item));
  }

  if (missing.length) {
    return { ok: false, reason: missing.join('; '), missing, occasion: profile };
  }

  const scored = cartesian(pools)
    .map((items) => ({ items, ...scoreOutfit(items, profile, req) }))
    .sort((a, b) => b.total - a.total);

  // A proportion clash is not a matter of degree. Scored as a penalty it still
  // surfaced — there are only so many shoes that suit a formal occasion — so
  // these are removed outright, unless removing them would leave nothing, in
  // which case a flawed outfit beats no answer at all.
  const clean = scored.filter((c) => !c.parts.proportion.clash);
  const combos = clean.length ? clean : scored;

  // Variety matters more than squeezing out the last points: three outfits
  // that differ only in socks is not three suggestions.
  const chosen = [];
  for (const combo of combos) {
    const tooSimilar = chosen.some((c) => {
      const shared = combo.items.filter((i) => c.items.some((x) => x.id === i.id)).length;
      return shared >= combo.items.length - 1;
    });
    if (!tooSimilar) chosen.push(combo);
    if (chosen.length >= count) break;
  }

  return { ok: true, outfits: chosen, occasion: profile, considered: combos.length };
}
