/* Classic script — usable from page + importScripts in SW */
(function (root) {
  // Only clear crawler tokens — avoid matching real browsers / tooling UAs.
  var BOT_UA_RE =
    /\b(googlebot|bingbot|baiduspider|yandex(bot)?|duckduckbot|slurp|facebot|facebookexternalhit|twitterbot|linkedinbot|pinterestbot|applebot|semrushbot|ahrefsbot|dotbot|mj12bot|petalbot|bytespider|gptbot|chatgpt-user|ccbot|anthropic|claudebot|amazonbot|perplexitybot|cohere-ai|ia_archiver|archive\.org_bot|adsbot-google|mediapartners-google|bingpreview|sogou)\b/i;

  function isBotUserAgent(ua) {
    var s = String(ua || "");
    if (!s) return false; // allow empty — do not lock out real users
    return BOT_UA_RE.test(s);
  }

  root.SHAIB_IS_BOT = isBotUserAgent;
  if (typeof self !== "undefined") self.SHAIB_IS_BOT = isBotUserAgent;
})(typeof globalThis !== "undefined" ? globalThis : this);
