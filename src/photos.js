// Garment photos stay on the device.
//
// The catalog in the repo holds only classifications, keyed by the original
// filename (IMG_9032.HEIC). The photos themselves are picked from the device
// once and kept in IndexedDB, so nothing has to be uploaded, converted, or
// committed. Safari renders HEIC natively, which is why no conversion step is
// needed on an iPad.

const DB_NAME = 'wardrobe-photos';
const STORE = 'photos';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

/** Store one file under its own name. Later picks of the same name replace it. */
export async function putPhoto(name, blob) {
  const db = await openDb();
  return tx(db, 'readwrite', (s) => s.put(blob, name));
}

export async function allPhotoNames() {
  const db = await openDb();
  return tx(db, 'readonly', (s) => s.getAllKeys());
}

/**
 * Load every stored photo as an object URL, keyed by filename.
 *
 * Returns an empty map rather than throwing when storage is unavailable —
 * private browsing and blocked site data are normal, and the app has to stay
 * usable without photos (it falls back to colour swatches).
 */
export async function loadPhotoUrls() {
  const urls = new Map();
  try {
    const db = await openDb();
    const names = await tx(db, 'readonly', (s) => s.getAllKeys());
    for (const name of names) {
      const blob = await tx(db, 'readonly', (s) => s.get(name));
      if (blob) urls.set(name, URL.createObjectURL(blob));
    }
  } catch {
    return urls;
  }
  return urls;
}

export async function storePhotos(fileList) {
  const stored = [];
  for (const file of fileList) {
    try {
      await putPhoto(file.name, file);
      stored.push(file.name);
    } catch {
      // One unreadable file should not abort the rest of the batch.
    }
  }
  return stored;
}
