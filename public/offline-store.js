const CHANGE = "kioku-offline-change";
const SIGNOUT = "kioku-offline-signout";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withLibrary(mode, operation) {
  const request = indexedDB.open("kioku-offline", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("library");
  const db = await requestResult(request);
  try {
    const transaction = db.transaction("library", mode);
    const completion = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    const [result] = await Promise.all([operation(transaction.objectStore("library")), completion]);
    return result;
  } finally {
    db.close();
  }
}

function notifyChange() {
  try { localStorage.setItem(CHANGE, crypto.randomUUID()); } catch { /* Optional cross-tab notification. */ }
}

export function offlineRevision() {
  try { return localStorage.getItem(CHANGE); } catch { return null; }
}

export function offlineSignoutPending() {
  try { return localStorage.getItem(SIGNOUT) === "pending"; } catch { return false; }
}

export async function activateOfflineOwner(owner, revision = offlineRevision()) {
  if (!globalThis.indexedDB) return;
  const changed = await withLibrary("readwrite", async (store) => {
    const current = await requestResult(store.get("owner"));
    if (offlineRevision() !== revision || offlineSignoutPending()) return false;
    if ((current ?? null) === owner) return false;
    store.clear();
    if (owner) store.put(owner, "owner");
    return true;
  });
  if (changed) notifyChange();
}

export async function forgetOfflineOwner() {
  if (!globalThis.indexedDB) return;
  try { localStorage.setItem(SIGNOUT, "pending"); } catch { /* Storage can be disabled. */ }
  notifyChange();
  await withLibrary("readwrite", async (store) => { store.clear(); });
}

export function finishOfflineSignout() {
  try { localStorage.removeItem(SIGNOUT); } catch { /* Storage can be disabled. */ }
  notifyChange();
}

export async function readOffline() {
  if (!globalThis.indexedDB) return { owner: null, entries: [] };
  return withLibrary("readonly", async (store) => {
    const [owner, entries] = await Promise.all([
      requestResult(store.get("owner")), requestResult(store.getAll(IDBKeyRange.bound("trip:", "trip;"))),
    ]);
    return { owner, entries };
  });
}

export async function saveOffline(entry) {
  await withLibrary("readwrite", async (store) => {
    if (await requestResult(store.get("owner")) !== entry.owner || offlineSignoutPending()) throw new Error("Offline account changed");
    store.put(entry, "trip:" + entry.tripId);
  });
  notifyChange();
}

/**
 * @param {string} tripId
 * @param {string} owner
 * @param {string} [expectedSavedAt]
 */
export async function deleteOffline(tripId, owner, expectedSavedAt) {
  const changed = await withLibrary("readwrite", async (store) => {
    if (await requestResult(store.get("owner")) !== owner || offlineSignoutPending()) return false;
    const key = "trip:" + tripId;
    const entry = await requestResult(store.get(key));
    if (!entry || (expectedSavedAt !== undefined && entry.savedAt !== expectedSavedAt)) return false;
    store.delete(key);
    return true;
  });
  if (changed) notifyChange();
}

export async function checkOfflineTrip(entry, signal, availabilityOnly = false) {
  try {
    const response = await fetch("/api/offline/" + encodeURIComponent(entry.tripId) + (availabilityOnly ? "?status=1" : ""), {
      cache: "no-store", signal,
    });
    if (response.status === 401) return "unverified";
    if (!response.ok && response.status !== 404) return "unknown";
    const latest = await response.json();
    if (latest.owner !== entry.owner) return "unverified";
    if (latest.tripId !== entry.tripId) return "unknown";
    if (response.status === 404) return "missing";
    if (availabilityOnly) return "current";
    return JSON.stringify(latest.snapshot) === JSON.stringify(entry.snapshot) ? "current" : "stale";
  } catch {
    return "unknown";
  }
}

export { CHANGE };
