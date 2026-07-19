import { store } from "./store.js";
import { t, applyDir, iptvGroupLabel, iptvGroupMatchesQuery } from "./i18n.js";
import {
  fetchTodayBoard,
  fetchInternationalBoard,
  fetchKnockout,
} from "./api.js";
import { loadCanvasConfig } from "./config.js";
import { icons, iconWrap } from "./icons.js";
import { isLoggedIn, login, logout } from "./auth.js";
import { createPlayerController } from "./player.js";
import { prepareFilters } from "./filter-engine.js";
import { installGlobalAdblock } from "./global-adblock.js";
import {
  IPTV_PLAYLIST_URL,
  fetchIptvPlaylist,
  groupChannels,
} from "./iptv.js";

const SOUTH_ARABIA_FLAG = "./assets/flags/south-yemen.svg";

/** FIFA / UK home-nation codes → flagcdn slug */
const FLAG_CDN = {
  eng: "gb-eng",
  sco: "gb-sct",
  wal: "gb-wls",
  nir: "gb-nir",
  "gb-eng": "gb-eng",
  "gb-sct": "gb-sct",
  "gb-wls": "gb-wls",
  "gb-nir": "gb-nir",
};

function isSouthArabiaTeam(team) {
  const blob = [
    team?.name,
    team?.nameAr,
    team?.nameSY,
    team?.country,
    team?.flagCode,
    team?.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    blob.includes("الجنوب العربي") ||
    blob.includes("الجنوب_العربي") ||
    blob.includes("جنوب عربي") ||
    blob.includes("south arabia") ||
    blob.includes("south yemen") ||
    blob.includes("southyemen") ||
    blob.includes("democratic yemen")
  );
}

/** Resolve a flagcdn / ISO code for a team (fixes England/Scotland gb-eng emoji bug). */
function resolveFlagCode(team, name) {
  const raw = String(team?.flagCode || team?.abbreviation || "").toLowerCase().trim();
  const label = String(name || team?.name || team?.nameAr || "").toLowerCase();
  if (/england|إنجل/.test(label)) return "gb-eng";
  if (/scotland|اسكتل/.test(label)) return "gb-sct";
  if (/wales|ويلز/.test(label)) return "gb-wls";
  if (/northern ireland|إيرلندا الشمالية/.test(label)) return "gb-nir";
  if (FLAG_CDN[raw]) return FLAG_CDN[raw];
  if (raw.includes("-")) return raw;
  if (/^[a-z]{2}$/.test(raw)) return raw;
  return "";
}

function teamFlagHtml(team, name) {
  if (isSouthArabiaTeam(team) || /الجنوب\s*العربي/i.test(name || "")) {
    return `<img class="flag-img" src="${SOUTH_ARABIA_FLAG}" alt="الجنوب العربي" loading="lazy" onerror="this.outerHTML='<div class=&quot;flag&quot;>🇾🇪</div>'" />`;
  }
  const code = resolveFlagCode(team, name);
  if (code.includes("-") || code.length > 2) {
    return `<img class="flag-img" src="https://flagcdn.com/w80/${code}.png" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;flag&quot;>🏳️</div>'" />`;
  }
  if (code.length === 2) {
    const flag = String.fromCodePoint(
      ...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))
    );
    return `<div class="flag">${flag}</div>`;
  }
  return `<div class="flag">🏳️</div>`;
}

const state = {
  prefs: store.load(),
  cache: {
    canvas: null,
    today: null,
    international: null,
    knockout: null,
    iptv: null,
  },
  iptv: {
    view: "groups", // groups | channels
    group: null,
    query: "",
    page: 0,
  },
  deferredInstall: null,
  hls: null,
  player: null,
};

const IPTV_PAGE_SIZE = 48;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function letterCrest(name) {
  const letter = (name || "?").trim().charAt(0).toUpperCase();
  return `<span class="crest-letter">${letter}</span>`;
}

/** Country / club badge with CDN fallbacks (never hide leaving a blank). */
function crest(url, name, flagCode) {
  const urls = [];
  if (url) urls.push(url);
  const fromLogo = String(url || "").match(/\/countries\/\d+\/([a-z0-9-]{2,8})\./i);
  const resolved = resolveFlagCode({ flagCode, abbreviation: flagCode }, name);
  const code = resolved || String(flagCode || fromLogo?.[1] || "").toLowerCase();
  if (code.includes("-") || code.length === 2) {
    urls.push(`https://flagcdn.com/w80/${code}.png`);
    urls.push(`https://flagcdn.com/${code}.svg`);
  } else if (code.length === 3) {
    urls.push(`https://a.espncdn.com/i/teamlogos/countries/500/${code}.png`);
    if (FLAG_CDN[code]) {
      urls.push(`https://flagcdn.com/w80/${FLAG_CDN[code]}.png`);
    }
  }
  if (!urls.length) return letterCrest(name);

  const primary = urls[0];
  const rest = urls
    .slice(1)
    .map((u) => u.replace(/"/g, ""))
    .join("|");
  return `<img class="crest-img" src="${primary}" alt="" loading="lazy" data-fallbacks="${rest}" onerror="window.__shaibCrestFallback&&window.__shaibCrestFallback(this)" />`;
}

function statusBadge(match, lang) {
  if (match.status === "IN_PLAY" || match.status === "PAUSED") {
    const clock = match.minute ? ` ${match.minute}` : "";
    return `<span class="badge live">${t(lang, "live")}${clock}</span>`;
  }
  if (match.status === "FINISHED") return `<span class="badge ft">${t(lang, "ft")}</span>`;
  return `<span class="badge ns">${match.time || t(lang, "upcoming")}</span>`;
}

function renderMatchCard(match, lang) {
  const score =
    match.score != null ? `${match.score.home} – ${match.score.away}` : "vs";
  const homeFlag = match.homeTeam.flagCode || match.homeTeam.abbreviation;
  const awayFlag = match.awayTeam.flagCode || match.awayTeam.abbreviation;
  return `
    <article class="match-card">
      <div class="comp">
        <span>${match.competition || ""}</span>
        ${statusBadge(match, lang)}
      </div>
      <div class="teams">
        <div class="team home">
          ${crest(match.homeTeam.crest, match.homeTeam.name, homeFlag)}
          <div class="name">${match.homeTeam.name}</div>
        </div>
        <div class="scorebox">
          <div class="score">${score}</div>
          <div class="meta">${match.dateString || ""} · ${match.time || ""}</div>
        </div>
        <div class="team away">
          ${crest(match.awayTeam.crest, match.awayTeam.name, awayFlag)}
          <div class="name">${match.awayTeam.name}</div>
        </div>
      </div>
    </article>
  `;
}

function renderList(el, matches, lang, error) {
  if (error) {
    el.innerHTML = `<div class="error">${t(lang, "error")}<div style="margin-top:12px"><button class="btn" data-retry>${t(lang, "refresh")}</button></div></div>`;
    el.querySelector("[data-retry]")?.addEventListener("click", () => hardRefresh());
    return;
  }
  if (!matches?.length) {
    el.innerHTML = `<div class="empty">${t(lang, "empty")}</div>`;
    return;
  }
  el.innerHTML = `<div class="match-list">${matches.map((m) => renderMatchCard(m, lang)).join("")}</div>`;
}

function tileButton(tile, extraClass = "") {
  const frozen = !!tile.frozen;
  const cls = `tile ${tile.emphasized ? "emphasized" : ""} ${frozen ? "tile-frozen" : ""} ${extraClass}`.trim();
  const notice = tile.notice
    ? `<div class="tile-notice">${tile.notice}</div>`
    : "";
  const badge = frozen
    ? ""
    : tile.live
      ? `<span class="live-pill">مباشر</span>`
      : tile.emphasized && tile.kind === "domain"
        ? `<span style="color:var(--ok)">${icons.play}</span>`
        : tile.kind === "browser"
          ? `<span class="dot-live"></span>`
          : "";
  const disabledAttr = frozen ? ' disabled aria-disabled="true"' : "";

  if (tile.kind === "custom" || tile.kind === "ch4") {
    const shield =
      tile.kind === "custom"
        ? `<span class="shield">${icons.shield}</span>`
        : "";
    return `
      <button type="button" class="${cls} tile-wide" data-tile-id="${tile.id}"${disabledAttr}>
        ${notice}
        ${iconWrap(tile.icon || (tile.kind === "ch4" ? "search" : "safari"))}
        <div class="tile-copy">
          <div class="tile-title">${tile.title}</div>
          <div class="tile-sub">${tile.subtitle || ""}</div>
        </div>
        ${shield}
        <span class="chev">‹</span>
      </button>`;
  }

  return `
    <button type="button" class="${cls}" data-tile-id="${tile.id}"${disabledAttr}>
      ${notice}
      <div class="tile-top">
        ${icons[tile.icon] || icons.tv}
        ${badge}
      </div>
      <div>
        <div class="tile-title">${tile.title}</div>
        ${tile.subtitle ? `<div class="tile-sub">${tile.subtitle}</div>` : ""}
      </div>
    </button>`;
}

function bindCanvasClicks(root, model) {
  root.querySelectorAll("[data-tile-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
      const id = btn.dataset.tileId;
      const all = [
        ...model.topTiles,
        model.custom,
        model.ch4,
        ...model.bottomTiles,
      ].filter(Boolean);
      const tile = all.find((x) => x.id === id);
      if (tile?.frozen) return;
      if (tile) openPlayer(tile);
    });
  });
}

function renderCanvas(model, lang) {
  const root = $("#canvas-root");
  if (!model || (!model.topTiles.length && !model.bottomTiles.length && !model.custom && !model.ch4)) {
    root.innerHTML = `
      <div class="empty">
        <div style="font-size:2rem;margin-bottom:8px;opacity:.5">📺</div>
        ${t(lang, "noPlayers")}
      </div>`;
    return;
  }

  const title = lang === "ar" ? model.tabTitleAr : model.tabTitleEn;
  $("#matches-heading").textContent = title;

  let html = "";
  if (model.topTiles.length) {
    html += `<div class="canvas-grid">${model.topTiles.map((tile) => tileButton(tile)).join("")}</div>`;
  }
  if (model.custom) {
    html += `<div class="canvas-wide">${tileButton(model.custom)}</div>`;
  }
  if (model.ch4) {
    const ch4 = {
      ...model.ch4,
      title: lang === "ar" ? model.ch4.title : model.ch4.titleEn,
      subtitle: lang === "ar" ? model.ch4.subtitle : model.ch4.subtitleEn,
    };
    html += `<div class="canvas-wide">${tileButton(ch4)}</div>`;
  }
  if (model.bottomTiles.length) {
    html += `<div class="canvas-grid" style="margin-top:12px">${model.bottomTiles
      .map((tile) => tileButton(tile))
      .join("")}</div>`;
  }
  root.innerHTML = html;
  bindCanvasClicks(root, model);
}

function destroyHls() {
  if (state.hls) {
    try {
      state.hls.destroy();
    } catch (_) {}
    state.hls = null;
  }
}

function ensurePlayer() {
  if (state.player) return state.player;
  state.player = createPlayerController({
    body: $("#player-body"),
    titleEl: $("#player-title"),
    destroyHls,
    setHls: (hls) => {
      state.hls = hls;
    },
    t: (key) => t(state.prefs.lang, key),
  });
  return state.player;
}

function openPlayer(tile) {
  const sheet = $("#player-sheet");
  sheet.hidden = false;
  // Tile tap counts as a user gesture — start playback ASAP
  ensurePlayer().openTile(tile);
}

function closePlayer() {
  if (state.player) state.player.clear();
  else {
    destroyHls();
    $("#player-body").innerHTML = "";
  }
  $("#player-sheet").hidden = true;
  $("#player-sheet")?.classList.remove("has-live-dock");
  const dock = $("#player-dock");
  if (dock) dock.hidden = true;
  const prev = $("#player-prev");
  const next = $("#player-next");
  if (prev) prev.hidden = true;
  if (next) next.hidden = true;
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === "royale" ? "royale" : "classic";
}

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIosDevice() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS desktop UA
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent || "");
}

function canOfferInstall() {
  if (isStandaloneApp()) return false;
  return !!(state.deferredInstall || isIosDevice() || isAndroidDevice());
}

function openInstallGuide() {
  const lang = state.prefs.lang;
  const sheet = $("#install-sheet");
  if (!sheet) return;
  const android = isAndroidDevice() && !isIosDevice();
  $("#install-sheet-title").textContent = t(
    lang,
    android ? "installSheetTitleAndroid" : "installSheetTitle"
  );
  $("#install-sheet-hint").textContent = t(
    lang,
    android ? "installSheetHintAndroid" : "installSheetHint"
  );
  const stepKey = android ? "installAndroidStep" : "installIosStep";
  $("#install-sheet-steps").innerHTML = [1, 2, 3]
    .map((n) => `<li>${t(lang, `${stepKey}${n}`)}</li>`)
    .join("");
  $("#install-sheet-close").textContent = t(lang, "gotIt");
  sheet.hidden = false;
}

function closeInstallGuide() {
  const sheet = $("#install-sheet");
  if (sheet) sheet.hidden = true;
}

async function offerInstall() {
  // Android Chrome / Edge: native install prompt when available
  if (state.deferredInstall) {
    try {
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
    } catch (_) {}
    state.deferredInstall = null;
    paintChrome();
    return;
  }
  // iOS / Android fallback: step-by-step guide
  openInstallGuide();
}

function paintChrome() {
  const lang = state.prefs.lang;
  applyDir(lang);
  setTheme(state.prefs.theme);

  $("#brand-sub").textContent = t(lang, "brandSub");
  const refreshBtn = $("#refresh-btn");
  if (refreshBtn) {
    refreshBtn.title = t(lang, "hardRefresh");
    refreshBtn.setAttribute("aria-label", t(lang, "hardRefresh"));
  }
  $$(".tabbar button").forEach((btn) => {
    btn.querySelector("span").textContent = t(lang, btn.dataset.tab);
    btn.classList.toggle("active", btn.dataset.tab === state.prefs.tab);
  });

  $$("[data-i18n]").forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n);
  });

  $$(".page").forEach((p) => {
    p.hidden = p.dataset.page !== state.prefs.tab;
  });

  $("#lbl-language").childNodes[0].textContent = `${t(lang, "language")} `;
  $("#lbl-theme").childNodes[0].textContent = `${t(lang, "theme")} `;
  $("#lbl-privacy").textContent = t(lang, "privacy");
  $("#lbl-contact").textContent = t(lang, "contact");
  $("#lbl-about").textContent = t(lang, "about");
  $("#privacy-body").textContent = t(lang, "privacyBody");
  $("#about-body").textContent = t(lang, "aboutBody");
  $("#btn-wa").textContent = t(lang, "openWhatsApp");
  if ($("#lbl-logout")) $("#lbl-logout").textContent = t(lang, "logout");
  if ($("#btn-logout")) $("#btn-logout").textContent = t(lang, "logout");
  $("#theme-classic").textContent = t(lang, "classic");
  $("#theme-royale").textContent = t(lang, "royale");
  $("#lang-ar").classList.toggle("active", lang === "ar");
  $("#lang-en").classList.toggle("active", lang === "en");
  $("#theme-classic").classList.toggle("active", state.prefs.theme === "classic");
  $("#theme-royale").classList.toggle("active", state.prefs.theme === "royale");

  const standalone = isStandaloneApp();
  const ios = isIosDevice();
  const android = isAndroidDevice();
  const dismissed = sessionStorage.getItem("shaib_install_dismissed");
  const showBanner =
    !standalone && !dismissed && (state.deferredInstall || ios || android);

  const banner = $("#install-banner");
  if (banner) banner.hidden = !showBanner;
  $("#install-title").textContent = t(lang, "installTitle");
  $("#install-body").textContent = ios
    ? t(lang, "installBodyIos")
    : android
      ? t(lang, "installBodyAndroid")
      : t(lang, "installBody");
  $("#install-btn").textContent = state.deferredInstall
    ? t(lang, "installBtn")
    : t(lang, "installBtnHow");
  $("#install-dismiss").textContent = t(lang, "dismiss");

  const installCard = $("#install-settings-card");
  if (installCard) installCard.hidden = standalone;
  if ($("#lbl-install")) $("#lbl-install").textContent = t(lang, "installSettings");
  if ($("#install-settings-sub")) {
    $("#install-settings-sub").textContent = standalone
      ? t(lang, "installDone")
      : android
        ? t(lang, "installBodyAndroid")
        : ios
          ? t(lang, "installBodyIos")
          : t(lang, "installSettingsSub");
  }
  if ($("#btn-install-settings")) {
    $("#btn-install-settings").textContent = state.deferredInstall
      ? t(lang, "installBtn")
      : t(lang, "installBtnHow");
  }
}

async function loadMatches(force) {
  const lang = state.prefs.lang;
  const root = $("#canvas-root");
  if (!force && state.cache.canvas) {
    renderCanvas(state.cache.canvas, lang);
    return;
  }
  root.innerHTML = `<div class="loading">${t(lang, "loading")}</div>`;
  try {
    state.cache.canvas = await loadCanvasConfig(force);
    renderCanvas(state.cache.canvas, lang);
  } catch {
    root.innerHTML = `<div class="error">${t(lang, "error")}<div style="margin-top:12px"><button class="btn" id="retry-canvas">${t(lang, "refresh")}</button></div></div>`;
    $("#retry-canvas")?.addEventListener("click", () => hardRefresh());
  }
}

async function loadToday(force) {
  const el = $("#today-list");
  if (!force && state.cache.today) {
    renderList(el, state.cache.today, state.prefs.lang);
    return;
  }
  el.innerHTML = `<div class="loading">${t(state.prefs.lang, "loading")}</div>`;
  try {
    state.cache.today = await fetchTodayBoard();
    renderList(el, state.cache.today, state.prefs.lang);
  } catch {
    renderList(el, null, state.prefs.lang, true);
  }
}

async function loadInternational(force) {
  const listEl = $("#intl-list");
  const koEl = $("#knockout-grid");
  const lang = state.prefs.lang;

  $("#teams-label").textContent = t(lang, "teams");

  if (!force && state.cache.knockout) {
    renderKnockout(koEl, state.cache.knockout, lang);
  } else {
    koEl.innerHTML = `<div class="loading">${t(lang, "loading")}</div>`;
    state.cache.knockout = await fetchKnockout();
    renderKnockout(koEl, state.cache.knockout, lang);
  }

  if (!force && state.cache.international) {
    renderList(listEl, state.cache.international.slice(0, 40), lang);
    return;
  }
  listEl.innerHTML = `<div class="loading">${t(lang, "loading")}</div>`;
  try {
    state.cache.international = await fetchInternationalBoard();
    renderList(listEl, state.cache.international.slice(0, 40), lang);
  } catch {
    renderList(listEl, null, lang, true);
  }
}

function renderKnockout(el, data, lang) {
  const teams = data?.teams || [];
  if (!teams.length) {
    el.innerHTML = `<div class="empty">${t(lang, "empty")}</div>`;
    return;
  }
  el.innerHTML = teams
    .map((team) => {
      const qualified = String(team.status || "").toLowerCase() === "qualified";
      const name = lang === "ar" ? team.nameAr || team.nameSY || team.name : team.name;
      const st = qualified ? t(lang, "qualified") : t(lang, "eliminated");
      return `
        <div class="ko-card ${qualified ? "qualified" : "eliminated"}">
          ${teamFlagHtml(team, name)}
          <div class="tname">${name || "—"}</div>
          <div class="status">${st}</div>
        </div>`;
    })
    .join("");
}

function iptvTileHtml(tile) {
  const lang = state.prefs.lang;
  const logo = tile.logo
    ? `<img class="tile-logo" src="${tile.logo}" alt="" loading="lazy" onerror="this.style.display='none'" />`
    : icons[tile.icon] || icons.tv;
  const badge = tile.live ? `<span class="live-pill">${t(lang, "live")}</span>` : "";
  return `
    <button type="button" class="tile ${tile.emphasized ? "emphasized" : ""}" data-iptv-id="${tile.id}">
      <div class="tile-top">
        ${logo}
        ${badge}
      </div>
      <div>
        <div class="tile-title">${tile.title}</div>
        ${tile.subtitle ? `<div class="tile-sub">${tile.subtitle}</div>` : ""}
      </div>
    </button>`;
}

function renderIptv() {
  const root = $("#iptv-root");
  if (!root) return;
  const lang = state.prefs.lang;
  const data = state.cache.iptv;
  if (!data?.groups?.length) {
    root.innerHTML = `<div class="empty">${t(lang, "empty")}</div>`;
    return;
  }

  const q = state.iptv.query.trim().toLowerCase();
  let html = `
    <div class="iptv-toolbar">
      <input id="iptv-search" type="search" enterkeyhint="search" placeholder="${t(lang, "iptvSearch")}" value="${state.iptv.query.replace(/"/g, "&quot;")}" />
    </div>`;

  if (state.iptv.view === "channels" && state.iptv.group) {
    const allMode = state.iptv.group === "__all__";
    const group = allMode ? null : data.groups.find((g) => g.name === state.iptv.group);
    let list = allMode ? data.channels || [] : group?.channels || [];
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          iptvGroupMatchesQuery(lang, c.group, q)
      );
    }
    const page = state.iptv.page;
    const slice = list.slice(0, (page + 1) * IPTV_PAGE_SIZE);
    const heading = allMode ? t(lang, "iptvAll") : iptvGroupLabel(lang, state.iptv.group);
    html += `
      <div class="iptv-back-row">
        <button type="button" class="btn ghost" id="iptv-back">‹ ${t(lang, "iptvBack")}</button>
        <strong>${heading}</strong>
        <span class="muted">${list.length}</span>
      </div>
      <div class="canvas-grid">
        ${slice
          .map((ch) =>
            iptvTileHtml({
              id: `ch:${ch.url}`,
              title: ch.name,
              subtitle: iptvGroupLabel(lang, ch.group),
              logo: ch.logo,
              icon: "tv",
              live: true,
              url: ch.url,
            })
          )
          .join("")}
      </div>`;
    if (slice.length < list.length) {
      html += `<div style="margin:14px 0;text-align:center"><button type="button" class="btn" id="iptv-more">${t(lang, "iptvMore")}</button></div>`;
    }
  } else {
    let groups = data.groups;
    if (q) {
      groups = groups
        .map((g) => {
          const nameHit = iptvGroupMatchesQuery(lang, g.name, q);
          const channels = g.channels.filter(
            (c) => c.name.toLowerCase().includes(q) || nameHit
          );
          return { ...g, channels, count: channels.length };
        })
        .filter((g) => g.count > 0 || iptvGroupMatchesQuery(lang, g.name, q));
    }
    const total = data.channels?.length || 0;
    html += `
      <div class="canvas-wide" style="margin-bottom:12px">
        ${tileButton({
          id: "iptv-all",
          kind: "ch4",
          title: t(lang, "iptvAll"),
          subtitle: `${total} ${t(lang, "iptvChannels")}`,
          icon: "tv",
          emphasized: true,
        })}
      </div>
      <div class="canvas-grid">
        ${groups
          .map((g) =>
            iptvTileHtml({
              id: `grp:${g.name}`,
              title: iptvGroupLabel(lang, g.name),
              subtitle: `${g.count} ${t(lang, "iptvChannels")}`,
              icon: /sport/i.test(g.name) ? "bolt" : "tv",
              emphasized: /sport/i.test(g.name),
            })
          )
          .join("")}
      </div>`;
  }

  root.innerHTML = html;

  root.querySelector("#iptv-search")?.addEventListener("input", (e) => {
    state.iptv.query = e.target.value || "";
    state.iptv.page = 0;
    renderIptv();
    const input = $("#iptv-search");
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });
  root.querySelector("#iptv-back")?.addEventListener("click", () => {
    state.iptv.view = "groups";
    state.iptv.group = null;
    state.iptv.page = 0;
    renderIptv();
  });
  root.querySelector("#iptv-more")?.addEventListener("click", () => {
    state.iptv.page += 1;
    renderIptv();
  });
  root.querySelector('[data-tile-id="iptv-all"]')?.addEventListener("click", () => {
    state.iptv.view = "channels";
    state.iptv.group = "__all__";
    state.iptv.page = 0;
    renderIptv();
  });
  root.querySelectorAll("[data-iptv-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.iptvId || "";
      if (id.startsWith("grp:")) {
        state.iptv.view = "channels";
        state.iptv.group = id.slice(4);
        state.iptv.page = 0;
        renderIptv();
        return;
      }
      if (id.startsWith("ch:")) {
        const url = id.slice(3);
        const allMode = state.iptv.group === "__all__";
        const list = allMode
          ? data.channels || []
          : data.groups.find((g) => g.name === state.iptv.group)?.channels || [];
        const index = list.findIndex((c) => c.url === url);
        const ch = index >= 0 ? list[index] : list.find((c) => c.url === url);
        const playlist = list.map((c) => ({
          kind: "live",
          title: c.name,
          url: c.url,
        }));
        openPlayer({
          kind: "live",
          id: url,
          title: ch?.name || t(lang, "iptv"),
          url,
          playlist,
          playlistIndex: Math.max(0, index),
        });
      }
    });
  });
}

async function loadIptv(force = false) {
  const root = $("#iptv-root");
  if (!root) return;
  const lang = state.prefs.lang;
  if (!force && state.cache.iptv) {
    renderIptv();
    return;
  }
  root.innerHTML = `<div class="loading">${t(lang, "loading")}</div>`;
  try {
    const channels = await fetchIptvPlaylist(IPTV_PLAYLIST_URL);
    state.cache.iptv = { channels, groups: groupChannels(channels), url: IPTV_PLAYLIST_URL };
    state.iptv.view = "groups";
    state.iptv.group = null;
    state.iptv.page = 0;
    renderIptv();
  } catch {
    root.innerHTML = `<div class="error">${t(lang, "error")}<div style="margin-top:12px"><button class="btn" id="iptv-retry">${t(lang, "refresh")}</button></div></div>`;
    $("#iptv-retry")?.addEventListener("click", () => hardRefresh());
  }
}

async function refreshActive(force = false) {
  paintChrome();
  const tab = state.prefs.tab;
  if (tab === "matches") await loadMatches(force);
  else if (tab === "today") await loadToday(force);
  else if (tab === "international") await loadInternational(force);
  else if (tab === "iptv") await loadIptv(force);
}

let hardRefreshBusy = false;

/** Clear SW + Cache Storage, then reload with a cache-busting URL (true hard refresh). */
async function hardRefresh() {
  if (hardRefreshBusy) return;
  hardRefreshBusy = true;
  const btn = $("#refresh-btn");
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches?.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) {}
  try {
    const url = new URL(location.href);
    url.searchParams.set("_r", String(Date.now()));
    location.replace(url.href);
  } catch (_) {
    location.reload();
  }
}

function switchTab(tab) {
  state.prefs = store.save({ tab });
  refreshActive(false);
}

function paintLogin() {
  const lang = state.prefs.lang || "ar";
  applyDir(lang);
  $("#login-sub").textContent = t(lang, "loginSub");
  $("#lbl-user").textContent = t(lang, "username");
  $("#lbl-pass").textContent = t(lang, "password");
  $("#login-submit").textContent = t(lang, "loginBtn");
}

function showApp() {
  hideSplash();
  const gate = $("#login-gate");
  const shell = $("#app-shell");
  if (gate) {
    gate.hidden = true;
    gate.style.display = "none";
    gate.style.pointerEvents = "none";
  }
  if (shell) {
    shell.hidden = false;
    shell.style.display = "";
    shell.style.pointerEvents = "";
  }
  // Remove any leaked shell cosmetics that could freeze UI
  document.getElementById("shaib-global-cosmetic")?.remove();
  document.getElementById("shaib-adblock-cosmetic")?.remove();
  paintChrome();
  refreshActive(true);
}

function showLogin() {
  const shell = $("#app-shell");
  const gate = $("#login-gate");
  if (shell) {
    shell.hidden = true;
    shell.style.display = "none";
  }
  if (gate) {
    gate.hidden = false;
    gate.style.display = "";
    gate.style.pointerEvents = "";
  }
  paintLogin();
}

function bind() {
  const onTab = (btn) => {
    if (!btn?.dataset?.tab) return;
    switchTab(btn.dataset.tab);
  };
  // Single delegated handler (SVG/span have pointer-events:none)
  document.querySelector(".tabbar")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-tab]");
    if (btn) {
      e.preventDefault();
      onTab(btn);
    }
  });

  function tryLogin(e) {
    e?.preventDefault?.();
    const userEl = $("#login-user");
    const passEl = $("#login-pass");
    const err = $("#login-error");
    const ok = login(userEl?.value, passEl?.value);
    if (ok) {
      if (err) err.hidden = true;
      // Show app immediately — never wait on filter downloads
      showApp();
      ensureFiltersReady().catch(() => {});
      return;
    }
    if (err) {
      err.textContent = t(state.prefs.lang, "loginError");
      err.hidden = false;
    }
  }

  $("#login-form")?.addEventListener("submit", tryLogin);
  $("#login-submit")?.addEventListener("click", tryLogin);
  window.addEventListener("shaib-login", () => {
    showApp();
    ensureFiltersReady().catch(() => {});
  });

  $("#refresh-btn")?.addEventListener("click", () => hardRefresh());
  $("#player-close")?.addEventListener("click", closePlayer);

  $("#lang-ar")?.addEventListener("click", () => {
    state.prefs = store.save({ lang: "ar" });
    refreshActive(true);
  });
  $("#lang-en")?.addEventListener("click", () => {
    state.prefs = store.save({ lang: "en" });
    refreshActive(true);
  });
  $("#theme-classic")?.addEventListener("click", () => {
    state.prefs = store.save({ theme: "classic" });
    paintChrome();
    if (state.cache.canvas) renderCanvas(state.cache.canvas, state.prefs.lang);
  });
  $("#theme-royale")?.addEventListener("click", () => {
    state.prefs = store.save({ theme: "royale" });
    paintChrome();
    if (state.cache.canvas) renderCanvas(state.cache.canvas, state.prefs.lang);
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredInstall = e;
    paintChrome();
  });
  window.addEventListener("appinstalled", () => {
    state.deferredInstall = null;
    sessionStorage.setItem("shaib_install_dismissed", "1");
    closeInstallGuide();
    paintChrome();
  });

  $("#install-btn")?.addEventListener("click", () => offerInstall());
  $("#btn-install-settings")?.addEventListener("click", () => offerInstall());
  $("#install-dismiss")?.addEventListener("click", () => {
    sessionStorage.setItem("shaib_install_dismissed", "1");
    paintChrome();
  });
  $("#install-sheet-close")?.addEventListener("click", closeInstallGuide);
  $("#install-sheet-backdrop")?.addEventListener("click", closeInstallGuide);

  $("#btn-logout")?.addEventListener("click", () => {
    logout();
    location.reload();
  });
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await Promise.race([
      navigator.serviceWorker.register("./sw.js?v=53"),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (_) {}
}

function hideSplash() {
  const splash = document.getElementById("splash");
  if (!splash) return;
  splash.classList.add("hide");
  splash.hidden = true;
  splash.style.display = "none";
  splash.style.pointerEvents = "none";
  splash.setAttribute("aria-hidden", "true");
  try {
    splash.remove();
  } catch (_) {}
}

async function ensureFiltersReady() {
  // Shell AdBlock is SW-only (non-aggressive). Heavy lists load in background.
  installGlobalAdblock();
  const run = () =>
    prepareFilters()
      .then((stats) => {
        // Player shields sync later on open — not here (avoids UI freeze)
        installGlobalAdblock();
        return stats;
      })
      .catch(() => {
        installGlobalAdblock();
      });

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => {
      run();
    }, { timeout: 4000 });
  } else {
    setTimeout(run, 1500);
  }
}

try {
  bind();
} catch (err) {
  console.error("bind failed", err);
}

(function boot() {
  try {
    if (typeof window.__shaibBootUI === "function") window.__shaibBootUI();
    if (isLoggedIn()) showApp();
    else showLogin();
  } catch (err) {
    console.error("boot failed", err);
    try {
      showLogin();
    } catch (_) {}
  }
  hideSplash();
  registerSW().catch(() => {});
  // Filters only after UI is up — never block splash/login
  setTimeout(() => {
    ensureFiltersReady().catch(() => {});
  }, 500);
})();

window.__shaibLogout = () => {
  logout();
  location.reload();
};

window.__shaibCrestFallback = (img) => {
  if (!img) return;
  const raw = img.getAttribute("data-fallbacks") || "";
  const next = raw.split("|").filter(Boolean);
  if (next.length) {
    img.setAttribute("data-fallbacks", next.slice(1).join("|"));
    img.src = next[0];
    return;
  }
  const letter = (img.closest(".team")?.querySelector(".name")?.textContent || "?").trim().charAt(0).toUpperCase();
  const span = document.createElement("span");
  span.className = "crest-letter";
  span.textContent = letter;
  img.replaceWith(span);
};
