// The recommendation engine: pick complete outfits from the wardrobe that suit
// where you're going and what the weather is doing, then rank them on colour
// and style.
//
// Pure functions over plain data, no DOM, no network — so it can be tested
// under node and reasoned about on its own.

import { harmonyOf, contrastOf, isNeutral, hexToHsl } from './color.js';
import { OCCASIONS } from './occasions.js';
import { moodScore } from './moods.js';

const STYLE_DISTANCE = {
  formal: 4, 'smart-casual': 3, casual: 2, outdoor: 2, sporty: 1,
};

const WEIGHTS = {
  harmony: 0.24,
  contrast: 0.15,
  style: 0.2,
  proportion: 0.16,
  weather: 0.17,
  occasion: 0.08,
};

// Only applied when a mood board is active, on top of the rest: taste nudges
// the ranking, it never overrules weather or proportion.
const MOOD_WEIGHT = 0.18;

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

    // Athletes warm up by moving, so kit keeps its shorts down to a colder
    // threshold than everyday clothes do.
    const athletic = profile.styles.every((f) => f === 'sporty' || f === 'cycling');
    if ((athletic ? req.coldLegs : req.coverLegs) && item.category === 'bottom' && item.subtype?.includes('short')) return null;
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
  const upper = items.filter((i) => i.category === 'top' || i.category === 'outerwear');
  const effective = covering.length
    ? Math.max(...covering.map((i) => i.warmth))
      + (covering.filter((i) => i.warmth >= 3).length > 1 ? 0.5 : 0)
      + (upper.length >= 2 ? 0.5 : 0)
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

/**
 * What the occasion itself asks of the set, beyond formality.
 *
 * An interview wants clothes that disappear: plain fabric, quiet colour, a
 * collar or a fine knit, a shoe that could stand beside a suit.
 */
function occasionScore(items, profile, req) {
  const reasons = [];
  // Starts below the ceiling so the bonuses below can actually separate looks.
  let score = 0.75;
  const top = items.find((i) => i.category === 'top' && i.layer !== 'mid');
  const outer = items.find((i) => i.category === 'outerwear');
  const shoe = items.find((i) => i.category === 'shoes');

  if (profile.conservative) {
    for (const i of items) {
      if (i.pattern && i.pattern !== 'solid') score -= i.pattern === 'striped' ? 0.12 : 0.3;
      if (hexToHsl(i.hex).s > 0.45 && !isNeutral(i.hex)) score -= 0.15;
    }
    if (top && (top.collar || top.subtype === 'sweater')) reasons.push('collar or fine knit — reads prepared');
    else score -= 0.25;
    if (shoe?.dressy) reasons.push('shoes quiet enough to go unnoticed');
    if (outer?.subtype === 'blazer') { score += 0.15; reasons.push('the blazer does the talking'); }
  }

  if (profile.styleOuter && outer && ['blazer', 'coat'].includes(outer.subtype)
      && !profile.conservative) {
    score += 0.1;
    reasons.push(`${outer.name} lifts it a step`);
  }

  // Layering: a knit over a collar is a classic; over a sleeveless top it is
  // not a layer, it is a mistake.
  const mid = items.find((i) => i.layer === 'mid');
  if (mid && top) {
    if (top.collar) { score += 0.08; reasons.push(`collar showing over the ${mid.subtype}`); }
    if (req && req.warmth.max <= 1) score -= 0.4;
  }

  if (!profile.allowBold) {
    const loud = items.filter((i) => i.pattern === 'printed').length;
    if (loud) score -= 0.1 * loud;
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

function scoreOutfit(items, profile, req, mood) {
  const hexes = items.map((i) => i.hex).filter(Boolean);
  const harmony = harmonyOf(hexes);
  const contrast = contrastOf(hexes);
  const style = styleScore(items);
  const proportion = proportionScore(items);
  const weather = weatherScore(items, profile, req);
  const occasion = occasionScore(items, profile, req);
  const moodFit = mood ? moodScore(items, mood) : null;

  const base =
    harmony.score * WEIGHTS.harmony +
    contrast.score * WEIGHTS.contrast +
    style.score * WEIGHTS.style +
    proportion.score * WEIGHTS.proportion +
    weather.score * WEIGHTS.weather +
    occasion.score * WEIGHTS.occasion;
  const total = moodFit ? base * (1 - MOOD_WEIGHT) + moodFit.score * MOOD_WEIGHT : base;

  return {
    total,
    parts: { harmony, contrast, style, proportion, weather, occasion, mood: moodFit },
    warnings: weather.warnings,
    // The scheme name already says what harmony.reasons would repeat, so only
    // one of the two goes in.
    rationale: [
      harmony.scheme,
      ...contrast.reasons.slice(0, 1),
      ...style.reasons.slice(0, 1),
      ...proportion.reasons.slice(0, 1),
      ...occasion.reasons.slice(0, 1),
      ...(moodFit?.reasons ?? []).slice(0, 1),
      ...weather.reasons.slice(0, 1),
    ].filter(Boolean),
  };
}


/** Name a look from its strongest idea, so a list of thirty is scannable. */
function nameOutfit(items, parts) {
  const outer = items.find((i) => i.category === 'outerwear');
  const mid = items.find((i) => i.layer === 'mid');
  if (parts.contrast.tonal) return 'Tonal, one colour family';
  if (outer?.subtype === 'blazer') return 'Blazer, done simply';
  if (outer?.subtype === 'coat') return 'Long-coat city look';
  if (mid) return `Layered ${mid.subtype}`;
  if (parts.harmony.scheme === 'neutral-anchored') {
    const accent = items.find((i) => !isNeutral(i.hex));
    return accent ? `${accent.name[0].toUpperCase()}${accent.name.slice(1)} leads` : 'Neutral base';
  }
  if (parts.harmony.scheme === 'all neutrals') return 'Quiet neutrals';
  if (parts.harmony.scheme === 'analogous') return 'Neighbouring colours';
  return 'Easy combination';
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((combo) => list.map((item) => [...combo, item])), [[]]);
}

function pool(slot, wardrobe, profile, req, filter = () => true) {
  return candidatesFor(slot, wardrobe)
    .filter(filter)
    .map((item) => ({ item, fit: itemFit(item, profile, req) }))
    .filter((c) => c.fit !== null)
    .sort((a, b) => b.fit - a.fit)
    .map((c) => c.item);
}

const BEAM = { top: 10, bottom: 8, shoes: 7, mid: 4, outerwear: 4 };
const MAX_USES = 5;

/**
 * Suggest outfits.
 *
 * @param {object} opts
 * @param {number} opts.count  how many distinct looks to return
 * @param {object} [opts.mood] an active mood board (see moods.js)
 * @returns {{ok: true, outfits: Array}|{ok: false, reason: string, missing: string[]}}
 *   A failure names the empty slot rather than returning nothing, because
 *   "you own no swimwear" is the useful answer to "what do I wear swimming?".
 */
export function suggestOutfits(wardrobe, occasionKey, weatherRequirements, { count = 3, mood = null } = {}) {
  const profile = OCCASIONS[occasionKey];
  if (!profile) return { ok: false, reason: `unknown occasion "${occasionKey}"`, missing: [] };
  const req = profile.ignoreWeather ? null : weatherRequirements;

  const missing = [];
  const pools = [];
  for (const slot of profile.required) {
    // With layering on, the top slot holds the base; a knit or hoodie may still
    // be worn alone, so it stays in the pool too.
    const list = pool(slot, wardrobe, profile, req);
    if (!list.length) {
      const owned = candidatesFor(slot, wardrobe).length;
      missing.push(owned === 0 ? `no ${slot} in your wardrobe` : `no ${slot} suitable for ${profile.label.toLowerCase()} in this weather`);
      continue;
    }
    pools.push(list.slice(0, BEAM[slot] ?? 8));
  }
  if (missing.length) return { ok: false, reason: missing.join('; '), missing, occasion: profile };

  // Cold, wet or windy weather *wants* an outer layer; some occasions want one
  // as a styling choice. Wanted is never required: no suitable jacket means the
  // rest of the outfit plus a warning, not a refusal.
  const weatherWantsOuter = !!req && (req.warmth.min >= 4 || req.needsRainProtection || req.needsWindLayer);
  const hot = !!req && req.warmth.max <= 1;
  const outers = weatherWantsOuter || (profile.styleOuter && !hot)
    ? pool('outerwear', wardrobe, profile, req).slice(0, BEAM.outerwear) : [];
  const mids = profile.layering && !hot
    ? pool('top', wardrobe, profile, req, (i) => i.layer === 'mid').slice(0, BEAM.mid) : [];

  const outerOptions = weatherWantsOuter && outers.length ? outers : [null, ...outers];
  const midOptions = [null, ...mids];

  const scored = [];
  for (const core of cartesian(pools)) {
    const base = core.find((i) => i.category === 'top');
    for (const mid of midOptions) {
      if (mid && (!base || base.layer === 'mid' || base.subtype === 'tank top' || base.id === mid.id)) continue;
      for (const outer of outerOptions) {
        const items = [...(outer ? [outer] : []), ...(mid ? [mid] : []), ...core];
        scored.push({ items, ...scoreOutfit(items, profile, req, mood) });
      }
    }
  }
  scored.sort((a, b) => b.total - a.total);

  // A proportion clash is not a matter of degree. Scored as a penalty it still
  // surfaced — there are only so many shoes that suit a formal occasion — so
  // these are removed outright, unless removing them would leave nothing, in
  // which case a flawed outfit beats no answer at all.
  const clean = scored.filter((c) => !c.parts.proportion.clash);
  const combos = clean.length ? clean : scored;

  // Variety: the same top and bottom with different shoes is one idea, not
  // two, and no single garment should star in every suggestion.
  const chosen = [];
  const signatures = new Map();
  const uses = new Map();
  for (const combo of combos) {
    const core = combo.items.filter((i) => i.category === 'top' || i.category === 'bottom')
      .map((i) => i.id).sort().join('+');
    if ((signatures.get(core) ?? 0) >= 2) continue;
    if (combo.items.some((i) => (uses.get(i.id) ?? 0) >= MAX_USES)) continue;
    const tooSimilar = chosen.some((c) => {
      const shared = combo.items.filter((i) => c.items.some((x) => x.id === i.id)).length;
      return shared >= combo.items.length - 1 && combo.items.length === c.items.length;
    });
    if (tooSimilar) continue;
    signatures.set(core, (signatures.get(core) ?? 0) + 1);
    combo.items.forEach((i) => uses.set(i.id, (uses.get(i.id) ?? 0) + 1));
    chosen.push({ ...combo, name: nameOutfit(combo.items, combo.parts) });
    if (chosen.length >= count) break;
  }

  return { ok: true, outfits: chosen, occasion: profile, considered: combos.length };
}
