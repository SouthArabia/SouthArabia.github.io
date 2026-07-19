import {
  attachHlsAdblock,
  cleanHtml,
  isAdUrl,
  syncAdblockFromEngine,
} from "./adblock.js";
import { prepareFilters } from "./filter-engine.js";
import {
  streamDetectScript,
  fastServerScript,
  syriaHelpersScript,
  autoPlayScript,
  siteLockScript,
} from "./stream-detect.js";

/** Sandbox for website tiles — iframe only, no popups, no top redirects */
const SITE_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock allow-downloads";

/** Player embeds: scripts/media OK, never allow-popups / top navigation */
const PLAYER_NO_POPUP_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock allow-downloads";

/** Never block opening the player — EasyList loads in background. */
async function ensurePlayerFilters() {
  try {
    await Promise.race([
      prepareFilters(),
      new Promise((r) => setTimeout(r, 400)),
    ]);
  } catch (_) {}
  try {
    syncAdblockFromEngine();
  } catch (_) {}
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

async function fetchHtml(url) {
  const tries = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const u of tries) {
    try {
      const res = await withTimeout(fetch(u, { cache: "no-store" }), 7000);
      if (!res.ok) continue;
      const text = await withTimeout(res.text(), 7000);
      if (text && text.length > 80) return text;
    } catch (_) {}
  }
  return null;
}

function isDirectPlayerUrl(url = "") {
  // worldchampion (ch3) is treated as a site tile: EasyList + no popups/redirects
  return /syria-player|shootsync|albaplayer|beinmax|kora-sami|splplayer|kore10/i.test(
    url
  );
}

function isChannel3Site(url = "") {
  return /worldchampion\.fun/i.test(String(url || ""));
}

function isMobileDevice() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  // iPadOS desktop UA still has touch
  return navigator.maxTouchPoints > 1 && /MacIntel/i.test(navigator.platform || "");
}

async function ensureServiceWorkerReady(ms = 2500) {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const ready = navigator.serviceWorker.ready.then((reg) =>
      !!(reg?.active || navigator.serviceWorker.controller)
    );
    return await Promise.race([
      ready,
      new Promise((r) => setTimeout(() => r(false), ms)),
    ]);
  } catch (_) {
    return false;
  }
}

/**
 * Same-origin SW proxy. Use a real existing path + query so mobile Safari
 * never hits a GitHub Pages 404 when the SW is not yet controlling.
 */
function proxiedPlayerUrl(url) {
  const u = new URL("./", location.href);
  u.searchParams.set("__shaib_player", "1");
  u.searchParams.set("u", url);
  return u.href;
}

function normalizeNavUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes(" ") || !trimmed.includes(".")) {
    const q = encodeURIComponent(trimmed);
    return `https://www.google.com/search?q=${q}`;
  }
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function isMediaUrl(url) {
  return /\.(m3u8|m3u|ts|mp4)($|\?)/i.test(url) || /\/hls\//i.test(url);
}

function toolbar(buttons) {
  const bar = document.createElement("div");
  bar.className = "player-tools";
  buttons.forEach((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-tool-btn";
    btn.textContent = b.label;
    btn.title = b.title || b.label;
    btn.disabled = !!b.disabled;
    btn.addEventListener("click", b.onClick);
    bar.appendChild(btn);
  });
  return bar;
}

/**
 * Player iframe. Stream hosts reject sandbox + no-referrer ("إخفاء المصدر").
 * Never set referrerpolicy=no-referrer on embeds — players block that.
 */
function mountLockedIframe(
  url,
  { sandbox = false, siteLock = false, noPopups = false } = {}
) {
  const frame = document.createElement("iframe");
  frame.className = "player-iframe";
  frame.src = url;
  frame.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  );
  frame.setAttribute("allowfullscreen", "");
  // Explicit referrer — empty/no-referrer triggers syria-player "إخفاء المصدر" block
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  if (sandbox || siteLock || noPopups) {
    // NO allow-popups, NO allow-top-navigation — stay inside iframe
    frame.setAttribute(
      "sandbox",
      siteLock || sandbox ? SITE_SANDBOX : PLAYER_NO_POPUP_SANDBOX
    );
  }
  return frame;
}

function configureFrame(frame, { siteLock = false, noPopups = false } = {}) {
  frame.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  );
  frame.setAttribute("allowfullscreen", "");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  if (siteLock) {
    frame.setAttribute("sandbox", SITE_SANDBOX);
  } else if (noPopups) {
    frame.setAttribute("sandbox", PLAYER_NO_POPUP_SANDBOX);
  }
  return frame;
}

function siteInjectBundle(extra = "") {
  return `${siteLockScript()}\n${extra || ""}`;
}

/**
 * @param {object} opts
 */
export function createPlayerController(opts) {
  const { body, titleEl, destroyHls, setHls, t } = opts;
  let streamListener = null;
  let currentIframe = null;
  /** @type {{ items: { kind: string, title: string, url: string }[], index: number } | null} */
  let playlist = null;

  const prevBtn = () => document.getElementById("player-prev");
  const nextBtn = () => document.getElementById("player-next");
  const dockEl = () => document.getElementById("player-dock");
  const sheetEl = () => document.getElementById("player-sheet");
  let liveDockActive = false;

  function exitPlayer() {
    document.getElementById("player-close")?.click();
  }

  function setLiveDock(visible) {
    liveDockActive = !!visible;
    const dock = dockEl();
    const sheet = sheetEl();
    if (dock) dock.hidden = !visible;
    sheet?.classList.toggle("has-live-dock", !!visible);
    if (!visible) return;

    const hasNav = !!(playlist && playlist.items && playlist.items.length > 1);
    const prev = document.getElementById("dock-prev");
    const next = document.getElementById("dock-next");
    const exit = document.getElementById("dock-exit");
    const meta = document.getElementById("dock-meta");
    if (prev) {
      prev.disabled = !hasNav;
      prev.textContent = `‹ ${t("playerPrev") || "Prev"}`;
      prev.hidden = false;
    }
    if (next) {
      next.disabled = !hasNav;
      next.textContent = `${t("playerNext") || "Next"} ›`;
      next.hidden = false;
    }
    if (exit) exit.textContent = t("playerExit") || "Exit";
    if (meta) {
      if (hasNav) {
        meta.hidden = false;
        meta.textContent = `${playlist.index + 1} / ${playlist.items.length}`;
      } else {
        meta.hidden = true;
        meta.textContent = "";
      }
    }
  }

  function updatePlaylistNav() {
    const has = !!(playlist && playlist.items && playlist.items.length > 1);
    const prev = prevBtn();
    const next = nextBtn();
    // Top bar nav is hidden when bottom live dock is showing
    if (prev) {
      prev.hidden = liveDockActive || !has;
      prev.disabled = !has;
      prev.title = t("playerPrev") || "Previous";
    }
    if (next) {
      next.hidden = liveDockActive || !has;
      next.disabled = !has;
      next.title = t("playerNext") || "Next";
    }
    if (liveDockActive) setLiveDock(true);
  }

  function clear() {
    destroyHls();
    if (streamListener) {
      window.removeEventListener("message", streamListener);
      streamListener = null;
    }
    currentIframe = null;
    body.innerHTML = "";
  }

  /** Keep audio unlocked across async player loads after a tile tap. */
  function unlockMediaPlayback() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
        osc.stop(ctx.currentTime + 0.01);
        setTimeout(() => {
          try {
            ctx.close();
          } catch (_) {}
        }, 200);
      }
    } catch (_) {}
  }

  function tryAutoPlay(video) {
    if (!video) return;
    try {
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.setAttribute("autoplay", "");
      const run = () => {
        const p = video.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            const wasMuted = video.muted;
            video.muted = true;
            video.defaultMuted = true;
            video
              .play()
              .then(() => {
                if (!wasMuted) {
                  setTimeout(() => {
                    try {
                      video.muted = false;
                    } catch (_) {}
                  }, 350);
                }
              })
              .catch(() => {});
          });
        }
      };
      run();
      video.addEventListener("loadeddata", run, { once: true });
      video.addEventListener("canplay", run, { once: true });
    } catch (_) {}
  }

  function playHls(title, url) {
    titleEl.textContent = title;
    clear();
    ensurePlayerFilters().catch(() => {});
    // Bottom dock stays outside the video so users can switch/exit while watching
    setLiveDock(true);

    const wrap = document.createElement("div");
    wrap.className = "player-stack";

    const stage = document.createElement("div");
    stage.className = "player-stage";
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("autoplay", "");
    stage.appendChild(video);
    wrap.appendChild(stage);
    body.appendChild(wrap);
    updatePlaylistNav();

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      tryAutoPlay(video);
      return;
    }
    if (window.Hls?.isSupported()) {
      const hls = new window.Hls({
        enableWorker: true,
        autoStartLoad: true,
      });
      attachHlsAdblock(hls);
      setHls(hls);
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => tryAutoPlay(video));
      hls.on(window.Hls.Events.MEDIA_ATTACHED, () => tryAutoPlay(video));
      tryAutoPlay(video);
      return;
    }
    video.src = url;
    tryAutoPlay(video);
  }

  function goPlaylist(delta) {
    if (!playlist?.items?.length) return;
    const n = playlist.items.length;
    playlist.index = (playlist.index + delta + n) % n;
    const item = playlist.items[playlist.index];
    if (!item) return;
    openLive({
      kind: "live",
      title: item.title,
      url: item.url,
      keepPlaylist: true,
    });
  }

  /**
   * Ch1/Ch2: SW proxy for popup-kill + muted autoplay inject.
   * If SW is not controlling (app shell) or proxy 502s, fall back to direct — no sandbox.
   */
  function mountProxiedWithDirectFallback(url) {
    const proxyUrl = proxiedPlayerUrl(url);
    const frame = configureFrame(
      mountLockedIframe(proxyUrl, { sandbox: false })
    );
    currentIframe = frame;
    let fellBack = false;

    const goDirect = () => {
      if (fellBack || currentIframe !== frame) return;
      fellBack = true;
      try {
        frame.src = url;
      } catch (_) {}
    };

    const looksLikeProxyOk = (doc) => {
      if (!doc) return false;
      if (doc.getElementById("shaib-player-shield")) return true;
      if (doc.getElementById("shaib-player-autoplay")) return true;
      if (doc.querySelector("video, .clappr-player, #player, [data-player]"))
        return true;
      return false;
    };

    const looksBroken = (doc) => {
      if (!doc) return false;
      if (looksLikeProxyOk(doc)) return false;
      const bodyText = String(doc.body?.textContent || "").trim();
      // App shell when SW not controlling (?__shaib_player served as index)
      if (
        doc.getElementById("app-shell") ||
        doc.getElementById("auth-gate") ||
        /shaib\s*sport/i.test(String(doc.title || ""))
      ) {
        return true;
      }
      if (
        bodyText.length < 280 &&
        /forbidden|fetch failed|HTTP\s*\d|empty upstream|502|403/i.test(
          bodyText
        )
      ) {
        return true;
      }
      return false;
    };

    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument;
        if (looksBroken(doc)) goDirect();
      } catch (_) {
        /* cross-origin direct embed — leave it */
      }
    });
    frame.addEventListener("error", goDirect);
    setTimeout(() => {
      try {
        if (looksBroken(frame.contentDocument)) goDirect();
      } catch (_) {}
    }, 3500);

    return { frame, mode: "proxied-ch1" };
  }

  /**
   * Stream / syria player embeds (no site sandbox — players reject it).
   */
  async function mountShielded(url, injectExtra = "") {
    ensurePlayerFilters().catch(() => {});

    if (isDirectPlayerUrl(url)) {
      // Ch1 (kora-sami): on iOS/Android use SW proxy autoplay inject; desktop stays direct
      if (/kora-sami|splplayer/i.test(url)) {
        if (isMobileDevice() && (await ensureServiceWorkerReady())) {
          const mounted = mountProxiedWithDirectFallback(url);
          mounted.mode = "proxied-ch1-mobile";
          return mounted;
        }
        const frame = configureFrame(
          mountLockedIframe(url, { sandbox: false })
        );
        currentIframe = frame;
        return { frame, mode: "direct-ch1" };
      }
      // Ch2 (kore10): SW proxy = popup-kill + autoplay; direct fallback
      if (/kore10/i.test(url)) {
        const mounted = mountProxiedWithDirectFallback(url);
        mounted.mode = "proxied-ch2";
        return mounted;
      }
      // Other stream hosts: SW proxy (ads/autoplay inject). No sandbox — players detect it.
      const frame = configureFrame(
        mountLockedIframe(proxiedPlayerUrl(url), { sandbox: false })
      );
      currentIframe = frame;
      return { frame, mode: "proxied" };
    }

    try {
      const html = await fetchHtml(url);
      if (html && /<html|<body|<div|<script/i.test(html)) {
        let cleaned;
        try {
          cleaned = cleanHtml(html, url);
        } catch (_) {
          cleaned = html;
        }
        if (injectExtra) {
          const extras = `<script>${injectExtra}</script>`;
          if (/<\/body>/i.test(cleaned)) {
            cleaned = cleaned.replace(/<\/body>/i, `${extras}</body>`);
          } else {
            cleaned += extras;
          }
        }
        const frame = configureFrame(document.createElement("iframe"));
        frame.className = "player-iframe";
        frame.srcdoc = cleaned;
        currentIframe = frame;
        return { frame, mode: "shielded" };
      }
    } catch (_) {}

    const frame = configureFrame(mountLockedIframe(url, { sandbox: false }));
    currentIframe = frame;
    return { frame, mode: "direct" };
  }

  /**
   * Non-player website tiles: always iframe, no popups, no top redirects,
   * continuous EasyList adblock inside the frame when srcdoc works.
   */
  async function mountSiteFrame(url, injectExtra = "") {
    ensurePlayerFilters().catch(() => {});
    const inject = siteInjectBundle(injectExtra);

    try {
      const html = await fetchHtml(url);
      if (html && /<html|<body|<div|<script/i.test(html)) {
        let cleaned;
        try {
          cleaned = cleanHtml(html, url); // continuous adblock shield
        } catch (_) {
          cleaned = String(html);
        }
        const extras = `<script>${inject}</script>`;
        if (/<\/body>/i.test(cleaned)) {
          cleaned = cleaned.replace(/<\/body>/i, `${extras}</body>`);
        } else {
          cleaned += extras;
        }
        const frame = configureFrame(document.createElement("iframe"), {
          siteLock: true,
        });
        frame.className = "player-iframe";
        frame.srcdoc = cleaned;
        currentIframe = frame;
        return { frame, mode: "site-shielded" };
      }
    } catch (_) {}

    // Fallback: sandboxed iframe (still blocks popups / top navigation)
    const frame = configureFrame(
      mountLockedIframe(url, { siteLock: true }),
      { siteLock: true }
    );
    currentIframe = frame;
    return { frame, mode: "site-direct" };
  }

  function listenForStreams(onStream, { once = true } = {}) {
    if (streamListener) window.removeEventListener("message", streamListener);
    streamListener = (ev) => {
      const data = ev.data;
      if (!data || data.type !== "shaibDomainStream" || !data.url) return;
      if (isAdUrl(data.url)) return;
      if (once && streamListener) {
        window.removeEventListener("message", streamListener);
        streamListener = null;
      }
      onStream(data.url);
    };
    window.addEventListener("message", streamListener);
  }

  function openLive(tile) {
    playHls(tile.title, tile.url);
  }

  /** Syria / stream browser tiles — player proxy path */
  async function openBrowser(tile) {
    titleEl.textContent = tile.title;
    clear();
    body.innerHTML = `<div class="loading" style="margin:40px;border:0">${t("adblockLoading")}</div>`;

    const wrap = document.createElement("div");
    wrap.className = "player-stack";
    const status = document.createElement("div");
    status.className = "player-status";
    status.textContent = t("adblockOn");

    const tools = toolbar([
      {
        label: "↻",
        title: "Reload",
        onClick: () => openBrowser(tile),
      },
    ]);
    wrap.appendChild(tools);
    wrap.appendChild(status);

    const stage = document.createElement("div");
    stage.className = "player-stage";
    wrap.appendChild(stage);
    body.innerHTML = "";
    body.appendChild(wrap);

    // Channel 3 / non-player sites: EasyList + continuous scan, no popups/redirects
    if (!isDirectPlayerUrl(tile.url) || isChannel3Site(tile.url)) {
      try {
        const mounted = await mountSiteFrame(
          tile.url,
          autoPlayScript() + (tile.autoFastServer ? fastServerScript() : "")
        );
        stage.innerHTML = "";
        stage.appendChild(mounted.frame);
        status.textContent = isChannel3Site(tile.url)
          ? "AdBlock · EasyList · continuous scan"
          : t("adblockScanning");
      } catch (_) {
        stage.innerHTML = "";
        const frame = configureFrame(
          mountLockedIframe(tile.url, { siteLock: true }),
          { siteLock: true }
        );
        stage.appendChild(frame);
        currentIframe = frame;
        status.textContent = t("adblockOn");
      }
      return;
    }

    let inject = syriaHelpersScript() + autoPlayScript();
    if (tile.autoFastServer) inject += fastServerScript();

    try {
      const mounted = await mountShielded(tile.url, inject);
      stage.innerHTML = "";
      stage.appendChild(mounted.frame);
      status.textContent = t("adblockScanning");
    } catch (_) {
      stage.innerHTML = "";
      const frame = configureFrame(mountLockedIframe(tile.url, { sandbox: false }));
      stage.appendChild(frame);
      currentIframe = frame;
      status.textContent = t("adblockOn");
    }
  }

  /** Domain sites — iframe only, no popups/redirects, continuous adblock */
  async function openDomain(tile) {
    titleEl.textContent = tile.title;
    clear();
    body.innerHTML = `<div class="loading" style="margin:40px;border:0">${t("adblockLoading")}</div>`;

    const mode = tile.mode && tile.mode !== "manual" ? tile.mode : "stingPlay";
    let autoOn = true;

    const wrap = document.createElement("div");
    wrap.className = "player-stack";
    const stage = document.createElement("div");
    stage.className = "player-stage";

    const status = document.createElement("div");
    status.className = "player-status";
    status.textContent = t("adblockScanning");

    const tools = toolbar([
      {
        label: "‹",
        title: "Back",
        onClick: () => {
          try {
            currentIframe?.contentWindow?.history.back();
          } catch (_) {}
        },
      },
      {
        label: "›",
        title: "Forward",
        onClick: () => {
          try {
            currentIframe?.contentWindow?.history.forward();
          } catch (_) {}
        },
      },
      {
        label: "↻",
        title: "Reload",
        onClick: () => openDomain(tile),
      },
      {
        label: autoOn ? "Auto ●" : "Auto ○",
        title: "Auto click",
        onClick: (ev) => {
          autoOn = !autoOn;
          ev.currentTarget.textContent = autoOn ? "Auto ●" : "Auto ○";
          try {
            currentIframe?.contentWindow?._shaibSetAutoClick?.(autoOn);
          } catch (_) {}
        },
      },
    ]);

    wrap.appendChild(tools);
    wrap.appendChild(status);
    wrap.appendChild(stage);
    body.innerHTML = "";
    body.appendChild(wrap);

    listenForStreams((streamUrl) => {
      status.textContent = t("streamFound");
      playHls(tile.title, streamUrl);
    });

    const inject = streamDetectScript(mode) + autoPlayScript();
    try {
      const mounted = await mountSiteFrame(tile.url, inject);
      stage.innerHTML = "";
      stage.appendChild(mounted.frame);
      status.textContent = `${t("adblockOn")} · ${t("domainAuto")}`;
    } catch (_) {
      stage.innerHTML = "";
      const frame = configureFrame(
        mountLockedIframe(tile.url, { siteLock: true }),
        { siteLock: true }
      );
      stage.appendChild(frame);
      currentIframe = frame;
      status.textContent = t("adblockOn");
    }
    try {
      currentIframe?.contentWindow?._shaibSetAutoClick?.(true);
    } catch (_) {}
  }

  /** Custom browser — site iframe + adblock, no popups */
  function openCustom(tile) {
    titleEl.textContent = tile.title;
    clear();

    const wrap = document.createElement("div");
    wrap.className = "player-stack";
    const status = document.createElement("div");
    status.className = "player-status";
    status.textContent = t("adblockOn");

    const form = document.createElement("form");
    form.className = "player-urlbar";
    form.innerHTML = `
      <input id="custom-url" type="text" enterkeyhint="go" placeholder="https://…" />
      <button class="btn" type="submit">${t("go")}</button>
    `;
    const stage = document.createElement("div");
    stage.className = "player-stage";

    const load = async (raw) => {
      const url = normalizeNavUrl(raw);
      if (!url || isAdUrl(url)) {
        status.textContent = t("adBlockedNav");
        return;
      }
      status.textContent = t("adblockLoading");
      stage.innerHTML = `<div class="loading" style="margin:40px;border:0">${t("adblockLoading")}</div>`;
      try {
        const mounted = await mountSiteFrame(url, autoPlayScript());
        stage.innerHTML = "";
        stage.appendChild(mounted.frame);
        status.textContent = t("adblockScanning");
      } catch (_) {
        stage.innerHTML = "";
        const frame = configureFrame(
          mountLockedIframe(url, { siteLock: true }),
          { siteLock: true }
        );
        stage.appendChild(frame);
        currentIframe = frame;
        status.textContent = t("adblockOn");
      }
    };

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      load(form.querySelector("#custom-url").value);
    });

    wrap.appendChild(form);
    wrap.appendChild(status);
    wrap.appendChild(stage);
    body.appendChild(wrap);

    const start = tile.url || "https://www.google.com";
    form.querySelector("#custom-url").value = start;
    load(start);
  }

  /** CH4 — media → HLS player; pages → locked site iframe */
  function openCH4(tile) {
    titleEl.textContent = tile.title;
    clear();

    const wrap = document.createElement("div");
    wrap.className = "player-stack";
    wrap.innerHTML = `
      <div class="ch4-box">
        <p style="color:var(--muted);margin:0">${tile.subtitle || ""}</p>
        <input id="ch4-input" type="text" placeholder="https://…" enterkeyhint="go" />
        <button class="btn" id="ch4-go" type="button">${t("openLink")}</button>
      </div>
    `;
    body.appendChild(wrap);

    const go = async () => {
      let raw = wrap.querySelector("#ch4-input").value.trim();
      if (!raw) return;
      if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
      if (isAdUrl(raw)) return;
      if (isMediaUrl(raw) || isDirectPlayerUrl(raw)) {
        if (isDirectPlayerUrl(raw)) {
          openBrowser({ ...tile, kind: "browser", url: raw, title: tile.title });
          return;
        }
        playHls(tile.title, raw);
        return;
      }
      titleEl.textContent = tile.title;
      clear();
      body.innerHTML = `<div class="loading" style="margin:40px;border:0">${t("adblockLoading")}</div>`;
      const stack = document.createElement("div");
      stack.className = "player-stack";
      const status = document.createElement("div");
      status.className = "player-status";
      status.textContent = t("adblockScanning");
      const tools = toolbar([
        { label: "✎", title: "Paste again", onClick: () => openCH4(tile) },
        { label: "↻", title: "Reload", onClick: () => go() },
      ]);
      const st = document.createElement("div");
      st.className = "player-stage";
      stack.appendChild(tools);
      stack.appendChild(status);
      stack.appendChild(st);
      body.innerHTML = "";
      body.appendChild(stack);
      try {
        const mounted = await mountSiteFrame(raw, autoPlayScript());
        st.appendChild(mounted.frame);
        status.textContent = t("adblockScanning");
      } catch (_) {
        const frame = configureFrame(
          mountLockedIframe(raw, { siteLock: true }),
          { siteLock: true }
        );
        st.appendChild(frame);
        currentIframe = frame;
        status.textContent = t("adblockOn");
      }
    };

    wrap.querySelector("#ch4-go").onclick = go;
    wrap.querySelector("#ch4-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") go();
    });
  }

  async function openTile(tile) {
    unlockMediaPlayback();
    // Kick EasyList load for every tile (Watch / Live TV / domains)
    ensurePlayerFilters().catch(() => {});
    titleEl.textContent = tile.title;
    if (Array.isArray(tile.playlist) && tile.playlist.length) {
      playlist = {
        items: tile.playlist,
        index: Math.max(0, Math.min(tile.playlistIndex ?? 0, tile.playlist.length - 1)),
      };
    } else if (!tile.keepPlaylist) {
      playlist = null;
    }

    // Non-live players: hide bottom dock (live opens it in playHls)
    if (tile.kind !== "live") setLiveDock(false);
    updatePlaylistNav();

    // Kick filter refresh in background — never gate the player on it
    if (tile.kind !== "live") ensurePlayerFilters();
    switch (tile.kind) {
      case "live":
        return openLive(tile);
      case "browser":
        return openBrowser(tile);
      case "domain":
        return openDomain(tile);
      case "custom":
        return openCustom(tile);
      case "ch4":
        return openCH4(tile);
      default:
        return openBrowser({ ...tile, streamSafe: true });
    }
  }

  function bindPlaylistButtons() {
    prevBtn()?.addEventListener("click", () => goPlaylist(-1));
    nextBtn()?.addEventListener("click", () => goPlaylist(1));
    document.getElementById("dock-prev")?.addEventListener("click", () => goPlaylist(-1));
    document.getElementById("dock-next")?.addEventListener("click", () => goPlaylist(1));
    document.getElementById("dock-exit")?.addEventListener("click", () => exitPlayer());
  }
  bindPlaylistButtons();

  const originalClear = clear;
  function clearAll() {
    setLiveDock(false);
    originalClear();
  }

  return {
    openTile,
    playHls,
    clear: clearAll,
    mountLockedIframe,
    goPlaylist,
    updatePlaylistNav,
  };
}
