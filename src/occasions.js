// Where you're going decides which slots must be filled and how formal the
// result should be. Warmth is not decided here — that comes from the weather.

export const OCCASIONS = {
  swimming: {
    label: 'Swimming',
    required: ['swimwear'],
    optional: ['top', 'bottom', 'shoes', 'accessory'],
    formality: { min: 1, max: 2 },
    styles: ['sporty', 'casual'],
    // Poolside: the weather outside shouldn't force a winter coat into the set.
    ignoreWeather: true,
    note: 'swim kit plus something to get there in',
  },
  sport: {
    label: 'Sport / gym',
    required: ['top', 'bottom', 'shoes'],
    optional: ['outerwear', 'accessory'],
    formality: { min: 1, max: 2 },
    styles: ['sporty'],
    note: 'built for moving, nothing restrictive',
  },
  university: {
    label: 'University',
    required: ['top', 'bottom', 'shoes'],
    optional: ['outerwear', 'accessory'],
    formality: { min: 2, max: 4 },
    styles: ['casual', 'smart-casual'],
    note: 'presentable but comfortable for a long day',
  },
  'casual-out': {
    label: 'Out and about',
    required: ['top', 'bottom', 'shoes'],
    optional: ['outerwear', 'accessory'],
    formality: { min: 2, max: 4 },
    styles: ['casual', 'smart-casual', 'outdoor'],
    note: 'everyday, unfussy',
  },
  dinner: {
    label: 'Dinner / date',
    required: ['top', 'bottom', 'shoes'],
    optional: ['outerwear', 'accessory'],
    formality: { min: 3, max: 5 },
    styles: ['smart-casual', 'formal'],
    note: 'a step up from everyday',
  },
  formal: {
    label: 'Formal',
    required: ['top', 'bottom', 'shoes'],
    optional: ['outerwear', 'accessory'],
    formality: { min: 4, max: 5 },
    styles: ['formal', 'smart-casual'],
    note: 'interview, ceremony, anything with a dress code',
  },
  outdoors: {
    label: 'Outdoors / walking',
    required: ['top', 'bottom', 'shoes'],
    optional: ['outerwear', 'accessory'],
    formality: { min: 1, max: 3 },
    styles: ['outdoor', 'casual', 'sporty'],
    note: 'weather-first, comfort over looks',
  },
  home: {
    label: 'Staying in',
    required: ['top', 'bottom'],
    optional: ['shoes', 'outerwear'],
    formality: { min: 1, max: 2 },
    styles: ['casual', 'sporty'],
    ignoreWeather: true,
    note: 'indoors, comfort only',
  },
};

// Free text maps onto an occasion by keyword. Deliberately generous: it is
// better to recognise "lecture" than to make the user learn our vocabulary.
const KEYWORDS = [
  [['swim', 'pool', 'beach', 'lake', 'sauna', 'bad ', 'baden'], 'swimming'],
  [['gym', 'sport', 'run', 'jog', 'train', 'workout', 'football', 'fitness', 'climb', 'tennis'], 'sport'],
  [['uni', 'university', 'lecture', 'class', 'campus', 'exam', 'study', 'library', 'jku', 'school', 'course'], 'university'],
  [['dinner', 'date', 'restaurant', 'drinks', 'bar', 'party', 'birthday', 'concert', 'theatre', 'cinema'], 'dinner'],
  [['interview', 'formal', 'wedding', 'ceremony', 'presentation', 'defence', 'defense', 'conference', 'meeting'], 'formal'],
  [['hike', 'walk', 'mountain', 'forest', 'park', 'outdoor', 'bike', 'cycling', 'donau', 'danube'], 'outdoors'],
  [['home', 'inside', 'indoors', 'nothing', 'relax', 'chill', 'couch'], 'home'],
  [['shop', 'city', 'town', 'coffee', 'cafe', 'friend', 'market', 'errand', 'groceries'], 'casual-out'],
];

/**
 * Resolve free text to an occasion.
 *
 * Returns `{ key, confident }`. When nothing matches we fall back to everyday
 * wear but flag it, so the app can ask rather than quietly guessing — a wrong
 * guess here sends every downstream choice off in the wrong direction.
 */
export function resolveOccasion(input) {
  const text = String(input ?? '').toLowerCase().trim();
  if (!text) return { key: 'casual-out', confident: false };
  if (OCCASIONS[text]) return { key: text, confident: true };

  for (const [words, key] of KEYWORDS) {
    if (words.some((w) => text.includes(w))) return { key, confident: true };
  }
  return { key: 'casual-out', confident: false };
}

export const QUICK_PICKS = [
  'University', 'Gym', 'Swimming', 'Dinner', 'A walk', 'Coffee with friends', 'Interview', 'Staying in',
];
