/**
 * Shell stays lightweight: no fetch hooks, no cosmetics, no DOM scrubbing.
 * Network blocking = service worker. Page cosmetics = player shields only.
 */
import { getFilterStats } from "./filter-engine.js";

/** No-op for app chrome — keeps Matches/Today/International/Settings responsive. */
export function installGlobalAdblock() {
  const stats = getFilterStats();
  try {
    document.documentElement.dataset.shaibAdblock = "sw-only";
    document.documentElement.dataset.shaibHosts = String(stats.hosts || 0);
  } catch (_) {}
  // Remove any leftover aggressive styles from older builds
  document.getElementById("shaib-global-cosmetic")?.remove();
  document.getElementById("shaib-adblock-cosmetic")?.remove();
}

/** Load third-party page into an iframe with adblock shielding when possible. */
export async function loadShieldedIframe(iframe, url) {
  if (!iframe || !url) return;
  const { createBlockedWebFrame } = await import("./adblock.js");
  try {
    const wrap = await createBlockedWebFrame(url);
    const shielded = wrap.querySelector("iframe");
    if (shielded?.srcdoc) {
      iframe.removeAttribute("src");
      iframe.srcdoc = shielded.srcdoc;
      return;
    }
  } catch (_) {}
  iframe.removeAttribute("sandbox");
  iframe.removeAttribute("referrerpolicy");
  iframe.src = url;
}
