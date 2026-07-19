import { LOCAL, REMOTE_UPDATE, BRACKET, PWA } from "./pwa-config.js";
import { loadJSONCascade, kvSet } from "./local-store.js";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const SPORTSDB = "https://www.thesportsdb.com/api/v1/json/3";

function ymd(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function espnDay(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

async function fetchJSON(url) {
  const tryUrls = [
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  let lastErr;
  for (const u of tryUrls) {
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch failed");
}

function mapEspnStatus(type = {}, minute, home, away) {
  const name = String(type.name || "").toUpperCase();
  const state = String(type.state || "").toLowerCase();
  if (name.includes("HALFTIME")) return "PAUSED";
  if (name.includes("FINAL") || name.includes("FULL_TIME") || name.includes("END")) return "FINISHED";
  if (name.includes("POSTPONED")) return "POSTPONED";
  if (name.includes("CANCEL")) return "CANCELLED";
  if (name.includes("IN_PROGRESS") || name.includes("HALF") || state === "in") {
    if (!minute && home != null && away != null) return "FINISHED";
    return "IN_PLAY";
  }
  if (state === "post") return "FINISHED";
  return "SCHEDULED";
}

function shortName(name = "") {
  const t = name.trim();
  return t.length > 16 ? `${t.slice(0, 15)}…` : t;
}

function parseEspnEvents(json, defaultCompetition = "Soccer") {
  const events = json?.events || [];
  return events
    .map((event) => {
      const comp = (event.competitions && event.competitions[0]) || {};
      const competitors = comp.competitors || [];
      if (competitors.length < 2) return null;
      const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
      const away = competitors.find((c) => c.homeAway === "away") || competitors[1];
      const homeTeam = home.team || {};
      const awayTeam = away.team || {};
      const hs = home.score != null && home.score !== "" ? Number(home.score) : null;
      const as_ = away.score != null && away.score !== "" ? Number(away.score) : null;
      const statusObj = comp.status || {};
      const statusType = statusObj.type || {};
      const minute = statusObj.displayClock || null;
      const kickoffISO = comp.date || event.date;
      const kickoff = kickoffISO ? new Date(kickoffISO) : new Date();
      const status = mapEspnStatus(statusType, minute, hs, as_);
      return {
        id: `espn-${event.id}`,
        homeTeam: {
          id: homeTeam.id,
          name: shortName(homeTeam.displayName || homeTeam.name || "Home"),
          crest: homeTeam.logo || null,
          abbreviation: homeTeam.abbreviation || null,
        },
        awayTeam: {
          id: awayTeam.id,
          name: shortName(awayTeam.displayName || awayTeam.name || "Away"),
          crest: awayTeam.logo || null,
          abbreviation: awayTeam.abbreviation || null,
        },
        score: hs == null && as_ == null ? null : { home: hs ?? 0, away: as_ ?? 0 },
        status,
        time: kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        dateString: ymd(kickoff),
        competition: defaultCompetition,
        minute: minute && minute !== "0'" ? minute : null,
        kickoff: kickoff.getTime(),
      };
    })
    .filter(Boolean);
}

function parseSportsDbEvents(json) {
  const events = json?.events || [];
  return events
    .map((e) => {
      const hs = e.intHomeScore != null && e.intHomeScore !== "" ? Number(e.intHomeScore) : null;
      const as_ = e.intAwayScore != null && e.intAwayScore !== "" ? Number(e.intAwayScore) : null;
      const raw = String(e.strStatus || "NS").toUpperCase();
      let status = "SCHEDULED";
      if (["1H", "2H", "ET", "BT", "P"].includes(raw)) status = "IN_PLAY";
      else if (raw === "HT") status = "PAUSED";
      else if (["FT", "AET", "PEN"].includes(raw)) status = "FINISHED";
      else if (["POSTP", "SUSP", "INT"].includes(raw)) status = "POSTPONED";
      else if (["CANC", "ABD", "WO"].includes(raw)) status = "CANCELLED";

      let kickoff = new Date();
      if (e.strTimestamp) kickoff = new Date(e.strTimestamp);
      else if (e.dateEvent && e.strTime) kickoff = new Date(`${e.dateEvent}T${String(e.strTime).slice(0, 8)}Z`);

      return {
        id: String(e.idEvent || `${e.strHomeTeam}-${e.strAwayTeam}-${e.dateEvent}`),
        homeTeam: {
          name: shortName(e.strHomeTeam || "Home"),
          crest: e.strHomeTeamBadge || null,
        },
        awayTeam: {
          name: shortName(e.strAwayTeam || "Away"),
          crest: e.strAwayTeamBadge || null,
        },
        score: hs == null && as_ == null ? null : { home: hs ?? 0, away: as_ ?? 0 },
        status,
        time: kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        dateString: e.dateEvent || ymd(kickoff),
        competition: e.strLeague || "Soccer",
        minute: e.intProgress || null,
        kickoff: kickoff.getTime(),
      };
    })
    .filter((m) => m.homeTeam.name && m.awayTeam.name);
}

function dedupe(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = `${m.dateString}|${m.homeTeam.name.toLowerCase()}|${m.awayTeam.name.toLowerCase()}`;
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => a.kickoff - b.kickoff);
}

function statusRank(s) {
  if (s === "IN_PLAY" || s === "PAUSED") return 0;
  if (s === "SCHEDULED") return 1;
  if (s === "FINISHED") return 2;
  return 3;
}

export function sortMatches(matches) {
  return [...matches].sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status);
    return r !== 0 ? r : a.kickoff - b.kickoff;
  });
}

/** Broader soccer board for Matches tab */
export async function fetchMatchesBoard(date = new Date()) {
  const day = ymd(date);
  const espn = espnDay(date);
  const chunks = [];

  try {
    const sports = await fetchJSON(`${SPORTSDB}/eventsday.php?d=${day}&s=Soccer`);
    chunks.push(parseSportsDbEvents(sports));
  } catch (_) {}

  try {
    const all = await fetchJSON(`${ESPN}/all/scoreboard?dates=${espn}`);
    chunks.push(parseEspnEvents(all, "Soccer"));
  } catch (_) {}

  return sortMatches(dedupe(chunks.flat()));
}

/** Today tab — international / FIFA world day board (with lookahead) */
export async function fetchTodayBoard() {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + i);
    try {
      const json = await fetchJSON(`${ESPN}/fifa.world/scoreboard?dates=${espnDay(d)}`);
      const list = parseEspnEvents(json, "World Cup");
      out.push(...list);
      if (i === 0 && list.length) break;
      if (out.length >= 8) break;
    } catch (_) {}
  }
  // Fallback: sportsdb today
  if (!out.length) {
    try {
      const sports = await fetchJSON(`${SPORTSDB}/eventsday.php?d=${ymd()}&s=Soccer`);
      out.push(...parseSportsDbEvents(sports));
    } catch (_) {}
  }
  return sortMatches(dedupe(out));
}

export async function fetchInternationalBoard() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 60);
  const range = `${espnDay(start)}-${espnDay(end)}`;
  const chunks = [];

  try {
    const world = await fetchJSON(`${ESPN}/fifa.world/scoreboard?dates=${range}`);
    chunks.push(parseEspnEvents(world, "World Cup"));
  } catch (_) {}

  try {
    const next = await fetchJSON(`${SPORTSDB}/eventsnextleague.php?id=4429`);
    chunks.push(parseSportsDbEvents(next));
  } catch (_) {}

  try {
    const past = await fetchJSON(`${SPORTSDB}/eventspastleague.php?id=4429`);
    chunks.push(parseSportsDbEvents(past));
  } catch (_) {}

  const min = start.getTime();
  const max = end.getTime();
  return sortMatches(
    dedupe(chunks.flat()).filter((m) => m.kickoff >= min && m.kickoff <= max)
  );
}

export async function fetchKnockout() {
  const json = await loadJSONCascade({
    localUrl: LOCAL.knockout,
    remoteUrl: REMOTE_UPDATE.knockout,
    cacheKey: "knockout",
    enableRemote: PWA.enableRemoteUpdates,
  });
  if (json) {
    await kvSet("knockout", json);
    return json;
  }
  return { teams: [], stage: "", tournament: "World Cup" };
}

export function bracketUrl(lang) {
  return lang === "ar" ? BRACKET.ar : BRACKET.en;
}
