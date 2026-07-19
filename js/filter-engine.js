import { FILTER_LISTS, MEDIA_ALLOWLIST } from "./filter-lists.js";
import { AD_HOSTS as SEED_HOSTS, COSMETIC_SELECTORS as SEED_COSMETICS } from "./adblock-data.js";

const IDB_NAME = "shaib_filters";
const IDB_STORE = "cache";
const CACHE_KEY = "v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_HOSTS = 120_000;
const MAX_COSMETICS = 15_000;

const state = {
  ready: false,
  loading: false,
  loadPromise: null,
  hosts: new Set(SEED_HOSTS.map((h) => h.toLowerCase())),
  cosmetics: new Set(SEED_COSMETICS),
  exceptions: new Set(),
  progress: { done: 0, total: FILTER_LISTS.length, current: "" },
  listeners: new Set(),
};

function notify() {
  state.listeners.forEach((fn) => {
    try {
      fn({
        ...state.progress,
        ready: state.ready,
        hosts: state.hosts.size,
        cosmetics: state.cosmetics.size,
      });
    } catch (_) {}
  });
}

export function onFilterProgress(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function getFilterStats() {
  return {
    ready: state.ready,
    hosts: state.hosts.size,
    cosmetics: state.cosmetics.size,
    progress: { ...state.progress },
  };
}

export function isMediaAllowed(host) {
  if (!host) return true;
  const h = host.toLowerCase();
  return MEDIA_ALLOWLIST.some((p) => h === p || h.endsWith(`.${p}`) || h.includes(p));
}

export function engineIsAdHost(host) {
  if (!host || isMediaAllowed(host)) return false;
  let h = host.toLowerCase();
  if (state.exceptions.has(h)) return false;
  while (h) {
    if (state.hosts.has(h)) return true;
    if (state.exceptions.has(h)) return false;
    const i = h.indexOf(".");
    if (i === -1) break;
    h = h.slice(i + 1);
  }
  return /(^|\.)ads?\d*\.|doubleclick|adservice|adsystem|pagead|popads|propeller|exoclick|taboola|outbrain|criteo|prebid|adnxs|googlesyndication|popunder|clickunder|adserver|banner/.test(
    host.toLowerCase()
  );
}

export function engineIsAdUrl(url) {
  try {
    const u = new URL(url, location.href);
    if (engineIsAdHost(u.hostname)) return true;
    const s = u.href.toLowerCase();
    return /googlesyndication|doubleclick\.net|\/pagead\/|adsbygoogle|popunder|clickunder|\/ads\/|adserver/.test(
      s
    );
  } catch {
    return false;
  }
}

export function getHostList() {
  return [...state.hosts];
}

export function getCosmeticList() {
  return [...state.cosmetics];
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet() {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(CACHE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(data) {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(data, CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {}
}

async function fetchText(url) {
  const tries = [
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const u of tries) {
    try {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 18000) : null;
      const res = await fetch(u, {
        cache: "no-store",
        signal: ctrl?.signal,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 10) return text;
    } catch (_) {}
  }
  return null;
}

function validDomain(d) {
  if (!d || d.length < 3 || d.length > 180) return false;
  if (!d.includes(".")) return false;
  if (/[^a-z0-9.\-]/.test(d)) return false;
  if (d.startsWith(".") || d.endsWith(".") || d.includes("..")) return false;
  return true;
}

function addHost(raw) {
  let d = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/^\*\./, "")
    .replace(/^\./, "")
    .replace(/[^\w.\-]/g, "");
  if (!validDomain(d)) return;
  if (isMediaAllowed(d)) return;
  if (state.hosts.size >= MAX_HOSTS) return;
  state.hosts.add(d);
}

function addCosmetic(sel) {
  const s = String(sel || "").trim();
  if (!s || s.length < 2 || s.length > 220) return;
  if (state.cosmetics.size >= MAX_COSMETICS) return;
  state.cosmetics.add(s);
}

function addException(raw) {
  let d = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/^\*\./, "");
  if (validDomain(d)) state.exceptions.add(d);
}

function walkDomains(value) {
  if (!value) return;
  if (typeof value === "string") {
    if (value.includes(".")) addHost(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(walkDomains);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.includes(".")) addHost(k);
      if (k === "domains" || k === "hosts" || k === "block" || k === "blocklist") walkDomains(v);
      else if (typeof v === "string" && v.includes(".")) addHost(v);
      else if (Array.isArray(v) || (v && typeof v === "object")) walkDomains(v);
    }
  }
}

function parseAbp(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("!") || t.startsWith("[")) continue;

    if (t.startsWith("@@")) {
      const m = t.match(/^@@\|\|([a-z0-9.\-]+)\^/i);
      if (m) addException(m[1]);
      continue;
    }

    if (t.includes("#$#") || t.includes("#@#") || t.includes("+js(") || t.includes("##^")) continue;

    const cos = t.match(/^(?:([^#\s]+))?##(.+)$/);
    if (cos) {
      addCosmetic(cos[2]);
      continue;
    }

    const net = t.match(/^\|\|([a-z0-9.\-]+)\^/i);
    if (net) {
      addHost(net[1]);
      continue;
    }

    if (/^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(t) && !t.includes("/") && !t.includes("*")) {
      addHost(t);
    }
  }
}

function parseHosts(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 2) continue;
    if (parts[0] !== "0.0.0.0" && parts[0] !== "127.0.0.1") continue;
    const d = parts[1];
    if (d === "localhost" || d === "broadcasthost") continue;
    addHost(d);
  }
}

function parseJsonDomains(text) {
  try {
    walkDomains(JSON.parse(text));
  } catch (_) {}
}

function parseJsonElements(text) {
  try {
    const j = JSON.parse(text);
    (j.hideSelectors || []).forEach(addCosmetic);
    (j.removeSelectors || []).forEach(addCosmetic);
    (j.selectors || []).forEach(addCosmetic);
    if (Array.isArray(j)) j.forEach(addCosmetic);
  } catch (_) {}
}

function parseJsonWkRules(text) {
  try {
    const j = JSON.parse(text);
    const rules = j.rules || j;
    if (!Array.isArray(rules)) return;
    for (const r of rules) {
      const uf = r?.trigger?.["url-filter"] || r?.trigger?.urlFilter || "";
      if (!uf) continue;
      const cleaned = String(uf)
        .replace(/\\\./g, ".")
        .replace(/^\^https\?:\/\//, "")
        .replace(/\(\[\^\/\]\*\\\.\)\?/g, "")
        .replace(/\[\/?:?\].*$/, "")
        .replace(/[\\^$*+?[\](){}|]/g, "");
      const m = cleaned.match(/([a-z0-9.\-]+\.[a-z]{2,})/i);
      if (m) addHost(m[1]);
    }
  } catch (_) {}
}

async function loadCached() {
  const data = await idbGet();
  if (!data?.ts || Date.now() - data.ts > CACHE_TTL_MS) return false;
  if (Array.isArray(data.hosts) && data.hosts.length > 500) {
    data.hosts.forEach((h) => state.hosts.add(String(h).toLowerCase()));
  } else {
    return false;
  }
  if (Array.isArray(data.cosmetics)) data.cosmetics.forEach((c) => state.cosmetics.add(c));
  state.ready = true;
  notify();
  return true;
}

async function saveCache() {
  // Cap serialized size — huge host arrays freeze the main thread / blow IDB
  await idbSet({
    ts: Date.now(),
    hosts: getHostList().slice(0, 50_000),
    cosmetics: getCosmeticList().slice(0, 4_000),
  });
}

async function pushToServiceWorker() {
  // Cap payload so postMessage doesn't freeze the UI thread
  const hosts = getHostList().slice(0, 40_000);
  const payload = { type: "SHAIB_FILTER_UPDATE", hosts };

  const send = (sw) => {
    try {
      sw.postMessage(payload);
    } catch (_) {}
  };

  const flush = () => {
    if (navigator.serviceWorker?.controller) {
      send(navigator.serviceWorker.controller);
      return;
    }
    navigator.serviceWorker?.ready
      .then((reg) => {
        if (reg?.active) send(reg.active);
      })
      .catch(() => {});
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(flush, { timeout: 5000 });
  } else {
    setTimeout(flush, 0);
  }
}

async function loadOne(list) {
  state.progress.current = list.id;
  notify();
  let text = null;
  if (Array.isArray(list.urls)) {
    for (const u of list.urls) {
      text = await fetchText(u);
      if (text) break;
    }
  } else {
    text = await fetchText(list.url);
  }
  if (!text) return;
  switch (list.type) {
    case "abp":
      parseAbp(text);
      break;
    case "hosts":
      parseHosts(text);
      break;
    case "json-domains":
      parseJsonDomains(text);
      break;
    case "json-elements":
      parseJsonElements(text);
      break;
    case "json-wkrules":
      parseJsonWkRules(text);
      break;
    default:
      parseAbp(text);
  }
}

/**
 * Download + merge the PWA filter catalog. Safe to call multiple times.
 */
export async function prepareFilters({ force = false, onProgress } = {}) {
  if (onProgress) onFilterProgress(onProgress);
  if (state.loadPromise && !force) return state.loadPromise;

  state.loadPromise = (async () => {
    state.loading = true;

    if (!force) {
      const ok = await loadCached();
      if (ok) {
        await pushToServiceWorker();
        refreshInBackground();
        state.loading = false;
        return getFilterStats();
      }
    }

    state.progress.total = FILTER_LISTS.length;
    state.progress.done = 0;

    // Load EasyList / EasyPrivacy before the rest so tile shields get them ASAP
    const priority = FILTER_LISTS.filter((l) => l.priority);
    const rest = FILTER_LISTS.filter((l) => !l.priority);
    for (const list of priority) {
      await loadOne(list);
      state.progress.done += 1;
      notify();
    }
    await pushToServiceWorker();

    const batchSize = 3;
    for (let i = 0; i < rest.length; i += batchSize) {
      const batch = rest.slice(i, i + batchSize);
      await Promise.all(batch.map((list) => loadOne(list)));
      state.progress.done = Math.min(
        FILTER_LISTS.length,
        priority.length + i + batch.length
      );
      notify();
      await new Promise((r) => setTimeout(r, 0));
    }

    state.exceptions.forEach((d) => state.hosts.delete(d));

    state.ready = true;
    state.loading = false;
    await saveCache();
    await pushToServiceWorker();
    notify();
    return getFilterStats();
  })();

  try {
    return await state.loadPromise;
  } finally {
    // keep resolved promise so later callers get cached result instantly
  }
}

function refreshInBackground() {
  setTimeout(async () => {
    try {
      for (const list of FILTER_LISTS) {
        await loadOne(list);
        await new Promise((r) => setTimeout(r, 40));
      }
      state.exceptions.forEach((d) => state.hosts.delete(d));
      await saveCache();
      await pushToServiceWorker();
      notify();
    } catch (_) {}
  }, 2500);
}

export function buildShieldPayload() {
  return {
    hosts: getHostList(),
    cosmetics: getCosmeticList(),
    allow: MEDIA_ALLOWLIST,
  };
}
