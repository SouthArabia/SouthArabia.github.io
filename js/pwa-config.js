/**
 * Shaib Sport PWA — standalone app config.
 * Everything resolves under this folder; remote URLs are optional updates only.
 */
const BASE = new URL("../", import.meta.url);

export const PWA = {
  name: "Shaib Sport",
  version: "1.0.0",
  /** When true, refresh bundled config/filters from the network after local load */
  enableRemoteUpdates: true,
};

/** Bundled JSON shipped with the PWA (works offline / without any other app). */
export const LOCAL = {
  liveConfig: new URL("../config/live_config.json", import.meta.url).href,
  knockout: new URL("../config/Knockout.json", import.meta.url).href,
  adblocker: new URL("../filters/Adblocker.json", import.meta.url).href,
  elementBlock: new URL("../filters/elementBlock.json", import.meta.url).href,
  blocklist: new URL("../filters/blocklist.json", import.meta.url).href,
  channelBlocklist: new URL("../filters/channel_blocklist.json", import.meta.url).href,
};

/**
 * Optional content update endpoints (same public JSON the PWA can refresh from).
 * Not required to run the app — bundled files always win for first paint.
 */
export const REMOTE_UPDATE = {
  liveConfig:
    "https://raw.githubusercontent.com/TrueIntelligence/shaibsport-config/main/live_config.json",
  knockout:
    "https://raw.githubusercontent.com/TrueIntelligence/shaibsport-config/main/Knockout.json",
  adblocker:
    "https://raw.githubusercontent.com/TrueIntelligence/shaibsport-config/main/Adblocker.json",
  elementBlock:
    "https://raw.githubusercontent.com/TrueIntelligence/shaibsport-config/main/elementBlock.json",
  blocklist:
    "https://raw.githubusercontent.com/TrueIntelligence/shaibsport-config/main/blocklist.json",
  channelBlocklist:
    "https://raw.githubusercontent.com/TrueIntelligence/shaibsport-config/main/channel_blocklist.json",
};

export const BRACKET = {
  ar: "https://www.365scores.com/ar/football/league/5930/brackets",
  en: "https://www.365scores.com/en/football/league/5930/brackets",
};

export function assetUrl(rel) {
  return new URL(rel, BASE).href;
}
