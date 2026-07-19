/** IPTV.org playlist loader + M3U parser for the IPTV tab */

export const IPTV_PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";

const GROUP_PRIORITY = [
  "Sports",
  "News",
  "Entertainment",
  "Movies",
  "Music",
  "Kids",
  "Documentary",
  "General",
];

function attr(line, key) {
  const re = new RegExp(`${key}="([^"]*)"`, "i");
  const m = line.match(re);
  return m ? m[1] : "";
}

/** @returns {{ name: string, url: string, logo: string, group: string, id: string }[]} */
export function parseM3U(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const name = line.includes(",") ? line.slice(line.lastIndexOf(",") + 1).trim() : "Channel";
      pending = {
        name,
        logo: attr(line, "tvg-logo"),
        group: (attr(line, "group-title") || "Other").split(";")[0].trim() || "Other",
        id: attr(line, "tvg-id") || "",
      };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (pending && /^https?:\/\//i.test(line)) {
      out.push({
        ...pending,
        url: line,
        id: pending.id || `${pending.group}-${out.length}`,
      });
      pending = null;
    }
  }
  return out;
}

export async function fetchIptvPlaylist(url = IPTV_PLAYLIST_URL) {
  const tries = [
    url,
    `https://proxy.cors.sh/${url}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  let lastErr;
  for (const u of tries) {
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text && text.includes("#EXT")) return parseM3U(text);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("IPTV fetch failed");
}

export function groupChannels(channels) {
  const map = new Map();
  for (const ch of channels) {
    const g = ch.group || "Other";
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(ch);
  }
  const groups = [...map.entries()].map(([name, list]) => ({
    name,
    count: list.length,
    channels: list,
  }));
  groups.sort((a, b) => {
    const ia = GROUP_PRIORITY.indexOf(a.name);
    const ib = GROUP_PRIORITY.indexOf(b.name);
    const ra = ia === -1 ? 99 : ia;
    const rb = ib === -1 ? 99 : ib;
    if (ra !== rb) return ra - rb;
    return b.count - a.count;
  });
  return groups;
}
