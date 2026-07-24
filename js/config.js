import { LOCAL, REMOTE_UPDATE, PWA } from "./pwa-config.js";
import { loadJSONCascade, kvSet } from "./local-store.js";

function enabled(item) {
  return item && item.enabled !== false && item.url;
}

function isChannel6(item) {
  return (
    String(item?.id || "") === "browser-6" ||
    /قناة\s*6/.test(String(item?.title || ""))
  );
}

function isChannel1(item) {
  return (
    String(item?.id || "") === "browser-1" ||
    /قناة\s*1\b/.test(String(item?.title || "")) ||
    String(item?.id || "") === "ch1"
  );
}

function isChannel2(item) {
  return (
    String(item?.id || "") === "browser-2" ||
    /قناة\s*2\b/.test(String(item?.title || "")) ||
    String(item?.id || "") === "ch2"
  );
}

function isChannel3(item) {
  return (
    String(item?.id || "") === "browser-3" ||
    /قناة\s*3\b/.test(String(item?.title || "")) ||
    String(item?.id || "") === "ch3"
  );
}

const CHANNEL1_URL = "https://m4.kora-sami.com/splplayer/bmax1/";
const CHANNEL2_URL = "https://k2.kore10.blog/albaplayer/p-1/?serv=1";
const CHANNEL3_URL = "https://worldchampion.fun/welcome-4/";

/** Keep frozen / channel-6 tiles on the canvas even when disabled. */
function includeTile(item) {
  return !!(item && (item.frozen || isChannel6(item) || enabled(item)));
}

function isFox(p) {
  const id = String(p.id || "").toLowerCase();
  const title = String(p.title || "").toLowerCase();
  return id === "fox-sport" || id.includes("fox") || title.includes("fox");
}

function isSyria(url = "") {
  return /syria-player|shootsync|beinmax|kora-sami|splplayer|kore10|worldchampion/i.test(
    url
  );
}

const LIVE_PIN_ORDER = [
  "live-aljazeera",
  "live-alhadath",
  "live-aljazeera-en",
  "live-france24",
];

function sortLive(players) {
  return [...players].sort((a, b) => {
    const ia = LIVE_PIN_ORDER.indexOf(a.id);
    const ib = LIVE_PIN_ORDER.indexOf(b.id);
    const ra = ia === -1 ? 99 : ia;
    const rb = ib === -1 ? 99 : ib;
    return ra - rb;
  });
}

function browserSortKey(p) {
  const m = String(p.id || "").match(/browser-(\d+)/i);
  if (m) return Number(m[1]);
  const digits = String(p.title || "").match(/(\d+)/);
  return digits ? Number(digits[1]) : 999;
}

/** Normalize live_config into Matches canvas sections. */
export function buildCanvasModel(cfg = {}) {
  const browsers = (cfg.browserPlayers || []).filter(includeTile);
  const topBrowsers = browsers
    .filter((p) => !isFox(p))
    .sort((a, b) => browserSortKey(a) - browserSortKey(b))
    .map((p) => {
      // Channel 6 stays on the grid but frozen (not tappable).
      const frozen = isChannel6(p) || !!p.frozen;
      const url = frozen
        ? ""
        : isChannel1(p)
          ? CHANNEL1_URL
          : isChannel2(p)
            ? CHANNEL2_URL
            : isChannel3(p)
              ? CHANNEL3_URL
              : p.url;
      const syria = !frozen && isSyria(url);
      const yt = /youtube\.com|youtu\.be/i.test(url || "");
      return {
        kind: "browser",
        id: p.id,
        title: p.title,
        url,
        emphasized: syria,
        icon: syria ? "bolt" : "tv",
        streamSafe: syria || yt,
        autoFastServer: false,
        immersive: syria || isFox(p),
        frozen,
        notice: frozen
          ? p.notice || "موقف من قبل يوسف"
          : p.notice || "",
      };
    });

  const domains = (cfg.domainBrowsers || [])
    .filter(includeTile)
    .map((d) => ({
      kind: "domain",
      id: d.id,
      title: d.title,
      url: d.url,
      mode: d.mode || "manual",
      emphasized: d.mode && d.mode !== "manual",
      icon: d.mode && d.mode !== "manual" ? "bolt" : "safari",
      subtitle: (() => {
        try {
          return new URL(d.url).hostname.replace(/^www\./, "");
        } catch {
          return d.url;
        }
      })(),
    }));

  if (!topBrowsers.length) {
    [
      ["ch1", cfg.channel1_url, "قناة 1"],
      ["ch2", cfg.channel2_url, "قناة 2"],
    ].forEach(([id, url, title]) => {
      if (url) {
        topBrowsers.push({
          kind: "browser",
          id,
          title,
          url,
          emphasized: isSyria(url),
          icon: isSyria(url) ? "bolt" : "tv",
        });
      }
    });
  }

  const fox = browsers
    .filter(isFox)
    .map((p) => ({
      kind: "browser",
      id: p.id,
      title: p.title,
      url: p.url,
      emphasized: true,
      icon: "tv",
      fox: true,
      streamSafe: false,
      autoFastServer: false,
      immersive: true,
    }));

  let lives = (cfg.livePlayers || [])
    .filter(enabled)
    .map((p) => ({
      kind: "live",
      id: p.id,
      title: p.title,
      url: p.url,
      subtitle: p.subtitle || "بث مباشر",
      emphasized: false,
      icon: "tv",
      live: true,
    }));

  if (!lives.length) {
    [
      ["watch-stream-1", cfg.watch_stream1_url, "Stream 1"],
      ["watch-stream-2", cfg.watch_stream2_url, "Stream 2"],
    ].forEach(([id, url, title]) => {
      if (url) {
        lives.push({
          kind: "live",
          id,
          title,
          url,
          subtitle: "Watch HLS",
          icon: "tv",
          live: true,
        });
      }
    });
  }
  lives = sortLive(lives);

  const cb = cfg.customBrowser || {};
  const custom =
    cb.enabled === false
      ? null
      : {
          kind: "custom",
          id: "custom-browser",
          title: cb.title || "فتح أي رابط مباراة",
          subtitle:
            cb.subtitle ||
            "الصق رابط مباشر لمشغل المباراة وسوف يتم تشغيلها مع حظر الإعلانات",
          url: cb.start_url || cb.startUrl || "https://www.google.com",
          emphasized: true,
          icon: "safari",
        };

  const ch4 =
    cfg.ch4_enabled
      ? {
          kind: "ch4",
          id: "ch4",
          title: cfg.ch4_title_ar || "ملقط المباريات",
          titleEn: cfg.ch4_title_en || "Match Clipper",
          subtitle: cfg.ch4_subtitle_ar || "ضع رابط المباراة فقط وضغط انتر",
          subtitleEn: cfg.ch4_subtitle_en || "Paste the match link only and press Enter",
          streams: cfg.ch4_streams || [],
          icon: "search",
        }
      : null;

  return {
    tabTitleAr: cfg.live_title || "شاهد الان",
    tabTitleEn: cfg.live_title_en || "Watch",
    topTiles: [...topBrowsers, ...domains],
    custom,
    ch4,
    bottomTiles: [...lives, ...fox],
    raw: cfg,
  };
}

/** Same defaults/keys as the iOS app's TubiChromeRemoteConfig / LiveConfigService. */
const REPLAY_URL_DEFAULT = "https://tubitv.com/tv-shows/200371229/usa-vs-belgium";
const YT_PLAYLIST_ID_DEFAULT = "PLFHate8uTYrk";
const YT_MOMENTS_URL_DEFAULT =
  "https://www.youtube.com/watch?v=LRkMTi2bNDU&list=PLczz3UIGL1XomL2PAj_YUCcwXuXm2PRm1";

export function buildReplayModel(cfg = {}) {
  const url = String(cfg.match_replays_url || "").trim() || REPLAY_URL_DEFAULT;
  return {
    url,
    titleAr: cfg.match_replays_title_ar || cfg.match_replays_title || "اعادة المباريات",
    titleEn: cfg.match_replays_title_en || "Match Replays",
  };
}

export function buildHighlightsModel(cfg = {}) {
  const playlistId = cfg.youtube_playlist_id || YT_PLAYLIST_ID_DEFAULT;
  return {
    titleAr: cfg.highlights_title_ar || "لحظات مهمه",
    titleEn: cfg.highlights_title_en || "Highlights",
    playlistUrl: `https://m.youtube.com/playlist?list=${playlistId}`,
    momentsUrl: cfg.youtube_moments_url || YT_MOMENTS_URL_DEFAULT,
  };
}

let cached = null;

export async function loadCanvasConfig(force = false) {
  if (cached && !force) return cached;
  const json = await loadJSONCascade({
    localUrl: LOCAL.liveConfig,
    remoteUrl: REMOTE_UPDATE.liveConfig,
    cacheKey: "live_config",
    enableRemote: PWA.enableRemoteUpdates,
  });
  if (json) await kvSet("live_config", json);
  cached = buildCanvasModel(json || {});
  return cached;
}
