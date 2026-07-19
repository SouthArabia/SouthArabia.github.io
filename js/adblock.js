import { AD_HOSTS, COSMETIC_SELECTORS } from "./adblock-data.js";
import {
  engineIsAdHost,
  engineIsAdUrl,
  getCosmeticList,
  getHostList,
  isMediaAllowed,
} from "./filter-engine.js";

const ALLOW_HOST_PARTS = [
  "syria-player",
  "shootsync",
  "albaplayer",
  "kora-sami",
  "splplayer",
  "kore10",
  "worldchampion",
  "alarabiya",
  "aljazeera",
  "thehlive",
  "akamai",
  "cloudfront",
  "cloudflare",
  "jsdelivr",
  "googleapis",
  "gstatic",
  "youtube",
  "ytimg",
  "jwplatform",
  "jwpcdn",
  "hlsjs",
  "videojs",
  "plyr",
  "shaib",
  "365scores",
  "espncdn",
  "thesportsdb",
  "clappr",
  "cdn.jsdelivr",
  "amazonaws",
  "streamhostingcdn",
  "sportspass",
  "kore10",
  "unpkg",
  "bootstrapcdn",
  "fontawesome",
  "jquery",
];

const EXTRA_COSMETIC_BASE = [
  ...COSMETIC_SELECTORS,
  "[class*='modal-ad']",
  "[class*='interstitial']",
  "[class*='overlay-ad']",
  "[id*='overlay'][class*='ad']",
  ".fc-consent-root",
  ".qc-cmp2-container",
  "#onetrust-banner-sdk",
  ".ot-sdk-container",
  "iframe[src*='doubleclick']",
  "iframe[src*='googlesyndication']",
  "iframe[src*='acscdn']",
  "iframe[src*='popads']",
  "iframe[src*='monetag']",
  "iframe[src*='pavanesbedizen']",
  "script[src*='monetag']",
  "script[src*='pavanesbedizen']",
  "a[href*='doubleclick']",
  "a[target='_blank'][href*='http'][rel*='sponsored']",
];

/** Live host set — starts as seed, replaced when filter lists finish loading */
let hostSet = new Set(AD_HOSTS.map((h) => h.toLowerCase()));
let cosmeticList = [...EXTRA_COSMETIC_BASE];

/** Cap for injecting into srcdoc — keep small so the player HTML still loads */
const SHIELD_HOST_CAP = 2_500;
const SHIELD_COSMETIC_CAP = 800;

/**
 * Sync EasyList / filter-engine cosmetics (+ host snapshot for srcdoc shields).
 */
export function syncAdblockFromEngine() {
  try {
    const cos = getCosmeticList();
    if (cos.length) {
      const merged = new Set([...EXTRA_COSMETIC_BASE, ...cos.slice(0, 2500)]);
      cosmeticList = [...merged];
    }
    const hosts = getHostList();
    if (hosts.length > hostSet.size) {
      // Keep seed + EasyList hosts available for injected tile shields
      hostSet = new Set(hosts.slice(0, SHIELD_HOST_CAP).map((h) => String(h).toLowerCase()));
    }
  } catch (_) {}
}

/** EasyList-backed CSS + network shield to inject into every tile player. */
export function playerAdblockInject(pageUrl = "") {
  syncAdblockFromEngine();
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).hostname;
  } catch (_) {}
  return `${cosmeticStyleTag()}\n${shieldScript(pageHost)}`;
}

export function hostnameOf(url) {
  try {
    return new URL(url, location.href).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isAllowedHost(host) {
  if (!host) return true;
  if (isMediaAllowed(host)) return true;
  return ALLOW_HOST_PARTS.some((p) => host.includes(p));
}

function hostInSet(host) {
  if (!host) return false;
  let h = host.toLowerCase();
  while (h) {
    if (hostSet.has(h)) return true;
    const i = h.indexOf(".");
    if (i === -1) break;
    h = h.slice(i + 1);
  }
  return false;
}

export function isAdHost(host) {
  if (!host || isAllowedHost(host)) return false;
  if (hostInSet(host)) return true;
  // Prefer engine (has exceptions + full list) when available
  if (engineIsAdHost(host)) return true;
  return /(^|\.)ads?\d*\.|doubleclick|adservice|adsystem|pagead|popads|propeller|exoclick|taboola|outbrain|criteo|prebid|adnxs|googlesyndication|popunder|clickunder|trafficjunky|juicyads|adsterra|mgid|revcontent/.test(
    host
  );
}

export function isAdUrl(url) {
  if (engineIsAdUrl(url)) return true;
  const host = hostnameOf(url);
  if (isAdHost(host)) return true;
  const u = String(url).toLowerCase();
  return (
    u.includes("googlesyndication") ||
    u.includes("doubleclick.net") ||
    u.includes("/pagead/") ||
    u.includes("adservice") ||
    u.includes("popunder") ||
    u.includes("clickunder") ||
    u.includes("adsbygoogle") ||
    u.includes("popads") ||
    u.includes("propellerads") ||
    u.includes("/ads/") ||
    u.includes("adserver")
  );
}

export function cosmeticStyleTag() {
  const sel = cosmeticList.join(",\n");
  return `<style id="shaib-adblock-cosmetic" type="text/css">
${sel}{display:none!important;height:0!important;max-height:0!important;width:0!important;max-width:0!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;position:absolute!important;left:-9999px!important}
html,body{overflow-x:hidden!important}
</style>`;
}

function shieldHostMap() {
  // Prefer EasyList / filter-engine hosts for every tile shield inject
  let list = [];
  try {
    list = getHostList();
  } catch (_) {}
  if (!list.length) list = [...hostSet];
  const sorted = list
    .map((h) => String(h).toLowerCase())
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  const map = Object.create(null);
  let n = 0;
  for (const h of sorted) {
    if (n >= SHIELD_HOST_CAP) break;
    map[h] = 1;
    n++;
  }
  return map;
}

/**
 * Continuous adblock shield for player pages:
 * network hooks, redirect/popup kill, cosmetic scrub on interval + MutationObserver.
 */
export function shieldScript(pageOriginHost = "") {
  const originHost = String(pageOriginHost || "").toLowerCase();
  const blockedMap = shieldHostMap();
  const cos = cosmeticList.slice(0, SHIELD_COSMETIC_CAP);
  return `<script id="shaib-adblock-shield">
(function(){
  if(window.__shaibShieldV3)return;window.__shaibShieldV3=true;
  var ORIGIN=${JSON.stringify(originHost)};
  var allow=${JSON.stringify(ALLOW_HOST_PARTS)};
  var blocked=${JSON.stringify(blockedMap)};
  var cosmeticSel=${JSON.stringify(cos.join(","))};

  function host(u){try{return new URL(u, location.href).hostname.toLowerCase()}catch(e){return ''}}
  function allowed(h){
    if(!h) return true;
    if(ORIGIN && (h===ORIGIN || h.endsWith('.'+ORIGIN))) return true;
    for(var i=0;i<allow.length;i++){if(h.indexOf(allow[i])!==-1) return true;}
    return false;
  }
  function isAd(h){
    if(!h||allowed(h)) return false;
    var cur=h;
    while(cur){
      if(blocked[cur]) return true;
      var i=cur.indexOf('.');
      if(i===-1) break;
      cur=cur.slice(i+1);
    }
    return /(^|\\.)ads?\\d*\\.|doubleclick|adservice|adsystem|pagead|popads|propeller|exoclick|taboola|outbrain|criteo|prebid|adnxs|googlesyndication|popunder|clickunder|trafficjunky|juicyads|adsterra|mgid|revcontent|adserver|banner/.test(h);
  }
  function bad(u){
    u=String(u||'');
    if(!u || u.charAt(0)==='#' || u.indexOf('javascript:')===0 || u.indexOf('blob:')===0 || u.indexOf('data:')===0) return false;
    return isAd(host(u)) || /guruvpnapp|fifa-wc-2026|googlesyndication|doubleclick\\.net|\\/pagead\\/|adsbygoogle|popunder|clickunder|popads|propellerads|exoclick|trafficjunky|\\/ads\\/|adserver|monetag|pavanesbedizen|acscdn|baillieumbered|histats|statcounter/i.test(u);
  }
  function sameSite(u){
    try{
      var h=host(u);
      if(!h) return true;
      if(ORIGIN && (h===ORIGIN || h.endsWith('.'+ORIGIN))) return true;
      if(h===location.hostname || h.endsWith('.'+location.hostname)) return true;
      return allowed(h);
    }catch(e){return false}
  }

  function blockOpen(){return null;}
  try{
    window.open=blockOpen;
    window.showModalDialog=blockOpen;
    Object.defineProperty(window,'open',{configurable:true,writable:true,value:blockOpen});
  }catch(e){}
  setInterval(function(){ try{ if(window.open!==blockOpen) window.open=blockOpen; }catch(e){} },500);

  try{
    var _assign=location.assign.bind(location);
    var _replace=location.replace.bind(location);
    location.assign=function(u){ if(bad(u)||!sameSite(u)) return; return _assign(u); };
    location.replace=function(u){ if(bad(u)||!sameSite(u)) return; return _replace(u); };
    var hrefDesc=Object.getOwnPropertyDescriptor(Location.prototype,'href')||Object.getOwnPropertyDescriptor(location,'href');
    if(hrefDesc && hrefDesc.set){
      Object.defineProperty(location,'href',{
        configurable:true,
        get:function(){return hrefDesc.get.call(location)},
        set:function(u){ if(bad(u)||!sameSite(u)) return; hrefDesc.set.call(location,u); }
      });
    }
  }catch(e){}

  try{
    var _xOpen=XMLHttpRequest.prototype.open;
    var _xSend=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(m,u){
      if(bad(u)){this.__shaibBlocked=true; u='about:blank';}
      return _xOpen.apply(this,arguments);
    };
    XMLHttpRequest.prototype.send=function(){
      if(this.__shaibBlocked){try{this.abort()}catch(e){} return;}
      return _xSend.apply(this,arguments);
    };
  }catch(e){}

  try{
    var _fetch=window.fetch;
    window.fetch=function(input,init){
      var u=typeof input==='string'?input:(input&&input.url)||'';
      if(bad(u)) return Promise.reject(new TypeError('shaib-blocked'));
      return _fetch.apply(this,arguments);
    };
  }catch(e){}

  try{
    if(window.Navigator && Navigator.prototype.sendBeacon){
      var _beacon=Navigator.prototype.sendBeacon;
      Navigator.prototype.sendBeacon=function(u,d){ if(bad(u)) return false; return _beacon.apply(this,arguments); };
    }
  }catch(e){}

  function neutralize(el){
    if(!el||el.nodeType!==1) return;
    try{
      var tag=el.tagName;
      if(tag==='SCRIPT' && el.src && bad(el.src)){ el.remove(); return; }
      if(tag==='IFRAME' || tag==='EMBED' || tag==='OBJECT'){
        var src=el.src||el.getAttribute('data-src')||'';
        if(src && bad(src)){ el.remove(); return; }
      }
      if(tag==='IMG' || tag==='IMAGE'){
        var isrc=el.src||el.getAttribute('data-src')||'';
        if(isrc && bad(isrc) && /ad|banner|pixel|track/i.test(isrc)){ el.remove(); return; }
      }
      if(tag==='A'){
        var href=el.getAttribute('href')||'';
        if(bad(href)){ el.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();},true); el.removeAttribute('href'); }
        if(el.target==='_blank'){ el.setAttribute('target','_self'); el.setAttribute('rel','noopener'); }
      }
      if(tag==='META'){
        var http=(el.getAttribute('http-equiv')||'').toLowerCase();
        if(http==='refresh'){ el.remove(); return; }
      }
    }catch(e){}
  }

  try{
    var _append=Element.prototype.appendChild;
    Element.prototype.appendChild=function(n){ neutralize(n); if(n&&n.parentNode===null&&n.tagName==='SCRIPT'&&n.src&&bad(n.src)) return n; return _append.apply(this,arguments); };
    var _insert=Element.prototype.insertBefore;
    Element.prototype.insertBefore=function(n,r){ neutralize(n); return _insert.apply(this,arguments); };
  }catch(e){}

  function hideEl(el){
    try{
      el.style.setProperty('display','none','important');
      el.style.setProperty('visibility','hidden','important');
      el.style.setProperty('pointer-events','none','important');
      el.style.setProperty('opacity','0','important');
      el.style.setProperty('height','0','important');
      el.setAttribute('data-shaib-blocked','1');
    }catch(e){}
  }

  function looksLikeSkip(el){
    try{
      var t=((el.innerText||el.textContent||el.getAttribute('aria-label')||'')+'').toLowerCase().replace(/\\s+/g,' ').trim();
      if(!t||t.length>48) return false;
      return t==='skip'||t.indexOf('skip ad')!==-1||t.indexOf('تخطي')!==-1||t.indexOf('تجاوز')!==-1||t.indexOf('close ad')!==-1;
    }catch(e){return false}
  }

  function clickSkip(){
    try{
      var nodes=document.querySelectorAll('button,[role="button"],a,div,span');
      for(var i=0;i<Math.min(nodes.length,250);i++){
        if(looksLikeSkip(nodes[i])){try{nodes[i].click()}catch(e){} break;}
      }
    }catch(e){}
  }

  function scrub(){
    try{ document.querySelectorAll(cosmeticSel).forEach(hideEl); }catch(e){}
    try{
      document.querySelectorAll('iframe,embed,object,script[src]').forEach(function(el){
        var src=el.src||el.getAttribute('data-src')||'';
        if(src && bad(src)) hideEl(el);
      });
    }catch(e){}
    try{
      document.querySelectorAll('a[href]').forEach(function(a){
        var href=a.getAttribute('href')||'';
        if(bad(href)){ hideEl(a); return; }
        if(a.target==='_blank' && !sameSite(href)){
          a.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();},true);
        }
      });
    }catch(e){}
    try{
      document.querySelectorAll('meta[http-equiv="refresh"],meta[http-equiv="Refresh"]').forEach(function(m){m.remove()});
    }catch(e){}
    try{
      document.querySelectorAll('div,section,aside').forEach(function(el){
        if(el.getAttribute('data-shaib-blocked')) return;
        var st=getComputedStyle(el);
        if(st.position!=='fixed' && st.position!=='sticky') return;
        var z=parseInt(st.zIndex,10)||0;
        if(z<1000) return;
        var idc=((el.id||'')+' '+(el.className||'')).toLowerCase();
        if(/player|video|jw|clappr|vjs|plyr|albaplayer|kbp|ysp|stream-player/.test(idc)) return;
        if(/ad|popup|modal|overlay|banner|consent|cookie|newsletter|promo/.test(idc)) hideEl(el);
        var r=el.getBoundingClientRect();
        if(r.width>window.innerWidth*0.85 && r.height>window.innerHeight*0.85){
          if(/ad|pop|overlay|banner|modal|promo|subscribe/.test(idc) || el.querySelector('iframe[src*="ad"],iframe[src*="doubleclick"]')) hideEl(el);
        }
      });
    }catch(e){}
    clickSkip();
  }

  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest&&e.target.closest('a,area');
    if(!a) return;
    var href=a.getAttribute('href')||'';
    if(bad(href) || (a.target==='_blank' && !sameSite(href))){
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    }
  },true);

  document.addEventListener('auxclick',function(e){
    if(e.button===1){ e.preventDefault(); e.stopPropagation(); }
  },true);

  window.addEventListener('beforeunload',function(e){ e.stopImmediatePropagation(); },true);

  scrub();
  document.addEventListener('DOMContentLoaded',scrub,{once:true});
  setInterval(scrub,700);
  try{
    var sched=false;
    new MutationObserver(function(){
      if(sched) return; sched=true;
      setTimeout(function(){sched=false;scrub();},250);
    }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','href']});
  }catch(e){}

  try{ window.parent.postMessage({type:'shaibAdblock',status:'active'},'*'); }catch(e){}
})();
</script>`;
}

export function cleanHtml(html, pageUrl) {
  let out = String(html);
  let pageHost = "";
  try {
    pageHost = new URL(pageUrl).hostname;
  } catch (_) {}

  out = out.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (full, src) =>
    isAdUrl(src) ? "<!-- shaib: ad script removed -->" : full
  );
  out = out.replace(/<iframe\b[^>]*src=["']([^"']+)["'][^>]*>([\s\S]*?)<\/iframe>/gi, (full, src) =>
    isAdUrl(src) ? "<!-- shaib: ad iframe removed -->" : full
  );
  out = out.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "<!-- shaib: refresh removed -->");
  out = out.replace(/\sonload\s*=\s*["'][^"']*["']/gi, "");
  out = out.replace(/\sonerror\s*=\s*["'][^"']*window\.open[^"']*["']/gi, "");
  out = out.replace(/target\s*=\s*["']_blank["']/gi, 'target="_self"');

  const base = `<base href="${String(pageUrl).replace(/"/g, "&quot;")}">`;
  const inject = `${base}\n${cosmeticStyleTag()}\n${shieldScript(pageHost)}`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`);
  } else {
    out = `<!DOCTYPE html><html><head>${inject}</head><body>${out}</body></html>`;
  }
  return out;
}

async function fetchViaProxies(url) {
  const tries = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url,
  ];
  for (const u of tries) {
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 40) return text;
    } catch (_) {}
  }
  return null;
}

/**
 * Always-on shielded web frame (prefer srcdoc + continuous scrub).
 * Direct iframe only as last resort, with max sandbox (no popups / no top nav).
 */
export async function createBlockedWebFrame(url, onStatus) {
  syncAdblockFromEngine();
  onStatus?.("blocking");
  const wrap = document.createElement("div");
  wrap.className = "adblock-frame-wrap";
  wrap.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;background:#000";

  const bar = document.createElement("div");
  bar.className = "player-status";
  bar.textContent = "AdBlock scanning…";
  wrap.appendChild(bar);

  const stage = document.createElement("div");
  stage.className = "player-stage";
  wrap.appendChild(stage);

  const html = await fetchViaProxies(url);
  const frame = document.createElement("iframe");
  frame.className = "player-iframe";
  frame.setAttribute(
    "allow",
    "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  );
  frame.setAttribute("allowfullscreen", "");
  // Do not set no-referrer / sandbox — stream players refuse both

  if (html && /<html|<body|<div|<script/i.test(html)) {
    frame.srcdoc = cleanHtml(html, url);
    stage.appendChild(frame);
    bar.textContent = "AdBlock active · continuous scan";
    onStatus?.("ready");
    return wrap;
  }

  frame.src = url;
  stage.appendChild(frame);
  bar.textContent = "AdBlock on";
  onStatus?.("fallback");
  return wrap;
}

export function attachHlsAdblock(hls) {
  if (!hls) return;
  hls.config.xhrSetup = function (xhr, reqUrl) {
    if (!isAdUrl(reqUrl)) return;
    xhr.send = function () {};
    xhr.abort = function () {};
  };
}
