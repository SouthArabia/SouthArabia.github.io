/* Shaib Sport PWA — standalone service worker (app shell + ad blocking) */
importScripts("./js/adblock-sw-hosts.js");
importScripts("./js/bot-guard.js");
importScripts("./js/player-proxy-sw.js");

const CACHE = "shaib-sport-pwa-v82";
const ASSETS = [
  "./",
  "./index.html",
  "./robots.txt",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/store.js",
  "./js/i18n.js",
  "./js/api.js",
  "./js/config.js",
  "./js/pwa-config.js",
  "./js/local-store.js",
  "./js/icons.js",
  "./js/auth.js",
  "./js/adblock-data.js",
  "./js/adblock.js",
  "./js/adblock-sw-hosts.js",
  "./js/filter-lists.js",
  "./js/filter-engine.js",
  "./js/global-adblock.js",
  "./js/bot-guard.js",
  "./js/player-proxy-sw.js",
  "./js/stream-detect.js",
  "./js/iptv.js",
  "./js/player.js",
  "./js/app.js",
  "./config/live_config.json",
  "./config/Knockout.json",
  "./filters/Adblocker.json",
  "./filters/elementBlock.json",
  "./filters/blocklist.json",
  "./filters/channel_blocklist.json",
  "./vendor/hls.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./assets/brand/mainicon.png",
  "./assets/brand/splash.png",
  "./assets/flags/south-yemen.svg",
];

function withNoIndex(response) {
  if (!response) return response;
  // Opaque cross-origin responses (e.g. <img> to espncdn) cannot be rebuilt —
  // wrapping them causes net::ERR_FAILED and blank crests/flags.
  if (response.type === "opaque" || response.type === "opaqueredirect" || response.status === 0) {
    return response;
  }
  try {
    const headers = new Headers(response.headers);
    headers.set(
      "X-Robots-Tag",
      "noindex, nofollow, noarchive, nosnippet, noimageindex, nocache"
    );
    headers.set("X-Content-Type-Options", "nosniff");
    // Must not be no-referrer — embedded players treat that as "إخفاء المصدر" and refuse to play
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (_) {
    return response;
  }
}

function botForbidden() {
  return new Response("Forbidden", {
    status: 403,
    statusText: "Forbidden",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Cache-Control": "no-store",
    },
  });
}

const ALLOW_PARTS = [
  "syria-player",
  "shootsync",
  "albaplayer",
  "beinmax",
  "kora-sami",
  "splplayer",
  "kore10",
  "worldchampion",
  "streamhostingcdn",
  "sportspass",
  "alarabiya",
  "aljazeera",
  "thehlive",
  "okcdn",
  "vkcdn",
  "userapi",
  "akamai",
  "cloudfront",
  "cloudflare",
  "jsdelivr",
  "clappr",
  "amazonaws",
  "amazonaws.com",
  "googleapis",
  "gstatic",
  "youtube",
  "ytimg",
  "jwplatform",
  "jwpcdn",
  "espn",
  "espncdn",
  "flagcdn",
  "flagsapi",
  "thesportsdb",
  "githubusercontent",
  "corsproxy",
  "cors.sh",
  "allorigins",
  "iptv-org",
  "github.io",
  "365scores",
  "easylist",
  "adtidy.org",
  "o0.pages.dev",
  "filters.adtidy",
  "oisd.nl",
  "yoyo.org",
  "ublockorigin.github.io",
  "hagezi",
  "1hosts",
  "badmojr",
  "jerryn70",
  "stevenblack",
  "m3u8",
];

let hostSet = new Set((self.AD_HOSTS || []).map((h) => String(h).toLowerCase()));

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowed(host) {
  return !host || ALLOW_PARTS.some((p) => host.includes(p));
}

function isAdHost(host) {
  if (!host || isAllowed(host)) return false;
  let h = host;
  while (h) {
    if (hostSet.has(h)) return true;
    const i = h.indexOf(".");
    if (i === -1) break;
    h = h.slice(i + 1);
  }
  return /(^|\.)ads?\d*\.|doubleclick|adservice|adsystem|pagead|popads|propeller|exoclick|taboola|outbrain|criteo|prebid|adnxs|googlesyndication|acscdn|baillieumbered|histats|statcounter|llvpn|guruvpnapp/.test(
    host
  );
}

function isAdRequest(url) {
  const host = hostnameOf(url);
  if (isAdHost(host)) return true;
  const u = String(url).toLowerCase();
  return (
    u.includes("googlesyndication") ||
    u.includes("doubleclick.net") ||
    u.includes("/pagead/") ||
    u.includes("adsbygoogle") ||
    u.includes("popunder") ||
    u.includes("acscdn.com") ||
    u.includes("aclib.js") ||
    u.includes("baillieumbered")
  );
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "SHAIB_FILTER_UPDATE") return;
  if (!Array.isArray(data.hosts)) return;
  hostSet = new Set(data.hosts.map((h) => String(h).toLowerCase()));
  // Expose for player-proxy EasyList stripping / inject
  self.SHAIB_HOST_SET = hostSet;
  self.SHAIB_IS_AD_REQUEST = isAdRequest;
  self.SHAIB_GET_AD_HOSTS = () => Array.from(hostSet);
});

// Defaults for player-proxy before first EasyList push
self.SHAIB_HOST_SET = hostSet;
self.SHAIB_IS_AD_REQUEST = isAdRequest;
self.SHAIB_GET_AD_HOSTS = () => Array.from(hostSet);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          ASSETS.map((url) =>
            cache.add(url).catch(() => {
              /* skip missing optional asset */
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const ua = request.headers.get("user-agent") || "";
  if (typeof self.SHAIB_IS_BOT === "function" && self.SHAIB_IS_BOT(ua)) {
    event.respondWith(botForbidden());
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Same-origin player proxy — fetch remote HTML, strip ads, keep real origin/referrer
  if (sameOrigin && typeof self.SHAIB_IS_PLAYER_PROXY === "function" && self.SHAIB_IS_PLAYER_PROXY(request.url)) {
    event.respondWith(self.SHAIB_HANDLE_PLAYER_PROXY(request));
    return;
  }

  // HLS/CDN from proxied players often require the upstream player Referer
  const host = url.hostname.toLowerCase();
  const isStreamHost =
    host.includes("amazonaws") ||
    host.includes("cloudfront") ||
    host.includes("streamhostingcdn") ||
    host.includes("776740.ir") ||
    host.includes("cdn.ir") ||
    /\.m3u8($|\?)/i.test(url.pathname + url.search) ||
    /\.ts($|\?)/i.test(url.pathname + url.search);
  if (!sameOrigin && isStreamHost) {
    event.respondWith(
      fetch(request.url, {
        method: request.method,
        headers: {
          Accept: request.headers.get("Accept") || "*/*",
          "User-Agent":
            request.headers.get("User-Agent") ||
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        },
        referrer: "https://m4.kora-sami.com/",
        referrerPolicy: "unsafe-url",
        mode: "cors",
        credentials: "omit",
        redirect: "follow",
      }).catch(() => fetch(request))
    );
    return;
  }

  // Hard-block known play-button popup hosts (iOS Safari new tabs / navigations)
  if (host.includes("guruvpnapp") || host.includes("llvpn") || /fifa-wc-2026/i.test(url.pathname)) {
    event.respondWith(
      new Response("", {
        status: 204,
        statusText: "Blocked popup",
        headers: { "X-Shaib-AdBlock": "1" },
      })
    );
    return;
  }

  if (isAdRequest(request.url)) {
    event.respondWith(
      new Response("", {
        status: 204,
        statusText: "Blocked by Shaib AdBlock",
        headers: { "X-Shaib-AdBlock": "1" },
      })
    );
    return;
  }

  // Bundled config / filters / vendor — cache first
  if (
    sameOrigin &&
    (url.pathname.includes("/config/") ||
      url.pathname.includes("/filters/") ||
      url.pathname.includes("/vendor/") ||
      url.pathname.endsWith(".json"))
  ) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }))
    );
    return;
  }

  const isApi =
    url.hostname.includes("espn.com") ||
    url.hostname.includes("espncdn.com") ||
    url.hostname.includes("thesportsdb.com") ||
    url.hostname.includes("openligadb.de") ||
    url.hostname.includes("githubusercontent.com") ||
    url.hostname.includes("corsproxy") ||
    url.hostname.includes("allorigins") ||
    url.hostname.includes("codetabs.com") ||
    url.hostname.includes("cors.sh") ||
    url.hostname.includes("jsdelivr.net") ||
    url.hostname.includes("flagcdn.com") ||
    url.hostname.includes("flagsapi.com") ||
    url.hostname.includes("easylist") ||
    url.hostname.includes("adtidy.org") ||
    url.hostname.includes("o0.pages.dev") ||
    url.hostname.includes("pages.dev") ||
    url.hostname.includes("oisd.nl") ||
    url.hostname.includes("yoyo.org") ||
    url.hostname.includes("ublockorigin.github.io") ||
    url.hostname.includes("hagezi") ||
    url.hostname.includes("iptv-org.github.io") ||
    url.hostname.includes("github.io") ||
    url.pathname.includes(".m3u8") ||
    url.pathname.endsWith(".m3u");

  if (isApi) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Cross-origin assets (images/fonts) — pass through; never wrap opaque responses
  if (!sameOrigin) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell (HTML documents + same-origin JS/CSS) — NETWORK FIRST so code
  // updates (e.g. new Live TV tiles) reach the user immediately instead of being
  // pinned to a stale cached shell. Falls back to cache only when offline.
  const isShell =
    request.mode === "navigate" ||
    request.destination === "document" ||
    request.destination === "script" ||
    request.destination === "style" ||
    /\.(?:html|js|css)(?:$|\?)/i.test(url.pathname + url.search);
  if (isShell) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return withNoIndex(res);
        })
        .catch(() => caches.match(request).then((cached) => (cached ? withNoIndex(cached) : caches.match("./index.html"))))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return withNoIndex(res);
        })
        .catch(() => (cached ? withNoIndex(cached) : cached));
      return cached ? withNoIndex(cached) : fetched;
    })
  );
});
