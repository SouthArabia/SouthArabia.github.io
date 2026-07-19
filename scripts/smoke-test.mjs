/**
 * Smoke test: splash gone, login works, tabs clickable.
 * Run: node scripts/smoke-test.mjs [baseUrl]
 */
import http from "node:http";
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8765";

async function waitServer(url, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          res.statusCode && res.statusCode < 500 ? resolve() : reject();
        });
        req.on("error", reject);
        req.setTimeout(1500, () => {
          req.destroy();
          reject();
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("server not up: " + url);
}

async function main() {
  await waitServer(BASE + "/");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(800);

  const splashVisible = await page.evaluate(() => {
    const s = document.getElementById("splash");
    if (!s) return false;
    const st = getComputedStyle(s);
    return st.display !== "none" && st.visibility !== "hidden" && st.pointerEvents !== "none";
  });
  if (splashVisible) throw new Error("FAIL: splash still visible/blocking");

  const loginVisible = await page.evaluate(() => {
    const g = document.getElementById("login-gate");
    return g && !g.hidden && getComputedStyle(g).display !== "none";
  });
  if (!loginVisible) throw new Error("FAIL: login gate not visible");

  await page.fill("#login-user", "saber");
  await page.fill("#login-pass", "7777");
  await page.click("#login-submit");
  await page.waitForTimeout(600);

  const appVisible = await page.evaluate(() => {
    const shell = document.getElementById("app-shell");
    const gate = document.getElementById("login-gate");
    return (
      shell &&
      !shell.hidden &&
      getComputedStyle(shell).display !== "none" &&
      gate &&
      (gate.hidden || getComputedStyle(gate).display === "none")
    );
  });
  if (!appVisible) throw new Error("FAIL: app shell not shown after login");

  // Click each tab
  for (const tab of ["today", "international", "settings", "matches"]) {
    await page.click(`button[data-tab="${tab}"]`);
    await page.waitForTimeout(250);
    const active = await page.evaluate((t) => {
      const btn = document.querySelector(`button[data-tab="${t}"]`);
      const pageEl = document.querySelector(`main.page[data-page="${t}"]`);
      return {
        btnActive: btn?.classList.contains("active"),
        pageShown: pageEl && !pageEl.hidden,
      };
    }, tab);
    if (!active.btnActive || !active.pageShown) {
      throw new Error(`FAIL: tab ${tab} not switchable ${JSON.stringify(active)}`);
    }
  }

  // Ensure nothing covering tabbar
  const blocked = await page.evaluate(() => {
    const tab = document.querySelector(".tabbar button");
    if (!tab) return "no-tab";
    const r = tab.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!el) return "no-el";
    if (tab === el || tab.contains(el) || el.closest?.(".tabbar")) return null;
    return el.tagName + "#" + (el.id || "") + "." + (el.className || "");
  });
  if (blocked) throw new Error("FAIL: tabbar covered by " + blocked);

  if (errors.length) {
    console.warn("page errors:", errors.slice(0, 5));
  }

  console.log("PASS: splash hidden, login works, all tabs clickable");
  await browser.close();
}

main().catch(async (e) => {
  console.error(e.message || e);
  process.exit(1);
});
