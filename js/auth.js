/** PWA-only session gate (client-side). Not shared with any native app. */
const AUTH_KEY = "shaib_pwa_auth_v1";
const USER = "saber";
const PASS = "7777";

function readFlag() {
  try {
    if (sessionStorage.getItem(AUTH_KEY) === "1") return true;
  } catch (_) {}
  try {
    if (localStorage.getItem(AUTH_KEY) === "1") return true;
  } catch (_) {}
  return false;
}

function writeFlag() {
  try {
    sessionStorage.setItem(AUTH_KEY, "1");
  } catch (_) {}
  try {
    localStorage.setItem(AUTH_KEY, "1");
  } catch (_) {}
}

function clearFlag() {
  try {
    sessionStorage.removeItem(AUTH_KEY);
  } catch (_) {}
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch (_) {}
}

export function isLoggedIn() {
  return readFlag();
}

export function login(username, password) {
  const u = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const p = String(password || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (u === USER && p === PASS) {
    writeFlag();
    return true;
  }
  return false;
}

export function logout() {
  clearFlag();
}
