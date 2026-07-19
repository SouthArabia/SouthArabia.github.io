/**
 * Adblock filter catalog for Shaib Sport PWA.
 * Bundled app lists load first; then the full third-party set below.
 */
import { LOCAL, REMOTE_UPDATE } from "./pwa-config.js";

export const FILTER_LISTS = [
  // Bundled with this PWA (local first)
  {
    id: "adblocker-json",
    urls: [LOCAL.adblocker, REMOTE_UPDATE.adblocker],
    type: "json-domains",
  },
  {
    id: "element-block",
    urls: [LOCAL.elementBlock, REMOTE_UPDATE.elementBlock],
    type: "json-elements",
  },
  {
    id: "blocklist-json",
    urls: [LOCAL.blocklist, REMOTE_UPDATE.blocklist],
    type: "json-wkrules",
  },
  {
    id: "channel-blocklist",
    urls: [LOCAL.channelBlocklist, REMOTE_UPDATE.channelBlocklist],
    type: "json-domains",
  },

  // EasyList first — applied to every tile player shield
  {
    id: "easylist",
    urls: [
      "https://easylist.to/easylist/easylist.txt",
      "https://easylist-downloads.adblockplus.org/easylist.txt",
    ],
    type: "abp",
    priority: true,
  },
  {
    id: "easyprivacy",
    urls: [
      "https://easylist.to/easylist/easyprivacy.txt",
      "https://easylist-downloads.adblockplus.org/easyprivacy.txt",
    ],
    type: "abp",
    priority: true,
  },
  {
    id: "easylist-cookie",
    urls: [
      "https://easylist-downloads.adblockplus.org/easylist-cookie.txt",
      "https://easylist-downloads.adblockplus.org/easylistcookie.txt",
    ],
    type: "abp",
  },
  {
    id: "easylist-annoyances",
    url: "https://easylist-downloads.adblockplus.org/easylist-annoyances.txt",
    type: "abp",
  },
  {
    id: "fanboy-annoyance",
    url: "https://easylist.to/easylist/fanboy-annoyance.txt",
    type: "abp",
  },
  {
    id: "fanboy-social",
    url: "https://easylist.to/easylist/fanboy-social.txt",
    type: "abp",
  },
  {
    id: "peter-lowe",
    url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&mimetype=plaintext",
    type: "abp",
  },
  {
    id: "adguard-base",
    url: "https://filters.adtidy.org/extension/ublock/filters/2.txt",
    type: "abp",
  },
  {
    id: "adguard-tracking",
    url: "https://filters.adtidy.org/extension/ublock/filters/3.txt",
    type: "abp",
  },
  {
    id: "adguard-url-tracking",
    url: "https://filters.adtidy.org/extension/ublock/filters/17.txt",
    type: "abp",
  },
  {
    id: "adguard-annoyances",
    url: "https://filters.adtidy.org/extension/ublock/filters/14.txt",
    type: "abp",
  },
  {
    id: "adguard-social",
    url: "https://filters.adtidy.org/extension/ublock/filters/4.txt",
    type: "abp",
  },
  { id: "oisd-full", url: "https://big.oisd.nl", type: "abp" },
  {
    id: "hagezi-pro",
    url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt",
    type: "abp",
  },
  {
    id: "hagezi-ultimate",
    url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/ultimate.txt",
    type: "abp",
  },
  {
    id: "1hosts-pro",
    url: "https://raw.githubusercontent.com/badmojr/1Hosts/master/Pro/adblock.txt",
    type: "abp",
  },
  {
    id: "stevenblack-hosts",
    url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews-gambling-porn/hosts",
    type: "hosts",
  },
  {
    id: "goodbye-ads",
    url: "https://raw.githubusercontent.com/jerryn70/GoodbyeAds/master/Extension/GoodbyeAds-Extension.txt",
    type: "abp",
  },
  {
    id: "ublock-badware",
    url: "https://ublockorigin.github.io/uAssets/filters/badware.txt",
    type: "abp",
  },
  {
    id: "ublock-privacy",
    url: "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
    type: "abp",
  },
  {
    id: "ublock-unbreak",
    url: "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
    type: "abp",
  },
  {
    id: "ublock-quick-fixes",
    url: "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
    type: "abp",
  },
];

/** Media / player CDN allowlist (do not block stream hosts) */
export const MEDIA_ALLOWLIST = [
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "googlevideo.com",
  "ytimg.com",
  "ggpht.com",
  "gstatic.com",
  "googleapis.com",
  "syria-player.live",
  "syria-player",
  "shootsync",
  "albaplayer",
  "kora-sami.com",
  "splplayer",
  "kore10.blog",
  "worldchampion.fun",
  "streamhostingcdn.top",
  "sportspass.site",
  "majed-koora.com",
  "jwplayer.com",
  "jwplatform.com",
  "cloudflare.com",
  "cloudfront.net",
  "akamaihd.net",
  "fastly.net",
  "jsdelivr.net",
  "jsdelivr.xyz",
  "clappr",
  "amazonaws.com",
  "s3.amazonaws.com",
  "365scores.com",
  "dmcdn.net",
  "dmxleo.com",
  "alarabiya",
  "aljazeera",
  "thehlive",
  "clappr",
  "hlsjs",
  "videojs",
  "plyr",
  "espn.com",
  "espncdn.com",
  "thesportsdb.com",
  "githubusercontent.com",
];
