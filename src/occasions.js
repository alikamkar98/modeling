// Where you're going decides which slots must be filled, how formal the result
// has to be, and which garment families belong. Warmth is not decided here —
// that comes from the weather.
//
// `styleOuter`: a jacket or blazer is part of the look here, not only a weather
// layer — a blazer at dinner is a choice, not a coat.
// `layering`: a knit over a shirt is welcome when it isn't hot.

export const OCCASIONS = {
  university: {
    label: 'University',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 2, max: 4 },
    styles: ['casual', 'smart-casual'],
    layering: true,
    note: 'a long day, seen by people',
  },
  work: {
    label: 'Work',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 3, max: 5 },
    styles: ['smart-casual', 'formal'],
    styleOuter: true,
    layering: true,
    note: 'put together without trying too hard',
  },
  interview: {
    label: 'Interview',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 4, max: 5 },
    styles: ['formal', 'smart-casual'],
    styleOuter: true,
    layering: true,
    // The clothes should disappear so the person doesn't: plain fabrics, quiet
    // colours, a collar, shoes that could stand next to a suit.
    conservative: true,
    note: 'clothes that disappear, so you don’t',
  },
  dinner: {
    label: 'Dinner',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 3, max: 5 },
    styles: ['smart-casual', 'formal', 'casual'],
    styleOuter: true,
    layering: true,
    note: 'a step up from everyday',
  },
  date: {
    label: 'Date',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 3, max: 4 },
    styles: ['smart-casual', 'casual'],
    styleOuter: true,
    layering: true,
    note: 'considered, not costumed',
  },
  party: {
    label: 'Party',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 2, max: 4 },
    styles: ['casual', 'smart-casual'],
    styleOuter: true,
    allowBold: true,
    note: 'loud is allowed here',
  },
  coffee: {
    label: 'Coffee',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 2, max: 4 },
    styles: ['casual', 'smart-casual', 'outdoor'],
    layering: true,
    note: 'easy, unfussy',
  },
  walking: {
    label: 'Walking',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 1, max: 3 },
    styles: ['outdoor', 'casual', 'sporty'],
    layering: true,
    note: 'weather first, comfort over looks',
  },
  gym: {
    label: 'Gym',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 1, max: 2 },
    styles: ['sporty'],
    note: 'built for moving',
  },
  cycling: {
    label: 'Cycling',
    required: ['top', 'bottom', 'shoes'],
    formality: { min: 1, max: 2 },
    // Only the dedicated kit: allowing general sportswear here let running
    // shoes outscore the cleats, which is not what "cycling" means.
    styles: ['cycling'],
    note: 'on the bike — jersey, bibs, cleats',
  },
  home: {
    label: 'Home',
    required: ['top', 'bottom'],
    formality: { min: 1, max: 2 },
    styles: ['casual', 'sporty'],
    ignoreWeather: true,
    note: 'indoors, comfort only',
  },
};

export const OCCASION_ORDER = [
  'university', 'work', 'interview', 'dinner', 'date', 'party',
  'coffee', 'walking', 'gym', 'cycling', 'home',
];

// Free text maps onto an occasion by keyword. Deliberately generous: better to
// recognise "lecture" than to make the user learn this vocabulary. Order
// matters — "job interview" must hit interview before "job" hits work.
const KEYWORDS = [
  [['interview', 'job talk', 'assessment', 'defence', 'defense', 'viva'], 'interview'],
  [['gym', 'sport', 'run', 'jog', 'train', 'workout', 'football', 'fitness', 'climb', 'tennis'], 'gym'],
  [['bike', 'biking', 'cycl', 'ride', 'rennrad', 'mtb', 'gravel'], 'cycling'],
  [['uni', 'lecture', 'class', 'campus', 'exam', 'study', 'library', 'jku', 'school', 'course'], 'university'],
  [['work', 'office', 'job', 'meeting', 'conference', 'presentation', 'client'], 'work'],
  [['date', 'romantic'], 'date'],
  [['dinner', 'restaurant', 'theatre', 'theater', 'opera', 'wedding', 'ceremony'], 'dinner'],
  [['party', 'club', 'bar', 'drinks', 'birthday', 'concert', 'festival'], 'party'],
  [['hike', 'walk', 'mountain', 'forest', 'park', 'outdoor', 'donau', 'danube'], 'walking'],
  [['home', 'inside', 'indoors', 'relax', 'chill', 'couch'], 'home'],
  [['coffee', 'cafe', 'café', 'friend', 'shop', 'city', 'town', 'market', 'errand', 'brunch'], 'coffee'],
];

/**
 * Resolve free text to an occasion.
 *
 * Returns `{ key, confident }`. When nothing matches we fall back to everyday
 * wear but flag it, so the app can ask rather than quietly guessing.
 */
export function resolveOccasion(input) {
  const text = String(input ?? '').toLowerCase().trim();
  if (!text) return { key: 'coffee', confident: false };
  if (OCCASIONS[text]) return { key: text, confident: true };
  for (const [words, key] of KEYWORDS) {
    if (words.some((w) => text.includes(w))) return { key, confident: true };
  }
  return { key: 'coffee', confident: false };
}
