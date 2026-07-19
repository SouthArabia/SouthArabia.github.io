/** Persist last-good PWA data so reloads work without the network. */

const DB = "shaib_pwa_store";
const STORE = "kv";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(`shaib_kv_${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

export async function kvSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem(`shaib_kv_${key}`, JSON.stringify(value));
    } catch (_) {}
  }
}

export async function fetchLocalJSON(url) {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchRemoteJSON(url) {
  const tries = [
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const u of tries) {
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) continue;
      return await res.json();
    } catch (_) {}
  }
  return null;
}

/**
 * Local bundled → IDB cache → optional remote update.
 */
export async function loadJSONCascade({
  localUrl,
  remoteUrl,
  cacheKey,
  enableRemote = true,
}) {
  let data = await fetchLocalJSON(localUrl);
  if (!data) data = await kvGet(cacheKey);
  if (data) {
    if (enableRemote && remoteUrl) {
      fetchRemoteJSON(remoteUrl).then((fresh) => {
        if (fresh) kvSet(cacheKey, fresh);
      });
    }
    return data;
  }
  if (enableRemote && remoteUrl) {
    const fresh = await fetchRemoteJSON(remoteUrl);
    if (fresh) {
      await kvSet(cacheKey, fresh);
      return fresh;
    }
  }
  return null;
}
