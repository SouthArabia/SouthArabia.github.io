/* Service-worker helper: fetch stream player HTML, unwrap document.write, strip ads */
(function (global) {
  const PLAYER_HOST_OK =
    /syria-player|shootsync|albaplayer|beinmax|thehlive|kora-sami|splplayer|kore10|worldchampion/i;

  const AD_SRC_RE =
    /acscdn\.com|aclib\.js|baillieumbered|doubleclick|googlesyndication|pagead|popads|propeller|exoclick|trafficjunky|juicyads|adsterra|mgid|revcontent|adservice|adsystem|popunder|clickunder|ad-delivery|adserver|\/ads\/|adsbygoogle|histats|statcounter|yandex\.ru\/ads|mc\.yandex|monetag|pavanesbedizen|clickadu|popcash|ad-maven|adnxs|rubiconproject|pubmatic|openx|taboola|outbrain|llvpn|guruvpnapp/i;

  function unwrapDocumentWrite(html) {
    const m = String(html || "").match(
      /document\.write\(["']((?:\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\[^"']|[^"'])*)["']\)/i
    );
    if (!m) return String(html || "");
    return m[1]
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");
  }

  function isPlayerAssetUrl(u) {
    return /syria-player|shootsync|albaplayer|beinmax|kora-sami|splplayer|kore10|worldchampion|jwplayer|jwplatform|jwpcdn|cloudflare|cloudfront|akamai|fastly|hlsjs|videojs|plyr|clappr|jsdelivr|amazonaws|googleapis|gstatic/i.test(
      String(u || "")
    );
  }

  /** Channel pages with ?serv= use Clappr from jsdelivr.xyz (often blocked) — use official .net */
  function rewritePlayerCdns(html) {
    return String(html || "")
      .replace(/cdn\.jsdelivr\.xyz/gi, "cdn.jsdelivr.net")
      .replace(/\/\/cdn\.jsdelivr\.net/gi, "https://cdn.jsdelivr.net");
  }

  function stripAds(html) {
    let out = rewritePlayerCdns(html);
    const isAdReq =
      typeof global.SHAIB_IS_AD_REQUEST === "function"
        ? global.SHAIB_IS_AD_REQUEST
        : (u) => AD_SRC_RE.test(String(u || ""));

    // Remove ad scripts / iframes — never strip the stream player itself
    out = out.replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (full, src) => {
      if (isPlayerAssetUrl(src)) return full;
      return AD_SRC_RE.test(full) || isAdReq(src) ? "<!-- shaib: ad script removed -->" : full;
    });
    out = out.replace(/<iframe\b[^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi, (full, src) => {
      if (isPlayerAssetUrl(src)) return full;
      return AD_SRC_RE.test(full) || isAdReq(src) ? "<!-- shaib: ad iframe removed -->" : full;
    });
    out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (full) => {
      if (/function\s+_kill|SB_Blocked|تنبيه حماية/i.test(full)) {
        return "<!-- shaib: embed guard removed -->";
      }
      // Keep Clappr / player bootstraps even if they mention ad keywords in strings
      if (/Clappr\.Player|new\s+Clappr|jwplayer\s*\(|videojs\s*\(/i.test(full)) {
        return full;
      }
      if (
        AD_SRC_RE.test(full) ||
        /adsbygoogle|aclib\s*\.|aclib\.run|runPop|runBanner|push\(.*ads/i.test(full)
      ) {
        return "<!-- shaib: ad inline removed -->";
      }
      return full;
    });
    out = out.replace(/aclib\.run(?:Pop|Banner)\([\s\S]*?\);?/gi, "/* shaib: aclib removed */");
    return out;
  }

  /** Light EasyList runtime — never touch player/stream CDNs. */
  function easyListRuntimeShield() {
    return `<script id="shaib-easylist-runtime">
(function(){
  if(window.__shaibEasyListRuntime)return;window.__shaibEasyListRuntime=true;
  var allow=/syria-player|shootsync|albaplayer|beinmax|kora-sami|splplayer|kore10|worldchampion|jwplayer|jwplatform|jwpcdn|cloudflare|cloudfront|akamai|fastly|googleapis|gstatic|hlsjs|videojs|plyr|clappr|jsdelivr|amazonaws|s3\\.|m3u8/i;
  var adRe=/acscdn|aclib|baillieumbered|doubleclick|googlesyndication|pagead|popads|propeller|exoclick|trafficjunky|juicyads|adsterra|adservice|adsystem|\\/pagead\\/|adsbygoogle|popunder|clickunder|monetag|pavanesbedizen|clickadu|popcash|ad-maven|adnxs|llvpn|guruvpnapp/i;
  function bad(u){
    u=String(u||'');
    if(!u||u.indexOf('blob:')===0||u.indexOf('data:')===0) return false;
    if(allow.test(u)) return false;
    return adRe.test(u);
  }
  try{window.open=function(){return null;};}catch(e){}
  try{
    var _x=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u){ if(bad(u)){this.__b=1;u='about:blank';} return _x.apply(this,arguments); };
  }catch(e){}
  try{
    var _f=window.fetch;
    window.fetch=function(input,init){ var u=typeof input==='string'?input:(input&&input.url)||''; if(bad(u)) return Promise.reject(new TypeError('blocked')); return _f.apply(this,arguments); };
  }catch(e){}
  // Ad tags often build <script src="..."> at runtime (createElement + appendChild)
  // rather than via fetch/XHR — guard the src setter so it never loads.
  try{
    var _srcDesc=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src')||Object.getOwnPropertyDescriptor(Element.prototype,'src');
    if(_srcDesc&&_srcDesc.set){
      Object.defineProperty(HTMLScriptElement.prototype,'src',{
        configurable:true,
        get:function(){return _srcDesc.get.call(this);},
        set:function(v){ if(bad(v)){ try{this.remove();}catch(e){} return; } return _srcDesc.set.call(this,v); }
      });
    }
  }catch(e){}
  function scrub(){
    try{
      document.querySelectorAll('script[src],iframe[src]').forEach(function(el){
        var v=el.src||''; if(bad(v)) el.remove();
      });
    }catch(e){}
  }
  scrub(); setInterval(scrub,1000);
})();
</script>`;
  }

  function injectShield(html, pageUrl) {
    const base = `<base href="${String(pageUrl).replace(/"/g, "&quot;")}">`;
    const shield = `<style id="shaib-player-cosmetic">
iframe[src*="doubleclick"],iframe[src*="googlesyndication"],iframe[src*="acscdn"],
iframe[src*="popads"],iframe[id*="google_ads"],iframe[class*="adsbox"],
[class*="adsbox"],[id*="adsbox"],[class*="ad-container"],[id*="ad-container"],
[class*="OverlayAd"],a[href*="doubleclick"],
#aclib-wrapper,.aclib-widget,[class*="aclib"],
/* AlbaPlayer / syria-live chrome */
.aplr-link,a.aplr-link,.aplr-exbtns,
.aplr-action.showrefresh,.aplr-action.showshare,
.aplr-icon-refresh,.aplr-icon-share,
a[href*="?serv="],a[href*="&serv="],
a[href*="javascript:window.location.reload"],
a[href*="location.reload"],
/* kora-sami subscribe / share chrome */
.slp-subscribe-popup,.slp-subscribe-icon,.slp-subscribe-button,
.slp-share-item,.slp-embed-modal,.slp-embed-overlay,
/* monetag / click-gate overlays */
[id*="monetag"],[class*="monetag"],[id*="popmag"],[class*="popunder"],
#ts_ad_responsive,[id*="ts_ad"],a[target="_blank"][style*="z-index"],
iframe[src*="monetag"],iframe[src*="clickadu"],iframe[src*="popcash"]{
  display:none!important;visibility:hidden!important;pointer-events:none!important;
  height:0!important;width:0!important;max-height:0!important;overflow:hidden!important;
  opacity:0!important;margin:0!important;padding:0!important;border:0!important
}
</style>
<script id="shaib-player-shield">
(function(){
  if(window.__shaibPlayerShield)return;window.__shaibPlayerShield=true;
  var PLAYER_OK=/kora-sami|kore10|syria-player|shootsync|albaplayer|jsdelivr|amazonaws|cloudfront|clappr|jwplayer|gstatic|googleapis|m3u8|blob:|data:/i;
  var AD_HREF=/guruvpnapp|guru\\s*vpn|llvpn|fifa-wc-2026|acscdn|baillieumbered|doubleclick|popunder|clickunder|exoclick|propeller|monetag|pavanesbedizen|clickadu|popcash|ad-maven|juicyads|trafficjunky|adnxs|taboola|outbrain|sub_id=/i;
  function badUrl(u){
    u=String(u||'');
    if(!u||u.charAt(0)==='#'||u.indexOf('javascript:')===0||u.indexOf('blob:')===0||u.indexOf('data:')===0) return false;
    if(PLAYER_OK.test(u)) return false;
    return AD_HREF.test(u);
  }
  function allowNav(u){
    u=String(u||'');
    if(!u||u.charAt(0)==='#'||u.indexOf('javascript:')===0) return true;
    try{
      var abs=new URL(u,location.href);
      if(abs.protocol!=='http:'&&abs.protocol!=='https:'&&abs.protocol!=='blob:') return false;
      if(abs.hostname===location.hostname) return true;
      if(PLAYER_OK.test(abs.href)||PLAYER_OK.test(abs.hostname)) return true;
      return false;
    }catch(e){return false;}
  }
  function blockOpen(){return null;}
  function lockOpen(){
    try{window.open=blockOpen;}catch(e){}
    try{Object.defineProperty(window,'open',{configurable:true,writable:true,value:blockOpen});}catch(e){}
    try{window.showModalDialog=blockOpen;}catch(e){}
    try{if(window.top&&window.top!==window){try{window.top.open=blockOpen;}catch(e2){}}}catch(e){}
  }
  lockOpen();
  setInterval(lockOpen,200);
  // Stop iframe navigations / iOS gesture popups that bypass window.open
  try{
    var _assign=location.assign.bind(location);
    var _replace=location.replace.bind(location);
    location.assign=function(u){ if(badUrl(u)||!allowNav(u)) return; return _assign(u); };
    location.replace=function(u){ if(badUrl(u)||!allowNav(u)) return; return _replace(u); };
    var hrefDesc=Object.getOwnPropertyDescriptor(Location.prototype,'href')||Object.getOwnPropertyDescriptor(location,'href');
    if(hrefDesc&&hrefDesc.set){
      Object.defineProperty(location,'href',{
        configurable:true,
        get:function(){return hrefDesc.get.call(location);},
        set:function(u){ if(badUrl(u)||!allowNav(u)) return; hrefDesc.set.call(location,u); }
      });
    }
  }catch(e){}
  try{
    var _aClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){
      var href=this.getAttribute('href')||this.href||'';
      var t=(this.getAttribute('target')||'').toLowerCase();
      if(t==='_blank'||t==='_top'||t==='_parent'||badUrl(href)||!allowNav(href)) return;
      return _aClick.apply(this,arguments);
    };
  }catch(e){}
  function killNav(ev,a){
    if(!a)return false;
    var t=(a.getAttribute('target')||'').toLowerCase();
    var href=a.getAttribute('href')||a.href||'';
    var oc=a.getAttribute('onclick')||'';
    if(t==='_blank'||t==='_top'||t==='_parent'||badUrl(href)||!allowNav(href)||AD_HREF.test(href)||/window\\.open|target\\s*=\\s*['\\"]_blank/i.test(oc)){
      ev.preventDefault();ev.stopPropagation();
      try{ev.stopImmediatePropagation();}catch(e){}
      return true;
    }
    return false;
  }
  function isPlayControl(el){
    if(!el||!el.closest)return false;
    return !!el.closest(
      'video,audio,.play-button,.play-wrapper,.vjs-big-play-button,.jw-icon-playback,.jw-display-icon-container,.jw-display,.media-control-button[data-playpause],.plyr__control--overlaid,[data-player],#player,.aplr-player-content,.clappr-player,.poster,.player-poster'
    );
  }
  ['click','auxclick','mousedown','mouseup','pointerdown','touchstart','touchend'].forEach(function(type){
    document.addEventListener(type,function(ev){
      lockOpen();
      if(isPlayControl(ev.target)){
        lockOpen();
        setTimeout(lockOpen,0);
        setTimeout(lockOpen,30);
        setTimeout(lockOpen,120);
        // Kill invisible ad anchors sitting on top of the play button (common on iOS)
        try{
          var x=(ev.touches&&ev.touches[0]?ev.touches[0].clientX:ev.clientX);
          var y=(ev.touches&&ev.touches[0]?ev.touches[0].clientY:ev.clientY);
          if(typeof x==='number'&&document.elementsFromPoint){
            document.elementsFromPoint(x,y).forEach(function(node){
              if(!node||node===ev.target) return;
              if(node.tagName==='A'||(node.closest&&node.closest('a'))){
                var a=node.tagName==='A'?node:node.closest('a');
                var href=a&&(a.getAttribute('href')||a.href)||'';
                if(a&&(badUrl(href)||(a.getAttribute('target')||'')==='_blank'||!allowNav(href))){
                  hide(a);
                  ev.preventDefault();
                  try{ev.stopImmediatePropagation();}catch(e){}
                }
              }
            });
          }
        }catch(e){}
      }
      var a=ev.target&&ev.target.closest&&ev.target.closest('a,[onclick*="window.open"],[data-href]');
      if(a&&a.tagName!=='A'&&a.getAttribute){
        var dh=a.getAttribute('data-href')||'';
        if(badUrl(dh)||AD_HREF.test(dh)||/window\\.open/i.test(a.getAttribute('onclick')||'')){
          ev.preventDefault();ev.stopPropagation();
          try{ev.stopImmediatePropagation();}catch(e){}
          return;
        }
      }
      if(a&&a.tagName==='A'&&killNav(ev,a)) return;
      if(isPlayControl(ev.target)&&a&&a.tagName==='A'){
        var href=a.getAttribute('href')||'';
        if(!href||href.charAt(0)==='#'||/javascript:/i.test(href)) return;
        if(badUrl(href)||AD_HREF.test(href)||(a.getAttribute('target')||'')==='_blank'||!allowNav(href)){
          ev.preventDefault();ev.stopPropagation();
          try{ev.stopImmediatePropagation();}catch(e){}
        }
      }
    },true);
  });
  var re=/guruvpnapp|acscdn|aclib|baillieumbered|doubleclick|googlesyndication|pagead|popads|propeller|exoclick|trafficjunky|juicyads|adsterra|monetag|pavanesbedizen|clickadu|popcash|\\/ads\\//i;
  var uiHide=/bein\\s*max|تحديث|مشاركة|share|refresh|بث\\s*\\d+/i;
  function hide(el){
    if(!el||!el.style)return;
    el.style.setProperty('display','none','important');
    el.style.setProperty('visibility','hidden','important');
    el.style.setProperty('pointer-events','none','important');
    el.setAttribute('hidden','');
  }
  function isPlayerRoot(el){
    if(!el||!el.closest)return false;
    return !!el.closest('video,audio,#player,.player,.clappr-player,[data-player],.slp-player,.media-control,.play-wrapper,.aplr-player-content,.aplr-player-wrapper,.jwplayer,.video-js');
  }
  function scrubOverlays(){
    try{
      document.querySelectorAll('a[href*="guruvpnapp"],a[href*="fifa-wc"],a[href*="sub_id="]').forEach(hide);
      document.querySelectorAll('a[target="_blank"],a[target="_top"],a[target="_parent"]').forEach(function(a){
        var href=a.getAttribute('href')||a.href||'';
        a.removeAttribute('target');
        if(badUrl(href)||AD_HREF.test(href)||!allowNav(href)) hide(a);
      });
      document.querySelectorAll('script[src],iframe[src],img[src],a[href]').forEach(function(el){
        var v=el.src||el.href||'';
        if(re.test(v)||badUrl(v)){ if(el.tagName==='A') hide(el); else el.remove(); }
      });
      document.querySelectorAll('.aplr-menu,.aplr-link,a.aplr-link,.aplr-exbtns,.aplr-action.showrefresh,.aplr-action.showshare,.aplr-icon-refresh,.aplr-icon-share,a[href*="serv="]').forEach(hide);
      document.querySelectorAll('a.aplr-link,button.aplr-link,.aplr-action').forEach(function(el){
        var t=(el.textContent||'').replace(/\\s+/g,' ').trim();
        if(!t||t.length>40)return;
        if(uiHide.test(t)) hide(el);
      });
      // Monetag / click-gate overlays: fixed full-bleed layers above the player
      document.querySelectorAll('body > div, body > a, body > iframe, #ts_ad_responsive, [id*="monetag"], [class*="monetag"], [id*="popmag"], [class*="popunder"]').forEach(function(el){
        if(isPlayerRoot(el)) return;
        try{
          var st=window.getComputedStyle(el);
          var zi=parseInt(st.zIndex,10)||0;
          var fixed=st.position==='fixed'||st.position==='absolute';
          var big=(el.offsetWidth||0)>=Math.min(280,window.innerWidth*0.7)&&(el.offsetHeight||0)>=Math.min(180,window.innerHeight*0.45);
          if(fixed&&(zi>=999||big)&&!el.querySelector('video,.clappr-player,#player')) hide(el);
        }catch(e){}
      });
    }catch(e){}
  }
  scrubOverlays();
  setInterval(scrubOverlays,500);
  try{new MutationObserver(scrubOverlays).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
})();
</script>
<script id="shaib-player-autoplay">
(function(){
  if(window.__shaibPlayerAutoPlay)return;window.__shaibPlayerAutoPlay=true;
  var tries=0;
  var unmuted=false;
  var mobile=/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent||'');
  function playVid(v){
    try{
      v.setAttribute('playsinline','');
      v.setAttribute('webkit-playsinline','');
      v.setAttribute('autoplay','');
      v.setAttribute('muted','');
      v.playsInline=true;
      v.muted=true;v.defaultMuted=true;
      var p=v.play();
      if(p&&p.then)p.then(function(){
        // Desktop: unmute shortly. Mobile: stay muted so autoplay is allowed, unmute on first tap.
        if(mobile){
          if(!window.__shaibUnmuteBound){
            window.__shaibUnmuteBound=true;
            var unmute=function(){
              try{document.querySelectorAll('video,audio').forEach(function(x){x.muted=false;});}catch(e){}
              document.removeEventListener('touchstart',unmute,true);
              document.removeEventListener('click',unmute,true);
            };
            document.addEventListener('touchstart',unmute,true);
            document.addEventListener('click',unmute,true);
          }
          return;
        }
        if(!unmuted){
          unmuted=true;
          setTimeout(function(){try{v.muted=false;}catch(e){}},500);
        }
      }).catch(function(){
        try{v.muted=true;v.play().catch(function(){});}catch(e){}
      });
    }catch(e){}
  }
  function clickEl(el){
    if(!el)return;
    try{
      ['pointerdown','mousedown','mouseup','click','touchstart','touchend'].forEach(function(type){
        el.dispatchEvent(new Event(type,{bubbles:true,cancelable:true}));
      });
    }catch(e){}
    try{el.click();}catch(e){}
  }
  function clickThroughGate(){
    // First pass: dismiss interstitial / "click to continue" gates, then play
    var gateSels=[
      '.slp-subscribe-popup button','.slp-subscribe-button','.slp-embed-overlay',
      '[class*="interstitial"] button','[class*="gate"] button','[class*="continue"]',
      'button[aria-label*="Continue"]','button[aria-label*="متابعة"]',
      '.close-btn','.btn-close','[class*="close-ad"]','[id*="close"]'
    ];
    for(var g=0;g<gateSels.length;g++){
      document.querySelectorAll(gateSels[g]).forEach(function(el){
        if(el.closest&&el.closest('video,#player,.clappr-player')) return;
        clickEl(el);
      });
    }
  }
  function kick(){
    tries++;
    try{
      clickThroughGate();
      document.querySelectorAll('video,audio').forEach(playVid);
      var sels=[
        '.play-wrapper .play-button','.play-button','.media-control-button[data-playpause]',
        '.clappr-player .play-wrapper','[data-player] .play-button',
        '.vjs-big-play-button','button.vjs-big-play-button','.jw-icon-playback',
        '.jw-display-icon-container','.jw-display','.jw-icon-display',
        '.plyr__control--overlaid','#aplr-video','.aplr-player-content video',
        'button.watch-btn','.watch-btn','.slp-player-tab.active',
        'button[aria-label*="Play"]','button[aria-label*="play"]','button[aria-label*="تشغيل"]',
        '[class*="big-play"]','[class*="PlayBtn"]','.player-poster','.poster-container'
      ];
      for(var i=0;i<sels.length;i++){
        document.querySelectorAll(sels[i]).forEach(clickEl);
      }
      try{
        if(window.player&&typeof window.player.play==='function') window.player.play();
      }catch(e){}
      try{
        // soccer_live_player (kora-sami) exposes the Clappr instance as window.clapprPlayer
        var cp=window.clapprPlayer||(window.clappr&&window.clappr.player);
        if(cp){
          if(typeof cp.mute==='function') cp.mute();
          if(typeof cp.play==='function') cp.play();
        }
      }catch(e){}
      try{
        if(window.jwplayer){
          var jw=window.jwplayer();
          if(jw&&typeof jw.play==='function') jw.play();
        }
      }catch(e){}
      try{
        document.querySelectorAll('.video-js').forEach(function(el){
          if(el.player&&typeof el.player.play==='function') el.player.play();
        });
      }catch(e){}
    }catch(e){}
    if(tries<60)setTimeout(kick,350);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(kick,80);});
  else setTimeout(kick,80);
  try{new MutationObserver(function(){ if(tries<60) kick(); }).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
})();
</script>`;
    const easy = easyListRuntimeShield();
    if (/<head[^>]*>/i.test(html)) {
      return html.replace(/<head[^>]*>/i, (m) => `${m}\n${base}\n${shield}\n${easy}`);
    }
    return `<!DOCTYPE html><html><head>${base}\n${shield}\n${easy}</head><body>${html}</body></html>`;
  }

  function isAllowedPlayerUrl(raw) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.protocol !== "http:") return false;
      return PLAYER_HOST_OK.test(u.hostname + u.pathname);
    } catch (_) {
      return false;
    }
  }

  async function fetchPlayerHtml(targetUrl) {
    // Direct fetch fails in SW without CORS ACAO — use CORS proxies first.
    const tries = [
      `https://proxy.cors.sh/${targetUrl}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      targetUrl,
    ];
    let lastErr = "fetch failed";
    for (const u of tries) {
      try {
        const res = await fetch(u, {
          redirect: "follow",
          credentials: "omit",
          cache: "no-store",
          headers: {
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          },
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          continue;
        }
        let text = await res.text();
        // allorigins /get-style JSON envelope
        try {
          const j = JSON.parse(text);
          if (j && typeof j.contents === "string") text = j.contents;
        } catch (_) {}
        if (text && text.length > 80 && /<html|document\.write|<video|<script/i.test(text)) {
          return text;
        }
        lastErr = "empty upstream";
      } catch (err) {
        lastErr = err && err.message ? err.message : String(err);
      }
    }
    throw new Error(lastErr);
  }

  async function buildPlayerProxyResponse(targetUrl) {
    if (!isAllowedPlayerUrl(targetUrl)) {
      return new Response("Forbidden player host", { status: 403 });
    }
    let html = await fetchPlayerHtml(targetUrl);
    html = unwrapDocumentWrite(html);
    html = stripAds(html);
    html = injectShield(html, targetUrl);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Shaib-Player-Proxy": "1",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  global.SHAIB_IS_PLAYER_PROXY = function (url) {
    try {
      const u = new URL(url);
      if (u.searchParams.get("__shaib_player") === "1") return true;
      return u.pathname.endsWith("/__shaib_player");
    } catch (_) {
      return false;
    }
  };

  global.SHAIB_HANDLE_PLAYER_PROXY = async function (request) {
    const u = new URL(request.url);
    const target = u.searchParams.get("u") || u.searchParams.get("url") || "";
    try {
      return await buildPlayerProxyResponse(target);
    } catch (err) {
      return new Response(String(err && err.message ? err.message : err), {
        status: 502,
      });
    }
  };
})(self);
