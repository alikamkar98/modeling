// Clothes you own but don't want suggested.
//
// Kept per device in localStorage rather than in the catalog: this is a
// preference the wearer changes on a whim, not a fact about the garment, and it
// should never be lost or overwritten by a re-ingest of the photos.

const KEY = 'wardrobe:retired';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    // Private windows and blocked site data both land here. The app has to
    // work without persistence, so an empty set is the right answer.
    return new Set();
  }
}

function write(set) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Nothing to do — the toggle still works for this session.
  }
}

export function retiredIds() {
  return read();
}

export function isRetired(id) {
  return read().has(id);
}

/** Toggle one item. Returns true if it is now retired. */
export function toggleRetired(id) {
  const set = read();
  const nowRetired = !set.has(id);
  if (nowRetired) set.add(id); else set.delete(id);
  write(set);
  return nowRetired;
}

/** The wardrobe the engine should actually pick from. */
export function activeItems(items, retired = read()) {
  return items.filter((i) => !retired.has(i.id));
}
