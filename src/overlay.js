/*!
 * overlay.js — revisor de feedback. Só é carregado quando o loader autoriza.
 *
 * Janela principal (CHROME):
 *   - botão flutuante "Revisar" sobre o site;
 *   - ao abrir, tela de revisão: barra lateral de comentários (busca, status,
 *     breakpoint → página), topo com dispositivo / largura / presets, o site num
 *     quadro (iframe) no centro e o seletor Navegar / Comentar embaixo.
 * Dentro do quadro (CANVAS):
 *   - pins, cartões, modo comentar e ancoragem, conversando com a janela
 *     principal por postMessage (mesma origem).
 *
 * Comentários pertencem a um breakpoint (desktop/tablet/mobile, pela largura do
 * quadro) e a uma página. Status: aberto, em andamento, em revisão, resolvido.
 */
(function () {
  var CFG = window.__FB_CONFIG__;
  if (!CFG || window.__FB_OVERLAY__) return;
  window.__FB_OVERLAY__ = true;

  // ------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------
  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function textOf(el) { return norm(el.innerText || el.textContent || ''); }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'X-Review-Session': CFG.session, 'X-Author-Key': authorKey() }, opts.headers || {});
    return fetch(CFG.base + path, opts).then(function (r) { return r.json(); });
  }
  function ss(key, val) {
    try {
      if (val === undefined) return JSON.parse(sessionStorage.getItem(key) || 'null');
      if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function loadAll() {
    return api('/api/comments?all=1').then(function (l) { return Array.isArray(l) ? l : []; });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Breakpoints (padrão Webflow: tablet ≤ 991, mobile ≤ 767)
  var BPS = ['desktop', 'tablet', 'mobile'];
  var BP_LABEL = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
  var BP_WIDTH = { desktop: 1440, tablet: 768, mobile: 390 };
  var PRESETS = [
    { w: 1920, label: 'Desktop grande' }, { w: 1440, label: 'Desktop' }, { w: 1280, label: 'Laptop' },
    { w: 991, label: 'Tablet (Webflow)' }, { w: 768, label: 'iPad' }, { w: 767, label: 'Mobile paisagem' },
    { w: 430, label: 'iPhone Pro Max' }, { w: 390, label: 'iPhone' }, { w: 360, label: 'Android' },
  ];
  function bpOf(w) { return w < 768 ? 'mobile' : w < 992 ? 'tablet' : 'desktop'; }
  function pageLabel(p) { return p === '/' ? 'Página inicial' : p; }

  // Status
  var STATUSES = ['open', 'resolved'];
  var ST_LABEL = { open: 'Aberto', resolved: 'Resolvido' };
  var ST_COLOR = { open: 'var(--st-open)', resolved: 'var(--st-done)' }; // tokens do DS (definidos no :host)
  function statusOf(c) { return STATUSES.indexOf(c.status) > -1 ? c.status : 'open'; }
  function isDone(c) { return statusOf(c) === 'resolved'; }
  function inFilter(c, f) { return !f || f.indexOf(statusOf(c)) > -1; }

  // Número de cada comentário: ordem de criação dentro de (página, breakpoint)
  // Comentário geral da página: sem elemento, vale para todos os dispositivos; numerado G1, G2…
  function isGeneral(c) { return !!(c && c.anchor && c.anchor.kind === 'page'); }
  function numbers(all) {
    var seq = {}, map = {};
    all.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); }).forEach(function (c) {
      var g = isGeneral(c), k = c.path + '|' + (g ? 'geral' : (c.device || 'desktop'));
      seq[k] = (seq[k] || 0) + 1; map[c.id] = g ? 'G' + seq[k] : seq[k];
    });
    return map;
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    if (s < 604800) return Math.floor(s / 86400) + ' d';
    return new Date(iso).toLocaleDateString('pt-BR');
  }

  // Identidade de quem comenta: link pessoal (definido no servidor) ou nome+email salvos no navegador
  function personalName() { return CFG.who ? CFG.who.name + (CFG.who.org ? ' · ' + CFG.who.org : '') : null; }
  var ID_COOKIE = 'fb_ident';
  function readCookie(n) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function identity() {
    if (CFG.who) return { name: personalName(), personal: true };
    var raw = readCookie(ID_COOKIE);
    if (!raw) { try { raw = localStorage.getItem(ID_COOKIE); } catch (e) {} }
    try { var i = JSON.parse(raw || 'null'); if (i && i.name) return i; } catch (e) {}
    return null;
  }
  function saveIdentity(name, email) {
    var v = JSON.stringify({ name: name, email: email || null });
    // cookie do próprio site (vale para a página e para o quadro), 1 ano
    document.cookie = ID_COOKIE + '=' + encodeURIComponent(v) + '; max-age=31536000; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    try { localStorage.setItem(ID_COOKIE, v); } catch (e) {}
  }
  // Chave secreta do autor: só quem tem (mesmo navegador) edita/apaga o que escreveu
  var KEY_COOKIE = 'fb_akey', _akey = null;
  function authorKey() {
    if (_akey) return _akey;
    var k = readCookie(KEY_COOKIE);
    if (!k) { try { k = localStorage.getItem(KEY_COOKIE); } catch (e) {} }
    if (!k || !/^[A-Za-z0-9_-]{16,80}$/.test(k)) {
      var a = new Uint8Array(24); (window.crypto || window.msCrypto).getRandomValues(a);
      k = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    document.cookie = KEY_COOKIE + '=' + k + '; max-age=31536000; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    try { localStorage.setItem(KEY_COOKIE, k); } catch (e) {}
    return (_akey = k);
  }
  function clearIdentity() {
    document.cookie = ID_COOKIE + '=; max-age=0; path=/';
    try { localStorage.removeItem(ID_COOKIE); } catch (e) {}
  }
  var AV_COLORS = ['orange', 'blue', 'purple', 'cyan', 'pink', 'yellow', 'red', 'tinted']; // paleta do DS
  function initials(n) {
    // só letras/números contam para as iniciais (ex.: "Caetano (teste)" → "CT")
    var p = String(n || '?').split('·')[0].replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!p.length) p = ['?'];
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function avColor(n) { var h = 0, s = String(n || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
  function avatarHTML(n, size) {
    size = size || 20;
    return '<span class="av" style="width:' + size + 'px;height:' + size + 'px;line-height:' + size + 'px;font-size:' + Math.round(size * 0.45) + 'px;background:var(--cc-semantic-theme-palette-' + avColor(n) + '-low-bg);color:var(--cc-semantic-theme-palette-' + avColor(n) + '-low-content)">' + esc(initials(n)) + '</span>';
  }
  function validEmail(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || ''); }

  // Estamos dentro do quadro aberto pelo próprio revisor?
  var IS_FRAME = (function () {
    try { return window.parent !== window && !!window.parent.__FB_OVERLAY__ && window.parent.location.origin === location.origin; }
    catch (e) { return false; }
  })();

  // ------------------------------------------------------------------
  // Plataforma e âncoras
  // ------------------------------------------------------------------
  function detectPlatform() {
    var gen = (document.querySelector('meta[name="generator"]') || {}).content || '';
    if (/webflow/i.test(gen) || document.documentElement.hasAttribute('data-wf-site')) return 'webflow';
    if (/framer/i.test(gen) || document.querySelector('[data-framer-name]')) return 'framer';
    return 'generic';
  }
  var PLATFORM = detectPlatform();

  function domPath(el, root) {
    root = root || document.body;
    var parts = [];
    while (el && el !== root && el.nodeType === 1) {
      var tag = el.tagName.toLowerCase(), i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++;
      parts.unshift(tag + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    return parts.join('>');
  }
  function followPath(root, p) {
    if (!p) return root;
    try { return root.querySelector(':scope>' + p); } catch (e) { return null; }
  }
  function stableClasses(el) {
    if (PLATFORM !== 'webflow') return [];
    return [].slice.call(el.classList).filter(function (c) { return !/^w--/.test(c) && !/^fb-/.test(c); });
  }
  var KEY_ATTRS = ['data-testid', 'data-test', 'data-id', 'aria-label', 'name', 'role'];
  function segmentFor(el) {
    var seg = el.tagName.toLowerCase();
    stableClasses(el).forEach(function (c) { seg += '.' + cssEsc(c); });
    KEY_ATTRS.forEach(function (a) {
      var v = el.getAttribute(a);
      if (v && v.length < 60) seg += '[' + a + '="' + v.replace(/"/g, '\\"') + '"]';
    });
    return seg;
  }
  function cssAnchor(el) {
    var parts = [], cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      if (cur.id && !/\d{4,}|^[a-f0-9]{8,}$/i.test(cur.id)) { parts.unshift('#' + cssEsc(cur.id)); }
      else parts.unshift(segmentFor(cur));
      var sel = parts.join(' > ');
      var all;
      try { all = document.querySelectorAll(sel); } catch (e) { return null; }
      if (all.length === 1 || cur.id) return { sel: sel, index: [].indexOf.call(all, el) };
      if (all.length <= 8 && parts.length >= 3) return { sel: sel, index: [].indexOf.call(all, el) };
      cur = cur.parentElement;
    }
    return null;
  }
  function framerChain(named) {
    var chain = [], cur = named;
    while (cur) {
      var n = cur.getAttribute && cur.getAttribute('data-framer-name');
      if (n) chain.unshift(n);
      cur = cur.parentElement;
    }
    return chain;
  }
  function framerAnchor(el) {
    var named = el.closest('[data-framer-name]');
    if (!named) return null;
    var chain = framerChain(named);
    var leaf = chain[chain.length - 1];
    var cands = [].filter.call(document.querySelectorAll('[data-framer-name="' + leaf.replace(/"/g, '\\"') + '"]'),
      function (c) { return framerChain(c).join('/') === chain.join('/'); });
    return { chain: chain, index: cands.indexOf(named), sub: domPath(el, named) };
  }
  function buildAnchor(el, clientX, clientY) {
    var r = el.getBoundingClientRect();
    return {
      platform: PLATFORM,
      tag: el.tagName.toLowerCase(),
      css: PLATFORM === 'framer' ? null : cssAnchor(el),
      framer: PLATFORM === 'framer' ? framerAnchor(el) : null,
      path: domPath(el),
      text: textOf(el),
      rel: { x: r.width ? (clientX - r.left) / r.width : 0, y: r.height ? (clientY - r.top) / r.height : 0 },
      page: { x: clientX + scrollX, y: clientY + scrollY },
    };
  }
  function textOk(a, el) { return !a.text || textOf(el) === a.text; }
  var strategies = {
    css: function (a) {
      if (!a.css) return null;
      var all; try { all = document.querySelectorAll(a.css.sel); } catch (e) { return null; }
      return all[a.css.index] || (all.length === 1 ? all[0] : null);
    },
    framer: function (a) {
      if (!a.framer) return null;
      var f = a.framer, leaf = f.chain[f.chain.length - 1];
      var cands = [].filter.call(document.querySelectorAll('[data-framer-name="' + leaf.replace(/"/g, '\\"') + '"]'),
        function (c) { return framerChain(c).join('/') === f.chain.join('/'); });
      var base = cands[f.index] || (cands.length === 1 ? cands[0] : null);
      return base ? followPath(base, f.sub) : null;
    },
    path: function (a) { return followPath(document.body, a.path); },
    text: function (a) {
      if (!a.text || a.text.length < 3) return null;
      var best = null, bestD = Infinity;
      [].forEach.call(document.getElementsByTagName(a.tag), function (el) {
        if (textOf(el) !== a.text) return;
        var r = el.getBoundingClientRect();
        var d = Math.abs(r.left + scrollX - a.page.x) + Math.abs(r.top + scrollY - a.page.y);
        if (d < bestD) { bestD = d; best = el; }
      });
      return best;
    },
  };
  var ORDER = { webflow: ['css', 'path', 'text'], framer: ['framer', 'text', 'path'], generic: ['css', 'text', 'path'] };
  function resolve(a) {
    var order = ORDER[a.platform] || ORDER.generic;
    for (var i = 0; i < order.length; i++) {
      var el = strategies[order[i]](a);
      if (el && el.tagName.toLowerCase() === a.tag && textOk(a, el)) return { el: el, via: order[i] };
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Design system Lysch: tokens (--cc-*), fonte DM Sans e ícones Remix
  // Os tokens vêm de @lysch/design-system (src/tokens/tokens.css, tema claro).
  // Para atualizar: codigo/supabase/design-system/ (ver LEIA-ME.md lá).
  // ------------------------------------------------------------------
  var ICON = {
    desktop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16H20V5H4V16ZM13 18V20H17V22H7V20H11V18H2.9918C2.44405 18 2 17.5511 2 16.9925V4.00748C2 3.45107 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44892 22 4.00748V16.9925C22 17.5489 21.5447 18 21.0082 18H13Z"/></svg>',
    tablet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4V20H18V4H6ZM5 2H19C19.5523 2 20 2.44772 20 3V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V3C4 2.44772 4.44772 2 5 2ZM12 17C12.5523 17 13 17.4477 13 18C13 18.5523 12.5523 19 12 19C11.4477 19 11 18.5523 11 18C11 17.4477 11.4477 17 12 17Z"/></svg>',
    mobile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4V20H17V4H7ZM6 2H18C18.5523 2 19 2.44772 19 3V21C19 21.5523 18.5523 22 18 22H6C5.44772 22 5 21.5523 5 21V3C5 2.44772 5.44772 2 6 2ZM12 17C12.5523 17 13 17.4477 13 18C13 18.5523 12.5523 19 12 19C11.4477 19 11 18.5523 11 18C11 17.4477 11.4477 17 12 17Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.29117 20.8242L2 22L3.17581 16.7088C2.42544 15.3056 2 13.7025 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C10.2975 22 8.6944 21.5746 7.29117 20.8242ZM7.58075 18.711L8.23428 19.0605C9.38248 19.6745 10.6655 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 13.3345 4.32549 14.6175 4.93949 15.7657L5.28896 16.4192L4.63416 19.3658L7.58075 18.711Z"/></svg>',
    page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8V20.9932C21 21.5501 20.5552 22 20.0066 22H3.9934C3.44495 22 3 21.556 3 21.0082V2.9918C3 2.45531 3.4487 2 4.00221 2H14.9968L21 8ZM19 9H14V4H5V20H19V9ZM8 7H11V9H8V7ZM8 11H16V13H8V11ZM8 15H16V17H8V15Z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"/></svg>',
    chevR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"/></svg>',
    chevD: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"/></svg>',
  };
  /* DS:TOKENS:BEGIN */
  var DS_TOKENS = ':host{--cc-primitives-color-solid-red-on-light-100:#f5e6e5;--cc-primitives-color-solid-red-on-light-600:#ba564d;--cc-primitives-color-solid-red-on-light-700:#9b473f;--cc-primitives-color-solid-orange-on-light-100:#f8eee1;--cc-primitives-color-solid-orange-on-light-600:#ca7353;--cc-primitives-color-solid-orange-on-light-700:#a65b43;--cc-primitives-color-solid-yellow-on-light-100:#faf8db;--cc-primitives-color-solid-yellow-on-light-400:#e7cd7a;--cc-primitives-color-solid-yellow-on-light-700:#906a43;--cc-primitives-color-solid-green-on-light-100:#e6f8ec;--cc-primitives-color-solid-green-on-light-700:#467851;--cc-primitives-color-solid-blue-on-light-100:#e1e9f4;--cc-primitives-color-solid-blue-on-light-700:#3a5ba9;--cc-primitives-color-solid-purple-on-light-100:#f0eaf7;--cc-primitives-color-solid-purple-on-light-700:#724aa4;--cc-primitives-color-solid-pink-on-light-100:#f6eaf1;--cc-primitives-color-solid-pink-on-light-700:#a14962;--cc-primitives-color-solid-cyan-on-light-100:#dff6f8;--cc-primitives-color-solid-cyan-on-light-600:#528ca0;--cc-primitives-color-solid-cyan-on-light-700:#437081;--cc-primitives-color-solid-lime-on-light-100:#f0f9de;--cc-primitives-color-solid-lime-on-light-700:#5a7742;--cc-primitives-dimension-0400:16px;--cc-primitives-dimension-0300:12px;--cc-primitives-dimension-9999:999px;--cc-primitives-dimension-4000:160px;--cc-primitives-dimension-0100:4px;--cc-primitives-dimension-0000:0px;--cc-primitives-dimension-3200:128px;--cc-primitives-dimension-2400:96px;--cc-primitives-dimension-2000:80px;--cc-primitives-dimension-0800:32px;--cc-primitives-dimension-1600:64px;--cc-primitives-dimension-1400:56px;--cc-primitives-dimension-0600:24px;--cc-primitives-dimension-0050:2px;--cc-primitives-dimension-1200:48px;--cc-primitives-dimension-0500:20px;--cc-primitives-dimension-1100:44px;--cc-primitives-dimension-0700:28px;--cc-primitives-dimension-0200:8px;--cc-primitives-dimension-1000:40px;--cc-primitives-dimension-0900:36px;--cc-primitives-border-50:5px;--cc-primitives-border-40:4px;--cc-primitives-border-15:1.5px;--cc-primitives-border-20:2px;--cc-primitives-border-10:1px;--cc-primitives-border-30:3px;--cc-primitives-border-00:0px;--cc-primitives-motion-slow:300ms;--cc-primitives-motion-medium:225ms;--cc-primitives-motion-fast:150ms;--cc-primitives-font-size-0500:20px;--cc-primitives-font-size-0450:18px;--cc-primitives-font-line-height-1500:60px;--cc-primitives-font-line-height-1300:52px;--cc-primitives-font-size-0350:14px;--cc-primitives-font-line-height-0700:28px;--cc-primitives-font-line-height-0600:24px;--cc-primitives-font-line-height-0500:20px;--cc-primitives-font-line-height-0400:16px;--cc-primitives-font-weight-300:300;--cc-primitives-font-line-height-0300:12px;--cc-primitives-font-weight-600:600;--cc-primitives-font-size-0300:12px;--cc-primitives-font-line-height-1100:44px;--cc-primitives-font-size-1500:60px;--cc-primitives-font-weight-400:400;--cc-primitives-font-size-1200:48px;--cc-primitives-font-size-0400:16px;--cc-primitives-font-weight-500:500;--cc-primitives-font-size-1000:40px;--cc-primitives-font-size-0600:24px;--cc-primitives-font-size-0900:36px;--cc-primitives-radius-0000:0px;--cc-primitives-radius-0050:2px;--cc-primitives-radius-0100:4px;--cc-primitives-radius-0200:8px;--cc-primitives-radius-0300:12px;--cc-primitives-radius-0400:16px;--cc-primitives-radius-0500:20px;--cc-primitives-radius-0600:24px;--cc-primitives-radius-9999:9999px;--cc-primitives-color-solid-neutral-on-light-050:#f7f7f7;--cc-primitives-color-solid-neutral-on-light-950:#292828;--cc-primitives-color-solid-neutral-on-light-900:#474646;--cc-primitives-color-solid-tinted-on-light-050:#f8f7f5;--cc-primitives-color-solid-tinted-on-light-100:#f1eee9;--cc-primitives-color-solid-tinted-on-light-200:#e5dfd6;--cc-primitives-color-solid-tinted-on-light-300:#d2c9bc;--cc-primitives-color-solid-tinted-on-light-400:#bbb09f;--cc-primitives-color-solid-tinted-on-light-500:#a49785;--cc-primitives-color-solid-tinted-on-light-600:#8a7e6c;--cc-primitives-color-solid-tinted-on-light-700:#706657;--cc-primitives-color-solid-tinted-on-light-900:#4c453b;--cc-primitives-color-solid-tinted-on-light-950:#2c2821;--cc-primitives-color-solid-base-white:#ffffff;--cc-primitives-color-solid-base-black:#000000;--cc-primitives-color-alpha-white-050:#ffffff0d;--cc-primitives-color-alpha-white-100:#ffffff1a;--cc-primitives-color-alpha-white-500:#ffffff80;--cc-primitives-color-alpha-white-600:#ffffff99;--cc-primitives-color-alpha-white-950:#fffffff2;--cc-primitives-color-alpha-black-050:#00000008;--cc-primitives-color-alpha-black-100:#00000014;--cc-primitives-color-alpha-black-200:#00000033;--cc-primitives-color-alpha-on-solid-050:#2612090d;--cc-primitives-color-alpha-on-solid-100:#2612091a;--cc-primitives-color-alpha-on-solid-200:#26120933;--cc-primitives-color-alpha-on-solid-400:#26120966;--cc-primitives-color-alpha-on-solid-500:#26120980;--cc-primitives-color-alpha-on-solid-600:#26120999;--cc-primitives-color-alpha-on-solid-900:#261209e5;--cc-primitives-radius-0700:28px;--cc-primitives-radius-0800:32px;--cc-primitives-font-family-display:"DM Sans", sans-serif;--cc-primitives-radius-0150:6px;--cc-primitives-dimension-8000:320px;--cc-primitives-dimension-7000:280px;--cc-primitives-font-family-text:"DM Sans", sans-serif;--cc-primitives-effects-shadow-level-1-x:0;--cc-primitives-effects-shadow-level-1-y:0;--cc-primitives-effects-shadow-level-1-blur:4;--cc-primitives-effects-shadow-level-1-spread:0;--cc-primitives-effects-shadow-level-1-color:#0000001f;--cc-primitives-effects-shadow-level-2-x:0;--cc-primitives-effects-shadow-level-2-y:0;--cc-primitives-effects-shadow-level-2-blur:8;--cc-primitives-effects-shadow-level-2-spread:0;--cc-primitives-effects-shadow-level-2-color:#00000014;--cc-primitives-effects-shadow-level-3-x:0;--cc-primitives-effects-shadow-level-3-y:0;--cc-primitives-effects-shadow-level-3-blur:16;--cc-primitives-effects-shadow-level-3-spread:0;--cc-primitives-effects-shadow-level-3-color:#00000029;--cc-primitives-font-letter-spacing-tight:-0.800000011920929px;--cc-primitives-font-letter-spacing-default:0px;--cc-primitives-font-letter-spacing-wide:0.800000011920929px;--cc-primitives-color-alpha-brand-100:#a497851a;--cc-semantic-theme-content-primary:var(--cc-primitives-color-solid-tinted-on-light-950);--cc-semantic-theme-content-secondary:var(--cc-primitives-color-solid-tinted-on-light-700);--cc-semantic-theme-content-tertiary:var(--cc-primitives-color-solid-tinted-on-light-500);--cc-semantic-theme-content-placeholder:var(--cc-primitives-color-solid-tinted-on-light-600);--cc-semantic-theme-content-disabled:var(--cc-primitives-color-solid-tinted-on-light-400);--cc-semantic-theme-content-inverse:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-feedback-critical-low-content:var(--cc-primitives-color-solid-red-on-light-700);--cc-semantic-theme-feedback-critical-low-bg:var(--cc-primitives-color-solid-red-on-light-100);--cc-semantic-theme-feedback-critical-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-feedback-critical-high-bg:var(--cc-primitives-color-solid-red-on-light-600);--cc-semantic-theme-feedback-critical-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-feedback-critical-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-orange-low-bg:var(--cc-primitives-color-solid-orange-on-light-100);--cc-semantic-theme-palette-orange-low-content:var(--cc-primitives-color-solid-orange-on-light-700);--cc-semantic-theme-palette-orange-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-orange-high-bg:var(--cc-primitives-color-solid-orange-on-light-600);--cc-semantic-theme-palette-orange-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-palette-orange-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-cyan-low-bg:var(--cc-primitives-color-solid-cyan-on-light-100);--cc-semantic-theme-palette-cyan-low-content:var(--cc-primitives-color-solid-cyan-on-light-700);--cc-semantic-theme-palette-cyan-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-cyan-high-bg:var(--cc-primitives-color-solid-cyan-on-light-700);--cc-semantic-theme-palette-cyan-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-palette-cyan-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-purple-low-bg:var(--cc-primitives-color-solid-purple-on-light-100);--cc-semantic-theme-palette-purple-low-content:var(--cc-primitives-color-solid-purple-on-light-700);--cc-semantic-theme-palette-purple-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-purple-high-bg:var(--cc-primitives-color-solid-purple-on-light-700);--cc-semantic-theme-palette-purple-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-palette-purple-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-pink-low-bg:var(--cc-primitives-color-solid-pink-on-light-100);--cc-semantic-theme-palette-pink-low-content:var(--cc-primitives-color-solid-pink-on-light-700);--cc-semantic-theme-palette-pink-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-pink-high-bg:var(--cc-primitives-color-solid-pink-on-light-700);--cc-semantic-theme-palette-pink-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-palette-pink-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-red-low-bg:var(--cc-primitives-color-solid-red-on-light-100);--cc-semantic-theme-palette-red-low-content:var(--cc-primitives-color-solid-red-on-light-700);--cc-semantic-theme-palette-red-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-red-high-bg:var(--cc-primitives-color-solid-red-on-light-600);--cc-semantic-theme-palette-red-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-palette-red-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-yellow-low-bg:var(--cc-primitives-color-solid-yellow-on-light-100);--cc-semantic-theme-palette-yellow-low-content:var(--cc-primitives-color-solid-yellow-on-light-700);--cc-semantic-theme-palette-yellow-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-yellow-high-bg:var(--cc-primitives-color-solid-yellow-on-light-400);--cc-semantic-theme-palette-yellow-high-content:var(--cc-primitives-color-solid-base-black);--cc-semantic-theme-palette-yellow-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-lime-low-bg:var(--cc-primitives-color-solid-lime-on-light-100);--cc-semantic-theme-palette-lime-low-content:var(--cc-primitives-color-solid-lime-on-light-700);--cc-semantic-theme-palette-lime-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-lime-high-bg:var(--cc-primitives-color-solid-lime-on-light-700);--cc-semantic-theme-palette-lime-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-palette-lime-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-blue-low-bg:var(--cc-primitives-color-solid-blue-on-light-100);--cc-semantic-theme-palette-blue-low-content:var(--cc-primitives-color-solid-blue-on-light-700);--cc-semantic-theme-palette-blue-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-blue-high-bg:var(--cc-primitives-color-solid-blue-on-light-700);--cc-semantic-theme-palette-blue-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-palette-blue-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-neutral-low-bg:var(--cc-primitives-color-solid-neutral-on-light-050);--cc-semantic-theme-palette-neutral-low-content:var(--cc-primitives-color-solid-neutral-on-light-950);--cc-semantic-theme-palette-neutral-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-neutral-high-bg:var(--cc-primitives-color-solid-neutral-on-light-900);--cc-semantic-theme-palette-neutral-high-content:var(--cc-primitives-color-solid-neutral-on-light-050);--cc-semantic-theme-palette-neutral-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-palette-tinted-low-bg:var(--cc-primitives-color-solid-tinted-on-light-100);--cc-semantic-theme-palette-tinted-low-content:var(--cc-primitives-color-solid-tinted-on-light-700);--cc-semantic-theme-palette-tinted-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-palette-tinted-high-bg:var(--cc-primitives-color-solid-tinted-on-light-900);--cc-semantic-theme-palette-tinted-high-content:var(--cc-primitives-color-solid-tinted-on-light-100);--cc-semantic-theme-palette-tinted-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-bg-primary:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-bg-secondary:var(--cc-primitives-color-solid-tinted-on-light-050);--cc-semantic-theme-bg-tertiary:var(--cc-primitives-color-solid-tinted-on-light-100);--cc-semantic-theme-bg-surface:var(--cc-primitives-color-solid-tinted-on-light-050);--cc-semantic-theme-bg-inverse:var(--cc-primitives-color-solid-tinted-on-light-950);--cc-semantic-theme-bg-floating:var(--cc-primitives-color-solid-tinted-on-light-050);--cc-semantic-theme-state-hovered-neutral:var(--cc-primitives-color-alpha-black-100);--cc-semantic-theme-state-pressed-neutral:var(--cc-primitives-color-alpha-black-200);--cc-semantic-theme-bg-backdrop:var(--cc-primitives-color-alpha-on-solid-400);--cc-semantic-theme-state-hovered-on-brand:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-state-hovered-inverse:var(--cc-primitives-color-alpha-white-050);--cc-semantic-theme-state-pressed-on-brand:var(--cc-primitives-color-alpha-on-solid-100);--cc-semantic-theme-state-pressed-inverse:var(--cc-primitives-color-alpha-white-100);--cc-semantic-theme-brand-static-low-bg:var(--cc-primitives-color-solid-tinted-on-light-100);--cc-semantic-theme-brand-static-low-content:var(--cc-primitives-color-solid-tinted-on-light-950);--cc-semantic-theme-brand-static-low-border:var(--cc-primitives-color-solid-tinted-on-light-950);--cc-semantic-theme-brand-static-high-bg:var(--cc-primitives-color-solid-tinted-on-light-950);--cc-semantic-theme-brand-static-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-brand-static-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-border-primary:var(--cc-primitives-color-solid-tinted-on-light-100);--cc-semantic-theme-border-secondary:var(--cc-primitives-color-solid-tinted-on-light-200);--cc-semantic-theme-border-strong:var(--cc-primitives-color-solid-tinted-on-light-950);--cc-semantic-theme-border-focus:var(--cc-primitives-color-solid-cyan-on-light-600);--cc-semantic-theme-shadow-low:var(--cc-primitives-color-alpha-black-050);--cc-semantic-theme-shadow-high:var(--cc-primitives-color-alpha-black-200);--cc-semantic-theme-shadow-brand:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-feedback-success-low-bg:var(--cc-primitives-color-solid-green-on-light-100);--cc-semantic-theme-feedback-success-low-content:var(--cc-primitives-color-solid-green-on-light-700);--cc-semantic-theme-feedback-success-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-feedback-success-high-bg:var(--cc-primitives-color-solid-green-on-light-700);--cc-semantic-theme-feedback-success-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-feedback-success-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-feedback-warning-low-bg:var(--cc-primitives-color-solid-yellow-on-light-100);--cc-semantic-theme-feedback-warning-low-content:var(--cc-primitives-color-solid-yellow-on-light-700);--cc-semantic-theme-feedback-warning-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-feedback-warning-high-bg:var(--cc-primitives-color-solid-yellow-on-light-400);--cc-semantic-theme-feedback-warning-high-content:var(--cc-primitives-color-solid-base-black);--cc-semantic-theme-feedback-warning-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-feedback-info-low-bg:var(--cc-primitives-color-solid-blue-on-light-100);--cc-semantic-theme-feedback-info-low-content:var(--cc-primitives-color-solid-blue-on-light-700);--cc-semantic-theme-feedback-info-low-border:var(--cc-primitives-color-alpha-on-solid-050);--cc-semantic-theme-feedback-info-high-bg:var(--cc-primitives-color-solid-blue-on-light-700);--cc-semantic-theme-feedback-info-high-content:var(--cc-primitives-color-solid-base-white);--cc-semantic-theme-feedback-info-high-border:var(--cc-primitives-color-alpha-on-solid-200);--cc-semantic-theme-bg-skeleton:var(--cc-primitives-color-solid-tinted-on-light-300);--cc-semantic-theme-border-knockout:var(--cc-semantic-theme-bg-primary);--cc-semantic-theme-bg-disabled:var(--cc-primitives-color-solid-tinted-on-light-200);--cc-semantic-theme-border-disabled:var(--cc-primitives-color-solid-tinted-on-light-300);--cc-semantic-theme-palette-alpha-low-bg:var(--cc-primitives-color-alpha-white-600);--cc-semantic-theme-palette-alpha-low-content:var(--cc-primitives-color-alpha-on-solid-900);--cc-semantic-theme-palette-alpha-low-border:var(--cc-primitives-color-alpha-white-500);--cc-semantic-theme-palette-alpha-high-bg:var(--cc-primitives-color-alpha-on-solid-600);--cc-semantic-theme-palette-alpha-high-content:var(--cc-primitives-color-alpha-white-950);--cc-semantic-theme-palette-alpha-high-border:var(--cc-primitives-color-alpha-on-solid-500);--cc-semantic-theme-state-hovered-brand:var(--cc-primitives-color-alpha-brand-100);--cc-semantic-theme-state-pressed-brand:var(--cc-primitives-color-alpha-brand-100);--cc-semantic-type-caption-size:var(--cc-primitives-font-size-0300);--cc-semantic-type-caption-line-height:var(--cc-primitives-font-line-height-0400);--cc-semantic-type-caption-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-caption-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-body-sm-size:var(--cc-primitives-font-size-0350);--cc-semantic-type-body-sm-line-height:var(--cc-primitives-font-line-height-0500);--cc-semantic-type-body-sm-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-body-sm-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-body-md-size:var(--cc-primitives-font-size-0400);--cc-semantic-type-body-md-line-height:var(--cc-primitives-font-line-height-0600);--cc-semantic-type-body-md-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-body-md-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-body-lg-size:var(--cc-primitives-font-size-0450);--cc-semantic-type-body-lg-line-height:var(--cc-primitives-font-line-height-0700);--cc-semantic-type-body-lg-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-body-lg-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-label-sm-size:var(--cc-primitives-font-size-0300);--cc-semantic-type-label-sm-line-height:var(--cc-primitives-font-line-height-0300);--cc-semantic-type-label-sm-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-label-sm-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-label-md-size:var(--cc-primitives-font-size-0350);--cc-semantic-type-label-md-line-height:var(--cc-primitives-font-line-height-0400);--cc-semantic-type-label-md-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-label-md-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-label-lg-size:var(--cc-primitives-font-size-0400);--cc-semantic-type-label-lg-line-height:var(--cc-primitives-font-line-height-0400);--cc-semantic-type-label-lg-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-label-lg-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-heading-sm-size:var(--cc-primitives-font-size-0450);--cc-semantic-type-heading-sm-line-height:var(--cc-primitives-font-line-height-0600);--cc-semantic-type-heading-sm-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-heading-sm-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-heading-md-size:var(--cc-primitives-font-size-0500);--cc-semantic-type-heading-md-line-height:var(--cc-primitives-font-line-height-0600);--cc-semantic-type-heading-md-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-heading-md-weight-strong:var(--cc-primitives-font-weight-500);--cc-semantic-type-heading-lg-size:var(--cc-primitives-font-size-0600);--cc-semantic-type-heading-lg-line-height:var(--cc-primitives-font-line-height-0700);--cc-semantic-type-heading-lg-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-heading-lg-weight-strong:var(--cc-primitives-font-weight-500);--cc-semantic-type-heading-xl-size:var(--cc-primitives-font-size-0900);--cc-semantic-type-heading-xl-line-height:var(--cc-primitives-font-line-height-1100);--cc-semantic-type-heading-xl-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-heading-xl-weight-strong:var(--cc-primitives-font-weight-500);--cc-semantic-type-heading-xs-size:var(--cc-primitives-font-size-0400);--cc-semantic-type-heading-xs-line-height:var(--cc-primitives-font-line-height-0500);--cc-semantic-type-heading-xs-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-heading-xs-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-display-sm-size:var(--cc-primitives-font-size-1000);--cc-semantic-type-display-sm-line-height:var(--cc-primitives-font-line-height-1100);--cc-semantic-type-display-sm-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-display-sm-weight-strong:var(--cc-primitives-font-weight-500);--cc-semantic-type-display-md-size:var(--cc-primitives-font-size-1200);--cc-semantic-type-display-md-line-height:var(--cc-primitives-font-line-height-1300);--cc-semantic-type-display-md-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-display-md-weight-strong:var(--cc-primitives-font-weight-500);--cc-semantic-type-display-lg-size:var(--cc-primitives-font-size-1500);--cc-semantic-type-display-lg-line-height:var(--cc-primitives-font-line-height-1500);--cc-semantic-type-display-lg-weight:var(--cc-primitives-font-weight-400);--cc-semantic-type-display-lg-weight-strong:var(--cc-primitives-font-weight-500);--cc-semantic-type-caption-family:var(--cc-primitives-font-family-text);--cc-semantic-type-body-sm-family:var(--cc-primitives-font-family-text);--cc-semantic-type-body-md-family:var(--cc-primitives-font-family-text);--cc-semantic-type-body-lg-family:var(--cc-primitives-font-family-text);--cc-semantic-type-label-sm-family:var(--cc-primitives-font-family-text);--cc-semantic-type-label-md-family:var(--cc-primitives-font-family-text);--cc-semantic-type-label-lg-family:var(--cc-primitives-font-family-text);--cc-semantic-type-heading-xs-family:var(--cc-primitives-font-family-text);--cc-semantic-type-heading-sm-family:var(--cc-primitives-font-family-text);--cc-semantic-type-heading-md-family:var(--cc-primitives-font-family-display);--cc-semantic-type-heading-lg-family:var(--cc-primitives-font-family-display);--cc-semantic-type-heading-xl-family:var(--cc-primitives-font-family-display);--cc-semantic-type-display-sm-family:var(--cc-primitives-font-family-display);--cc-semantic-type-display-md-family:var(--cc-primitives-font-family-display);--cc-semantic-type-display-lg-family:var(--cc-primitives-font-family-display);--cc-semantic-type-data-sm-family:var(--cc-primitives-font-family-display);--cc-semantic-type-data-sm-size:var(--cc-primitives-font-size-0900);--cc-semantic-type-data-sm-line-height:var(--cc-primitives-font-line-height-1100);--cc-semantic-type-data-sm-weight:var(--cc-primitives-font-weight-300);--cc-semantic-type-data-sm-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-data-md-family:var(--cc-primitives-font-family-display);--cc-semantic-type-data-md-size:var(--cc-primitives-font-size-1200);--cc-semantic-type-data-md-line-height:var(--cc-primitives-font-line-height-1300);--cc-semantic-type-data-md-weight:var(--cc-primitives-font-weight-300);--cc-semantic-type-data-md-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-data-lg-family:var(--cc-primitives-font-family-display);--cc-semantic-type-data-lg-size:var(--cc-primitives-font-size-1500);--cc-semantic-type-data-lg-line-height:var(--cc-primitives-font-line-height-1500);--cc-semantic-type-data-lg-weight:var(--cc-primitives-font-weight-300);--cc-semantic-type-data-lg-weight-strong:var(--cc-primitives-font-weight-600);--cc-semantic-type-caption-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-data-sm-letter-spacing:var(--cc-primitives-font-letter-spacing-tight);--cc-semantic-type-data-md-letter-spacing:var(--cc-primitives-font-letter-spacing-tight);--cc-semantic-type-data-lg-letter-spacing:var(--cc-primitives-font-letter-spacing-tight);--cc-semantic-type-body-sm-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-body-md-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-body-lg-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-label-sm-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-label-md-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-label-lg-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-heading-xs-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-heading-sm-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-heading-md-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-heading-lg-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-heading-xl-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-display-sm-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-display-md-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-display-lg-letter-spacing:var(--cc-primitives-font-letter-spacing-default);--cc-semantic-type-label-sm-letter-spacing-wide:var(--cc-primitives-font-letter-spacing-wide);--cc-semantic-type-label-md-letter-spacing-wide:var(--cc-primitives-font-letter-spacing-wide);--cc-semantic-type-label-lg-letter-spacing-wide:var(--cc-primitives-font-letter-spacing-wide)}';
  /* DS:TOKENS:END */
  // Atalhos locais para os tokens do DS (só apelidos: todo valor vem de um token --cc-*)
  var DS_ALIASES = ':host{' +
    '--c-pri:var(--cc-semantic-theme-content-primary);--c-sec:var(--cc-semantic-theme-content-secondary);--c-ter:var(--cc-semantic-theme-content-tertiary);' +
    '--c-ph:var(--cc-semantic-theme-content-placeholder);--c-dis:var(--cc-semantic-theme-content-disabled);--c-inv:var(--cc-semantic-theme-content-inverse);' +
    '--bg-pri:var(--cc-semantic-theme-bg-primary);--bg-sec:var(--cc-semantic-theme-bg-secondary);--bg-ter:var(--cc-semantic-theme-bg-tertiary);--bg-srf:var(--cc-semantic-theme-bg-surface);' +
    '--bg-inv:var(--cc-semantic-theme-bg-inverse);--bg-dis:var(--cc-semantic-theme-bg-disabled);--bg-bkd:var(--cc-semantic-theme-bg-backdrop);' +
    '--bd-pri:var(--cc-semantic-theme-border-primary);--bd-sec:var(--cc-semantic-theme-border-secondary);--bd-str:var(--cc-semantic-theme-border-strong);--bd-foc:var(--cc-semantic-theme-border-focus);--bd-ko:var(--cc-semantic-theme-border-knockout);' +
    '--brand:var(--cc-semantic-theme-brand-static-high-bg);--brand-c:var(--cc-semantic-theme-brand-static-high-content);--brand-lo:var(--cc-semantic-theme-brand-static-low-bg);--brand-lo-c:var(--cc-semantic-theme-brand-static-low-content);' +
    '--hov:var(--cc-semantic-theme-state-hovered-neutral);--prs:var(--cc-semantic-theme-state-pressed-neutral);--hov-inv:var(--cc-semantic-theme-state-hovered-inverse);--prs-inv:var(--cc-semantic-theme-state-pressed-inverse);--hov-br:var(--cc-semantic-theme-state-hovered-brand);' +
    '--ok:var(--cc-semantic-theme-feedback-success-high-bg);--ok-c:var(--cc-semantic-theme-feedback-success-high-content);--ok-lo:var(--cc-semantic-theme-feedback-success-low-bg);--ok-lo-c:var(--cc-semantic-theme-feedback-success-low-content);' +
    '--crit:var(--cc-semantic-theme-feedback-critical-high-bg);--crit-c:var(--cc-semantic-theme-feedback-critical-high-content);--crit-lo:var(--cc-semantic-theme-feedback-critical-low-bg);--crit-lo-c:var(--cc-semantic-theme-feedback-critical-low-content);' +
    '--warn-lo:var(--cc-semantic-theme-feedback-warning-low-bg);--warn-lo-c:var(--cc-semantic-theme-feedback-warning-low-content);' +
    '--tint-hi:var(--cc-semantic-theme-palette-tinted-high-bg);--tint-hi-c:var(--cc-semantic-theme-palette-tinted-high-content);--tint-lo:var(--cc-semantic-theme-palette-tinted-low-bg);--tint-lo-bd:var(--cc-semantic-theme-palette-tinted-low-border);' +
    '--neu-lo-c:var(--cc-semantic-theme-palette-neutral-low-content);--neu-hi-c:var(--cc-semantic-theme-palette-neutral-high-content);' +
    '--s0:var(--cc-primitives-dimension-0050);--s1:var(--cc-primitives-dimension-0100);--s2:var(--cc-primitives-dimension-0200);--s3:var(--cc-primitives-dimension-0300);--s4:var(--cc-primitives-dimension-0400);' +
    '--s5:var(--cc-primitives-dimension-0500);--s6:var(--cc-primitives-dimension-0600);--s7:var(--cc-primitives-dimension-0700);--s8:var(--cc-primitives-dimension-0800);--s10:var(--cc-primitives-dimension-1000);--s12:var(--cc-primitives-dimension-1200);--s14:var(--cc-primitives-dimension-1400);--s16:var(--cc-primitives-dimension-1600);' +
    '--r1:var(--cc-primitives-radius-0100);--r2:var(--cc-primitives-radius-0200);--r3:var(--cc-primitives-radius-0300);--r4:var(--cc-primitives-radius-0400);--r6:var(--cc-primitives-radius-0600);--rp:var(--cc-primitives-radius-9999);' +
    '--b1:var(--cc-primitives-border-10);--b2:var(--cc-primitives-border-20);--mf:var(--cc-primitives-motion-fast);' +
    '--sh1:var(--cc-primitives-effects-shadow-level-1-x) var(--cc-primitives-effects-shadow-level-1-y) calc(var(--cc-primitives-effects-shadow-level-1-blur) * 1px) var(--cc-primitives-effects-shadow-level-1-spread) var(--cc-primitives-effects-shadow-level-1-color);' +
    '--sh2:var(--cc-primitives-effects-shadow-level-2-x) var(--cc-primitives-effects-shadow-level-2-y) calc(var(--cc-primitives-effects-shadow-level-2-blur) * 1px) var(--cc-primitives-effects-shadow-level-2-spread) var(--cc-primitives-effects-shadow-level-2-color);' +
    '--sh3:var(--cc-primitives-effects-shadow-level-3-x) var(--cc-primitives-effects-shadow-level-3-y) calc(var(--cc-primitives-effects-shadow-level-3-blur) * 1px) var(--cc-primitives-effects-shadow-level-3-spread) var(--cc-primitives-effects-shadow-level-3-color);' +
    '--ff:var(--cc-semantic-type-body-md-family),ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    '--f-cap:var(--cc-semantic-type-caption-weight) var(--cc-semantic-type-caption-size)/var(--cc-semantic-type-caption-line-height) var(--ff);' +
    '--f-cap-s:var(--cc-semantic-type-caption-weight-strong) var(--cc-semantic-type-caption-size)/var(--cc-semantic-type-caption-line-height) var(--ff);' +
    '--f-bsm:var(--cc-semantic-type-body-sm-weight) var(--cc-semantic-type-body-sm-size)/var(--cc-semantic-type-body-sm-line-height) var(--ff);' +
    '--f-bmd:var(--cc-semantic-type-body-md-weight) var(--cc-semantic-type-body-md-size)/var(--cc-semantic-type-body-md-line-height) var(--ff);' +
    '--f-lsm:var(--cc-semantic-type-label-sm-weight) var(--cc-semantic-type-label-sm-size)/var(--cc-semantic-type-label-sm-line-height) var(--ff);' +
    '--f-lsm-s:var(--cc-semantic-type-label-sm-weight-strong) var(--cc-semantic-type-label-sm-size)/var(--cc-semantic-type-label-sm-line-height) var(--ff);' +
    '--f-lmd:var(--cc-semantic-type-label-md-weight) var(--cc-semantic-type-label-md-size)/var(--cc-semantic-type-label-md-line-height) var(--ff);' +
    '--f-lmd-s:var(--cc-semantic-type-label-md-weight-strong) var(--cc-semantic-type-label-md-size)/var(--cc-semantic-type-label-md-line-height) var(--ff);' +
    '--f-llg:var(--cc-semantic-type-label-lg-weight) var(--cc-semantic-type-label-lg-size)/var(--cc-semantic-type-label-lg-line-height) var(--ff);' +
    '--f-llg-s:var(--cc-semantic-type-label-lg-weight-strong) var(--cc-semantic-type-label-lg-size)/var(--cc-semantic-type-label-lg-line-height) var(--ff);' +
    '--f-hxs:var(--cc-semantic-type-heading-xs-weight-strong) var(--cc-semantic-type-heading-xs-size)/var(--cc-semantic-type-heading-xs-line-height) var(--ff);' +
    '--f-hsm:var(--cc-semantic-type-heading-sm-weight-strong) var(--cc-semantic-type-heading-sm-size)/var(--cc-semantic-type-heading-sm-line-height) var(--ff);' +
    '--f-hmd:var(--cc-semantic-type-heading-md-weight-strong) var(--cc-semantic-type-heading-md-size)/var(--cc-semantic-type-heading-md-line-height) var(--ff);' +
    '--f-hlg:var(--cc-semantic-type-heading-lg-weight-strong) var(--cc-semantic-type-heading-lg-size)/var(--cc-semantic-type-heading-lg-line-height) var(--ff);' +
    '--f-dsm:var(--cc-semantic-type-data-sm-weight) var(--cc-semantic-type-data-sm-size)/var(--cc-semantic-type-data-sm-line-height) var(--ff);' +
    '--ls-wide:var(--cc-semantic-type-label-sm-letter-spacing-wide);' +
    // cores de status: aberto = marca, resolvido = sucesso
    '--st-open:var(--brand);--st-done:var(--ok)}';
  // Base comum às duas raízes (quadro e janela principal)
  var DS_BASE = ':host{all:initial}' + DS_TOKENS + DS_ALIASES +
    '*{box-sizing:border-box;font-family:var(--ff)}' +
    'svg{fill:currentColor;flex:0 0 auto}' +
    'button,input,textarea,select{font-family:var(--ff);color:inherit}' +
    'button:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:var(--b2) solid var(--bd-foc);outline-offset:var(--s0)}' +
    // Button (DS): sm 32px · md 40px · raio 16 · primary/secondary/tertiary
    '.ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--s1);height:var(--s8);padding:0 var(--s3);border:0;border-radius:var(--r4);font:var(--f-lsm-s);white-space:nowrap;cursor:pointer;background:var(--brand-lo);color:var(--brand-lo-c);text-decoration:none;transition:background-color var(--mf)}' +
    '.ds-btn svg{width:var(--s4);height:var(--s4)}' +
    '.ds-btn:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}' +
    '.ds-btn[disabled]{pointer-events:none;background:var(--bg-dis);color:var(--c-dis)}';
  // Fonte DM Sans (@font-face não funciona dentro de Shadow DOM: vai no <head> da página)
  function loadDsFont() {
    if (document.getElementById('fb-ds-font')) return;
    var l = document.createElement('link');
    l.id = 'fb-ds-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300..700&display=swap';
    (document.head || document.documentElement).appendChild(l);
  }
  // Seta para selects (content-secondary do DS)
  var CHEVRON = 'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27><path fill=%27%23706657%27 d=%27M12 13.17 16.95 8.22 18.36 9.64 12 16 5.64 9.64 7.05 8.22z%27/></svg>") no-repeat right 10px center/16px 16px';
  var CHECKMARK = 'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27><path fill=%27white%27 d=%27M10 15.17 19.19 5.98 20.61 7.39 10 18 3.64 11.64 5.05 10.22z%27/></svg>") no-repeat center/12px 12px';

  var CANVAS_CSS = DS_BASE +
    // destaque do elemento no modo comentar (cor de foco do DS)
    '.hl{position:fixed;border:var(--b2) solid var(--bd-foc);background:color-mix(in srgb,var(--bd-foc) 10%,transparent);border-radius:var(--r1);pointer-events:none;display:none;transition:all .06s}' +
    // posição por transform (não recalcula o layout do site a cada movimento); "scale" separado para o destaque
    '.pins{position:absolute;left:0;top:0;width:100%;height:0;overflow-x:clip;overflow-y:visible}' +
    '.pin{position:absolute;left:0;top:0;width:var(--s7);height:var(--s7);margin:calc(var(--s7) * -1) 0 0 0;border-radius:var(--s7) var(--s7) var(--s7) var(--s0);color:var(--c-inv);font:var(--f-lsm-s);line-height:var(--s6);text-align:center;pointer-events:auto;cursor:pointer;box-shadow:var(--sh3);border:var(--b2) solid var(--bd-ko);transition:scale var(--mf);will-change:transform}' +
    '.pin.fx,.pin.draft{position:fixed}' +
    '.pin.new{background:var(--bd-foc)}.pin.hot{scale:1.3}' +
    // cartão do comentário (popover)
    '.card{position:fixed;width:300px;max-width:calc(100vw - var(--s4));background:var(--bg-pri);color:var(--c-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);box-shadow:var(--sh3);padding:var(--s4);pointer-events:auto;font:var(--f-bsm)}' +
    '.card textarea,.card input{display:block;width:100%;border:var(--b1) solid var(--bd-sec);border-radius:var(--r3);padding:var(--s2) var(--s3);font:var(--f-bsm);color:var(--c-pri);background:var(--bg-pri);margin-bottom:var(--s3);resize:vertical;outline:0}' +
    '.card textarea:focus,.card input:focus{border-color:var(--bd-str)}.card textarea::placeholder,.card input::placeholder{color:var(--c-ph)}' +
    '.card .row{display:flex;gap:var(--s2);justify-content:flex-end;align-items:center}' +
    '.card select{-webkit-appearance:none;-moz-appearance:none;appearance:none;border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);height:var(--s8);padding:0 var(--s8) 0 var(--s3);font:var(--f-lsm-s);margin-right:auto;cursor:pointer;background:var(--bg-pri) ' + CHEVRON + '}' +
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--s1);height:var(--s8);padding:0 var(--s3);border:0;border-radius:var(--r4);font:var(--f-lsm-s);cursor:pointer;background:var(--brand-lo);color:var(--brand-lo-c);white-space:nowrap}' +
    '.btn:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}.btn svg{width:var(--s4);height:var(--s4)}' +
    '.btn.primary{background-color:var(--brand);color:var(--brand-c)}.btn.primary:hover,.btn.ok:hover,.btn.danger:hover{background-image:linear-gradient(var(--hov-inv),var(--hov-inv))}' +
    '.btn.ok{background-color:var(--ok);color:var(--ok-c);margin-right:auto}.btn.reopen{margin-right:auto}' +
    '.btn[disabled]{pointer-events:none;background:var(--bg-dis);color:var(--c-dis)}' +
    '.meta{color:var(--c-ter);font:var(--f-cap);margin-bottom:var(--s2)}' +
    '.body{font:var(--f-bsm);color:var(--c-pri);white-space:pre-wrap;word-wrap:break-word}' +
    '.shot{display:block;margin-top:var(--s3);border:var(--b1) solid var(--bd-pri);border-radius:var(--r3);overflow:hidden;background:var(--bg-sec)}' +
    '.shot img{display:block;width:100%;max-height:150px;object-fit:cover;object-position:center}' +
    '.shot.wait{height:var(--s12);display:flex;align-items:center;justify-content:center;font:var(--f-cap);color:var(--c-ter)}' +
    // respostas no formato do Chat balloon do DS
    '.thread{margin-top:var(--s3);max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:var(--s2)}.thread:empty{display:none}' +
    '.rp{background:var(--bg-sec);border-radius:var(--r4);padding:var(--s2) var(--s3)}' +
    '.rh{display:flex;align-items:center;gap:var(--s1);font:var(--f-cap);color:var(--c-ter);margin-bottom:var(--s1)}.rh b{color:var(--c-pri);font:var(--f-lsm-s)}' +
    '.rt{font:var(--f-bsm);white-space:pre-wrap;word-wrap:break-word}' +
    '.reply{display:flex;gap:var(--s2);align-items:flex-end;margin-top:var(--s3)}' +
    '.card .reply textarea{margin:0;flex:1;min-height:var(--s8);max-height:120px;resize:none;border-radius:var(--r4)}' +
    '.reply .btn{flex:0 0 auto}' +
    // Avatar do DS (cor por pessoa, vinda da paleta)
    '.av{display:inline-block;border-radius:var(--rp);font-weight:var(--cc-semantic-type-caption-weight-strong);text-align:center;vertical-align:middle;flex:0 0 auto;box-shadow:inset 0 0 0 var(--b1) var(--tint-lo-bd)}' +
    '.who{display:flex;align-items:center;gap:var(--s2);font:var(--f-bsm);color:var(--c-sec);margin-bottom:var(--s3)}.who b{color:var(--c-pri);font-weight:var(--cc-semantic-type-body-sm-weight-strong)}' +
    '.err{color:var(--crit-lo-c);font:var(--f-cap);margin:calc(var(--s2) * -1) 0 var(--s2);display:none}' +
    '.meta .av{margin-right:var(--s2)}' +
    '.meta{display:flex;align-items:center}.mt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta .ed{color:var(--c-ter);margin-left:var(--s1);flex:0 0 auto}' +
    '.own{margin-left:auto;display:flex;gap:var(--s0)}.own button{border:0;background:none;color:var(--c-sec);font:var(--f-lsm-s);cursor:pointer;padding:var(--s1) var(--s2);border-radius:var(--rp)}' +
    '.own button:hover{background:var(--hov);color:var(--c-pri)}.own .del:hover{color:var(--crit-lo-c)}' +
    '.edit textarea{margin-bottom:var(--s2)}.confirm{margin-top:var(--s3);padding:var(--s3);border-radius:var(--r3);background:var(--crit-lo);color:var(--c-pri);font:var(--f-bsm)}' +
    '.confirm .row{margin-top:var(--s2)}.btn.danger{background-color:var(--crit);color:var(--crit-c)}';

  var CHROME_CSS = DS_BASE +
    'button{font-family:var(--ff)}' +
    // botão flutuante (entrypoint do DS: único elemento com sombra forte)
    '.launch{position:fixed;right:var(--s5);bottom:var(--s5);display:flex;align-items:center;gap:var(--s2);background:var(--brand);color:var(--brand-c);border:0;border-radius:var(--rp);height:var(--s12);padding:0 var(--s5) 0 var(--s4);font:var(--f-llg-s);cursor:pointer;pointer-events:auto;box-shadow:var(--sh3)}' +
    '.launch:hover{background-image:linear-gradient(var(--hov-inv),var(--hov-inv))}' +
    '.launch svg{width:var(--s5);height:var(--s5)}' +
    '.launch .bd{background:var(--bg-pri);color:var(--neu-lo-c);border-radius:var(--rp);min-width:var(--s5);height:var(--s5);line-height:var(--s5);font:var(--f-lsm-s);line-height:var(--s5);text-align:center;padding:0 var(--s1)}' +
    // barra de boas-vindas (superfície inversa)
    '.bar{position:fixed;left:0;right:0;bottom:0;display:none;align-items:center;gap:var(--s5);padding:var(--s4) var(--s6);background:var(--bg-inv);color:var(--c-inv);pointer-events:auto;box-shadow:var(--sh3);font:var(--f-bsm)}' +
    '.bar.show{display:flex}.bar .bi{flex:0 0 var(--s10);height:var(--s10);border-radius:var(--r3);background:var(--tint-hi);display:flex;align-items:center;justify-content:center}.bar .bi svg{width:var(--s5);height:var(--s5);color:var(--c-inv)}' +
    '.bar .bt{flex:1;min-width:0}.bar .bt b{display:block;font:var(--f-hxs);margin-bottom:var(--s0)}.bar .bt span{color:var(--c-dis);font:var(--f-bsm)}' +
    '.bar .bgo{flex:0 0 auto;border:0;border-radius:var(--r4);background:var(--bg-pri);color:var(--neu-lo-c);font:var(--f-lmd-s);height:var(--s10);padding:0 var(--s4);cursor:pointer;display:flex;align-items:center;gap:var(--s2)}' +
    '.bar .bgo:hover{background-image:linear-gradient(var(--hov),var(--hov))}' +
    '.bar .bn{background:var(--brand);color:var(--brand-c);border-radius:var(--rp);min-width:var(--s5);height:var(--s5);font:var(--f-lsm-s);line-height:var(--s5);text-align:center;padding:0 var(--s1)}' +
    '.bar .bx{flex:0 0 auto;border:0;background:transparent;color:var(--neu-hi-c);cursor:pointer;width:var(--s8);height:var(--s8);border-radius:var(--rp);display:flex;align-items:center;justify-content:center}.bar .bx:hover{background:var(--hov-inv)}.bar .bx svg{width:var(--s4);height:var(--s4)}' +
    '@media (max-width:640px){.bar{flex-wrap:wrap;gap:var(--s3);padding:var(--s4)}.bar .bi{display:none}.bar .bt{flex:1 1 calc(100% - var(--s12))}.bar .bgo{flex:1;justify-content:center}}' +
    // tela de revisão
    '.shell{position:fixed;inset:0;display:none;grid-template-columns:var(--cc-primitives-dimension-8000) 1fr;grid-template-rows:var(--s14) 1fr var(--s16);background:var(--bg-pri);color:var(--c-pri);pointer-events:auto;font:var(--f-bsm)}' +
    '.shell.show{display:grid}' +
    '.side{grid-row:1/3;grid-column:1;border-right:var(--b1) solid var(--bd-pri);display:flex;flex-direction:column;min-height:0;background:var(--bg-srf)}' +
    '.sh{display:flex;align-items:center;gap:var(--s2);height:var(--s14);padding:0 var(--s4);border-bottom:var(--b1) solid var(--bd-pri);font:var(--f-hxs)}' +
    '.sh svg{width:var(--s5);height:var(--s5)}.sh .n{margin-left:auto;background:var(--brand);color:var(--brand-c);border-radius:var(--rp);min-width:var(--s5);height:var(--s5);font:var(--f-lsm-s);line-height:var(--s5);text-align:center;padding:0 var(--s1)}' +
    '.sbody{padding:var(--s4);display:flex;flex-direction:column;gap:var(--s3);border-bottom:var(--b1) solid var(--bd-pri)}' +
    // Input do DS
    '.search{display:flex;align-items:center;gap:var(--s2);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);height:var(--s10);padding:0 var(--s3);background:var(--bg-pri)}' +
    '.search:focus-within{border-color:var(--bd-str)}' +
    '.search svg{width:var(--s5);height:var(--s5);color:var(--c-sec)}.search input{border:0;outline:0;font:var(--f-bsm);color:var(--c-pri);flex:1;min-width:0;background:transparent}.search input::placeholder{color:var(--c-ph)}' +
    '.lab{display:flex;justify-content:space-between;font:var(--f-lsm-s);color:var(--c-ter);letter-spacing:var(--ls-wide);text-transform:uppercase}' +
    '.lab a{color:var(--c-pri);cursor:pointer;text-decoration:underline}' +
    '.stgrid{display:grid;grid-template-columns:1fr 1fr;gap:var(--s2)}' +
    '.stc{display:flex;align-items:center;gap:var(--s2);border:var(--b1) solid var(--bd-pri);background:var(--bg-pri);border-radius:var(--rp);padding:var(--s2) var(--s3);font:var(--f-lsm-s);cursor:pointer;color:var(--c-sec);text-align:left}' +
    '.stc i{width:var(--s2);height:var(--s2);border-radius:var(--rp);flex:0 0 var(--s2)}.stc b{margin-left:auto;color:var(--c-ter)}' +
    '.stc.on{background:var(--brand-lo);color:var(--brand-lo-c);border-color:var(--bd-str)}' +
    '.sth{display:flex;align-items:center;gap:var(--s2);margin:var(--s3) var(--s1) var(--s0);padding:var(--s2);border-bottom:var(--b1) solid var(--bd-pri);font:var(--f-lsm-s);letter-spacing:var(--ls-wide);text-transform:uppercase;cursor:pointer;user-select:none}' +
    '.sth i{width:var(--s2);height:var(--s2);border-radius:var(--rp)}.sth .n{margin-left:auto;color:var(--c-ter)}.sth .car{display:inline-flex;color:var(--c-ter)}' +
    '.sth.first{margin-top:var(--s0)}' +
    '.car{display:inline-flex;width:var(--s4);height:var(--s4);flex:0 0 var(--s4)}.car svg{width:var(--s4);height:var(--s4)}' +
    // botão terciário (sucesso) "Mostrar resolvidos"
    '.showres{display:flex;align-items:center;gap:var(--s2);margin:var(--s0) 0 var(--s2) var(--s2);height:var(--s8);padding:0 var(--s3) 0 var(--s2);border:0;background:transparent;border-radius:var(--r4);font:var(--f-lsm-s);color:var(--ok-lo-c);cursor:pointer}' +
    '.showres:hover{background:var(--hov)}.showres i{width:var(--s2);height:var(--s2);border-radius:var(--rp);background:var(--ok)}.showres .car{color:var(--ok-lo-c)}' +
    '.noopen{margin:var(--s1) 0 var(--s0) var(--s2);padding:var(--s2);font:var(--f-bsm);color:var(--c-ter)}' +
    '.qa{position:absolute;right:var(--s2);bottom:var(--s2);border:var(--b1) solid var(--bd-sec);background:var(--bg-pri);border-radius:var(--rp);height:var(--s6);padding:0 var(--s2);font:var(--f-lsm-s);cursor:pointer;color:var(--c-pri);opacity:0;transition:opacity var(--mf)}' +
    '.qa:hover{background-image:linear-gradient(var(--hov),var(--hov))}' +
    '.item{position:relative}.ifoot:empty{display:none}' +
    '.rcount{display:inline-flex;align-items:center;gap:var(--s1);font:var(--f-cap);color:var(--c-ter)}.rcount svg{width:14px;height:14px}' +
    '.item:hover .qa,.item:focus-within .qa{opacity:1}.qa.res:hover{border-color:var(--ok);color:var(--ok-lo-c)}' +
    // Segmented control do DS
    '.seg{display:flex;border:var(--b1) solid var(--bd-sec);border-radius:var(--rp);padding:var(--s1);gap:0;background:var(--bg-pri)}' +
    '.seg button{flex:1;border:0;background:transparent;border-radius:var(--rp);height:var(--s8);padding:0 var(--s3);font:var(--f-lmd);color:var(--c-ter);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:var(--s2);transition:background-color var(--mf),color var(--mf)}' +
    '.seg button:hover{color:var(--c-sec)}.seg button svg{width:var(--s4);height:var(--s4)}.seg button.on{background:var(--tint-lo);color:var(--c-pri)}' +
    '.idev{margin-left:auto;color:var(--c-ter);display:flex;align-items:center;gap:var(--s1);font:var(--f-cap);white-space:nowrap}.idev svg{width:14px;height:14px}' +
    // Checkbox do DS
    '.chk{display:flex;align-items:center;gap:var(--s2);font:var(--f-bsm);color:var(--c-pri);cursor:pointer;user-select:none}' +
    '.chk input{-webkit-appearance:none;appearance:none;margin:0;width:var(--s4);height:var(--s4);flex:0 0 var(--s4);border:var(--b2) solid var(--neu-lo-c);border-radius:var(--r1);background:transparent;cursor:pointer}' +
    '.chk input:checked{background:var(--neu-lo-c) ' + CHECKMARK + '}.chk input:focus-visible{outline:var(--b1) solid var(--bd-foc);outline-offset:2px}' +
    '.groups{flex:1;overflow:auto;padding:var(--s2) var(--s2) var(--s4)}' +
    '.bph{display:flex;align-items:center;gap:var(--s2);padding:var(--s3) var(--s2) var(--s2);font:var(--f-lsm-s);letter-spacing:var(--ls-wide);text-transform:uppercase;color:var(--c-pri);cursor:pointer;user-select:none}' +
    '.bph svg{width:var(--s4);height:var(--s4)}.bph .n{margin-left:auto;color:var(--c-ter)}.bph .cur{font:var(--f-cap-s);color:var(--brand-lo-c);text-transform:none;letter-spacing:0;background:var(--tint-lo);padding:0 var(--s2);border-radius:var(--rp)}' +
    '.bph.empty{color:var(--c-dis);cursor:default}' +
    // cabeçalho de página (Menu item do DS)
    '.pgh{display:flex;align-items:center;gap:var(--s2);min-height:var(--s8);padding:var(--s1) var(--s2);margin-top:var(--s1);font:var(--f-lsm-s);color:var(--c-sec);letter-spacing:var(--ls-wide);cursor:pointer;user-select:none;border-radius:var(--r2)}' +
    '.pgh:hover{background:var(--hov)}.pgh .car{color:var(--c-ter)}.pgh .n{margin-left:auto;color:var(--c-ter)}' +
    '.pgh.cur{color:var(--c-pri)}' +
    // item de comentário
    '.item{display:flex;gap:var(--s3);margin:var(--s1) 0 var(--s2) var(--s2);padding:var(--s3);border-radius:var(--r3);background:var(--bg-pri);border:var(--b1) solid var(--bd-pri);cursor:pointer;transition:border-color var(--mf),background-color var(--mf)}' +
    '.item:hover{border-color:var(--bd-sec);background-image:linear-gradient(var(--hov),var(--hov))}' +
    '.num{flex:0 0 var(--s6);height:var(--s6);border-radius:var(--s6) var(--s6) var(--s6) var(--s0);color:var(--c-inv);font:var(--f-lsm-s);line-height:var(--s6);text-align:center}' +
    '.ic{flex:1;min-width:0}' +
    '.it{display:flex;gap:var(--s2);align-items:center}.it b{font:var(--f-lmd-s);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.it span{color:var(--c-ter);font:var(--f-cap);white-space:nowrap}' +
    '.itx{margin-top:var(--s1);font:var(--f-bsm);color:var(--c-sec);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-wrap:break-word}' +
    '.item.done .itx{color:var(--c-ter);text-decoration:line-through}' +
    '.item.done{opacity:.55;transition:opacity var(--mf),border-color var(--mf)}.item.done:hover{opacity:1}' +
    '.ifoot{display:flex;align-items:center;gap:var(--s2);margin-top:var(--s2)}' +
    '.pill{display:inline-flex;align-items:center;gap:var(--s1);font:var(--f-lsm-s);color:var(--c-sec)}.pill i{width:var(--s2);height:var(--s2);border-radius:var(--rp)}' +
    // Tag do DS (amarela, discreta, com status light)
    '.chip{display:inline-flex;align-items:center;gap:var(--s1);font:var(--f-lsm);border-radius:var(--rp);padding:var(--s0) var(--s2);background:var(--warn-lo);color:var(--warn-lo-c)}.chip::before{content:"";width:var(--s1);height:var(--s1);border-radius:var(--rp);background:currentColor}' +
    '.empty{padding:var(--s10) var(--s4);text-align:center;color:var(--c-ter);font:var(--f-bsm)}.empty b{color:var(--c-pri)}' +
    // topo
    '.top{grid-column:2;grid-row:1;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:var(--s3);border-bottom:var(--b1) solid var(--bd-pri);padding:0 var(--s4);position:relative}' +
    '.tc{grid-column:2;display:flex;align-items:center;gap:var(--s3)}' +
    '.devs{display:flex;gap:0;border:var(--b1) solid var(--bd-sec);border-radius:var(--rp);padding:var(--s1)}' +
    '.dev{border:0;background:transparent;color:var(--c-ter);border-radius:var(--rp);width:var(--s8);height:var(--s8);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background-color var(--mf),color var(--mf)}' +
    '.dev svg{width:var(--s4);height:var(--s4)}.dev.on{background:var(--tint-lo);color:var(--c-pri)}.dev:hover{color:var(--c-sec)}' +
    '.vsep{width:var(--b1);height:var(--s6);background:var(--bd-pri)}' +
    '.wbox{display:flex;align-items:center;gap:var(--s2);color:var(--c-ter);font:var(--f-cap)}' +
    '.wbox input{width:80px;height:var(--s10);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:0 var(--s2);font:var(--f-bsm);color:var(--c-pri);text-align:center;outline:0;-moz-appearance:textfield}' +
    '.wbox input:focus,.top select:focus{border-color:var(--bd-str)}' +
    '.wbox input::-webkit-inner-spin-button,.wbox input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}' +
    '.top select{-webkit-appearance:none;appearance:none;height:var(--s10);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:0 var(--s8) 0 var(--s3);font:var(--f-bsm);color:var(--c-pri);outline:0;cursor:pointer;background:var(--bg-pri) ' + CHEVRON + '}' +
    '.tr{grid-column:3;justify-self:end;position:relative;display:flex;gap:var(--s2);align-items:center}' +
    // Aprovar: botão secundário de sucesso (vira primário quando aprovado)
    '.appr{display:flex;align-items:center;gap:var(--s1);border:0;background:var(--ok-lo);color:var(--ok-lo-c);border-radius:var(--r4);height:var(--s8);padding:0 var(--s3);font:var(--f-lsm-s);cursor:pointer}' +
    '.appr:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}.appr.on{background-color:var(--ok);color:var(--ok-c)}.appr.on:hover{background-image:linear-gradient(var(--hov-inv),var(--hov-inv))}.appr svg{width:var(--s4);height:var(--s4)}' +
    '.apop{position:absolute;right:0;top:calc(var(--s10) + var(--s1));width:300px;background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);box-shadow:var(--sh2);padding:var(--s4);font:var(--f-bsm);color:var(--c-sec);z-index:3;display:none}' +
    '.apop.show{display:block}.apop p{margin:0 0 var(--s4)}.apop p b{color:var(--c-pri)}.apop .r{display:flex;gap:var(--s2);justify-content:flex-end}' +
    '.apop button{border:0;border-radius:var(--r4);height:var(--s8);padding:0 var(--s3);font:var(--f-lsm-s);cursor:pointer;background:transparent;color:var(--brand-lo-c)}' +
    '.apop button:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}' +
    '.apop .ok{background-color:var(--brand);color:var(--brand-c)}.apop .ok:hover{background-image:linear-gradient(var(--hov-inv),var(--hov-inv))}.apop .undo{background-color:var(--crit-lo);color:var(--crit-lo-c)}' +
    '.apb{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:var(--s4);height:var(--s4);border-radius:var(--rp);background:var(--ok);color:var(--ok-c)}.apb svg{width:12px;height:12px}' +
    '.pgh .pl{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pgh .n{flex:0 0 auto}' +
    // comentário geral: botão secundário do DS
    '.gnew{display:flex;align-items:center;justify-content:center;gap:var(--s2);margin:var(--s1) 0 var(--s2) var(--s2);height:var(--s8);padding:0 var(--s3);border:0;background:var(--brand-lo);border-radius:var(--r4);font:var(--f-lsm-s);color:var(--brand-lo-c);cursor:pointer;width:calc(100% - var(--s2))}' +
    '.gnew:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}.gnew svg{width:var(--s4);height:var(--s4)}' +
    '.num.g{font-size:11px;letter-spacing:-.02em}' +
    '.apline{margin:0 0 var(--s2) var(--s2);padding:var(--s1) var(--s2);border-radius:var(--r2);background:var(--ok-lo);font:var(--f-cap);color:var(--ok-lo-c)}' +
    '.exit{display:flex;align-items:center;gap:var(--s1);border:0;background:var(--brand-lo);color:var(--brand-lo-c);border-radius:var(--r4);height:var(--s8);padding:0 var(--s3);font:var(--f-lsm-s);cursor:pointer}' +
    '.exit:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}.exit svg{width:var(--s4);height:var(--s4)}' +
    // palco
    '.stage{grid-column:2;grid-row:2;background:var(--bg-ter);overflow:hidden;position:relative;display:flex;justify-content:center;align-items:flex-start;padding:var(--s4)}' +
    '.fwrap{position:relative;transform-origin:top center;flex:0 0 auto}' +
    '.fwrap iframe{display:block;border:0;background:var(--bg-pri);border-radius:var(--r2);box-shadow:var(--sh2);outline:var(--b2) solid transparent;outline-offset:var(--s0);transition:outline-color var(--mf)}' +
    '.fwrap.commenting iframe{outline-color:var(--bd-foc)}' +
    '.scale{position:absolute;left:var(--s3);bottom:var(--s3);font:var(--f-cap);color:var(--c-sec);background:var(--bg-pri);border:var(--b1) solid var(--bd-pri);border-radius:var(--rp);padding:var(--s0) var(--s2);display:none}' +
    // rodapé
    '.foot{grid-column:1/3;grid-row:3;display:flex;align-items:center;justify-content:center;border-top:var(--b1) solid var(--bd-pri);position:relative;background:var(--bg-pri)}' +
    '.fcount{position:absolute;left:var(--s4);display:flex;align-items:center;gap:var(--s2);border:var(--b1) solid var(--bd-sec);border-radius:var(--rp);height:var(--s10);padding:0 var(--s4);font:var(--f-lmd-s)}' +
    '.fcount svg{width:var(--s4);height:var(--s4)}' +
    // Toggle do DS (lg) com rótulos
    '.mode{display:flex;align-items:center;gap:var(--s3);font:var(--f-llg);color:var(--c-ter);cursor:pointer;user-select:none}' +
    '.mode .on{color:var(--c-pri);font-weight:var(--cc-semantic-type-label-lg-weight-strong)}.mode .sw{width:var(--cc-primitives-dimension-1100);height:var(--s6);border-radius:var(--rp);background:var(--bg-ter);position:relative;transition:background-color var(--mf) cubic-bezier(.4,0,.2,1)}' +
    '.mode .sw::after{content:"";position:absolute;top:var(--s0);left:var(--s0);width:var(--s5);height:var(--s5);border-radius:var(--rp);background:var(--bg-pri);box-shadow:var(--sh1);transition:transform var(--mf) cubic-bezier(.4,0,.2,1)}' +
    '.mode.cm .sw{background:var(--ok)}.mode.cm .sw::after{transform:translateX(var(--s5));box-shadow:none}' +
    '.hint{position:absolute;right:var(--s14);font:var(--f-cap);color:var(--c-ter)}' +
    '.help{position:absolute;right:var(--s4);width:var(--s8);height:var(--s8);border-radius:var(--rp);border:0;background:var(--brand-lo);color:var(--brand-lo-c);font:var(--f-lmd-s);cursor:pointer}.help:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}' +
    // tutorial: balões no estilo Tooltip do DS (superfície inversa)
    '.tour{position:fixed;inset:0;z-index:5;pointer-events:auto;display:none}.tour.show{display:block}' +
    '.tspot{position:fixed;border-radius:var(--r3);box-shadow:0 0 0 9999px var(--bg-bkd);transition:all .25s ease;pointer-events:none;outline:var(--b2) solid var(--bd-foc);outline-offset:var(--s0)}' +
    '.tbox{position:fixed;width:320px;max-width:calc(100vw - var(--s6));background:var(--bg-inv);color:var(--c-inv);border-radius:var(--r4);box-shadow:var(--sh3);padding:var(--s5);transition:top .25s ease,left .25s ease}' +
    '.tbox .ts{font:var(--f-lsm-s);color:var(--c-ter);letter-spacing:var(--ls-wide);text-transform:uppercase;margin-bottom:var(--s2)}' +
    '.tbox h4{margin:0 0 var(--s1);font:var(--f-hxs)}.tbox p{margin:0 0 var(--s4);color:var(--c-dis);font:var(--f-bsm)}' +
    '.tbox .tr2{display:flex;align-items:center;gap:var(--s2)}.tbox .dots{display:flex;gap:var(--s1);margin-right:auto}.tbox .dots i{width:var(--s2);height:var(--s2);border-radius:var(--rp);background:var(--tint-hi)}.tbox .dots i.on{background:var(--c-inv);width:var(--s4)}' +
    '.tbox button{border:0;border-radius:var(--r4);height:var(--s8);padding:0 var(--s3);font:var(--f-lsm-s);cursor:pointer;background:transparent;color:var(--neu-hi-c);box-shadow:inset 0 0 0 var(--b1) var(--cc-semantic-theme-palette-tinted-high-border)}' +
    '.tbox button:hover{background:var(--hov-inv)}' +
    '.tbox .tn{background:var(--bg-pri);color:var(--neu-lo-c);box-shadow:none}.tbox .tn:hover{background:var(--bg-pri);background-image:linear-gradient(var(--hov),var(--hov))}.tbox .tk{box-shadow:none;padding:0 var(--s2)}' +
    '.av{display:inline-block;border-radius:var(--rp);font-weight:var(--cc-semantic-type-caption-weight-strong);text-align:center;flex:0 0 auto;box-shadow:inset 0 0 0 var(--b1) var(--tint-lo-bd)}' +
    '.it .av{margin-right:var(--s0)}' +
    // janela de nome: Dialog do DS
    '.gate{position:fixed;inset:0;background:var(--bg-bkd);display:none;align-items:center;justify-content:center;pointer-events:auto;z-index:2}' +
    '.gate.show{display:flex}' +
    '.gbox{width:440px;max-width:calc(100vw - var(--s8));background:var(--bg-pri);color:var(--c-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r6);padding:var(--s10)}' +
    '.gbox h3{margin:0 0 var(--s3);font:var(--f-hmd)}.gbox p{margin:0 0 var(--s6);color:var(--c-sec);font:var(--f-bmd)}' +
    '.gbox input{width:100%;border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:var(--s4);font:var(--f-bmd);color:var(--c-pri);outline:0;background:var(--bg-pri)}.gbox input:focus{border-color:var(--bd-str)}.gbox input::placeholder{color:var(--c-ph)}' +
    '.gbox .gerr{color:var(--crit-lo-c);font:var(--f-bsm);margin-top:var(--s2);padding-left:var(--s2);display:none}' +
    '.gbox .grow{display:flex;gap:var(--s2);justify-content:flex-end;margin-top:var(--s8)}' +
    '.gbox .gb{border:0;border-radius:var(--r4);height:var(--s10);padding:0 var(--s4);font:var(--f-lmd-s);cursor:pointer;background:transparent;color:var(--brand-lo-c)}' +
    '.gbox .gb:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}' +
    '.gbox .gb.ok{background-color:var(--brand);color:var(--brand-c)}.gbox .gb.ok:hover{background-image:linear-gradient(var(--hov-inv),var(--hov-inv))}' +
    '.me{position:absolute;left:250px;display:flex;align-items:center;gap:var(--s2);font:var(--f-bsm);color:var(--c-sec)}.me b{color:var(--c-pri);font-weight:var(--cc-semantic-type-body-sm-weight-strong)}.me a{color:var(--c-pri);text-decoration:underline;cursor:pointer}.me a:hover{color:var(--c-sec)}';

  function makeRoot(css, hostStyle) {
    loadDsFont();
    var host = document.createElement('div');
    host.id = 'fb-reviewer-root';
    host.style.cssText = hostStyle || 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + css + '</style>';
    return { host: host, root: root };
  }

  // ==================================================================
  // CANVAS — dentro do quadro: pins, cartões e modo comentar
  // ==================================================================
  if (IS_FRAME) {
    // Raiz no canto da página (não fixa): os pins ficam em coordenadas da página e rolam junto
    // com o site sem JavaScript. Cartão, destaque e pins de elementos fixos usam position:fixed.
    var R = makeRoot(CANVAS_CSS, 'position:absolute;left:0;top:0;width:100%;height:0;z-index:2147483647;pointer-events:none;'), host = R.host, root = R.root;
    var emit = function (evt, data) { window.parent.postMessage(Object.assign({ fb: 'evt', evt: evt }, data || {}), location.origin); };
    var hl = document.createElement('div'); hl.className = 'hl'; root.appendChild(hl);
    var pinsEl = document.createElement('div'); pinsEl.className = 'pins'; root.appendChild(pinsEl);
    var st = { mode: false, all: [], comments: [], nums: {}, path: location.pathname, bp: bpOf(innerWidth), filter: null, draft: null, open: null, hot: null };
    var card = null;

    var fromUI = function (e) { return e.composedPath().indexOf(host) !== -1; };
    var screenComments = function () {
      return st.all.filter(function (c) { return c.path === st.path && (isGeneral(c) || (c.device || 'desktop') === st.bp); });
    };
    var setMode = function (on) {
      st.mode = !!on;
      document.documentElement.style.cursor = st.mode ? 'crosshair' : '';
      if (!st.mode) hl.style.display = 'none';
      emit('mode', { on: st.mode });
    };
    document.addEventListener('mousemove', function (e) {
      if (!st.mode || fromUI(e) || st.draft) return;
      var r = e.target.getBoundingClientRect();
      Object.assign(hl.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    }, true);
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (!st.mode || fromUI(e)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (type === 'click' && !st.draft) startDraft(e.target, e.clientX, e.clientY);
      }, true);
    });

    var closeCard = function () { if (card) card.remove(); card = null; st.draft = null; st.open = null; renderPins(); };
    var placeCard = function (x, y) {
      var w = Math.min(300, innerWidth - 16), h = card.offsetHeight || 190;
      var l = Math.min(Math.max(8, x + 12), innerWidth - w - 8) + 'px', t = Math.min(Math.max(8, y - 10), innerHeight - h - 8) + 'px';
      if (card.style.left !== l) card.style.left = l;
      if (card.style.top !== t) card.style.top = t;
    };
    var startDraft = function (target, x, y) {
      closeCard();
      var general = !target;
      st.draft = general ? { anchor: { kind: 'page' }, el: null } : { anchor: buildAnchor(target, x, y), el: target };
      hl.style.display = 'none';
      card = document.createElement('div');
      card.className = 'card';
      var me = identity();
      card.innerHTML =
        '<div class="meta"></div>' +
        (me ? '<div class="who">' + avatarHTML(me.name, 22) + '<span>Comentando como <b>' + esc(me.name) + '</b></span></div>' : '') +
        '<textarea rows="3" placeholder="Escreva seu comentário…"></textarea>' +
        (me ? '' : '<div class="who" style="margin:0 0 var(--s2)">Qual é o seu nome?</div>' +
          '<input class="name" placeholder="Seu nome" autocomplete="name">' +
          '<div class="err"></div>') +
        '<div class="row"><button class="btn cancel">Cancelar</button><button class="btn primary send">Enviar</button></div>';
      card.querySelector('.meta').textContent = general ? 'Comentário geral · ' + pageLabel(st.path) + ' · todos os dispositivos' : 'Novo comentário · ' + BP_LABEL[st.bp] + ' ' + innerWidth + 'px · ' + pageLabel(st.path);
      if (general) card.querySelector('textarea').placeholder = 'Comentário sobre a página inteira…';
      root.appendChild(card);
      if (general) placeCard(Math.max(8, (innerWidth - 300) / 2) - 12, 90); else placeCard(x, y);
      renderPins();
      card.querySelector('textarea').focus();
      card.querySelector('.cancel').onclick = closeCard;
      card.querySelector('.send').onclick = submit;
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.repeat) { e.preventDefault(); submit(); }
        if (e.key === 'Escape') closeCard();
        e.stopPropagation();
      });
    };
    // ---------- Print automático do comentário ----------
    var SHOT_LIB = CFG.base + '/vendor/modern-screenshot.js'; // modern-screenshot 4.7.0, servido pela própria função
    var shotLib = null;
    var loadShotLib = function () {
      if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
      if (shotLib) return shotLib;
      shotLib = new Promise(function (ok, fail) {
        var sc = document.createElement('script');
        sc.src = SHOT_LIB; sc.async = true;
        sc.onload = function () { window.modernScreenshot ? ok(window.modernScreenshot) : fail(new Error('lib')); };
        sc.onerror = function () { shotLib = null; fail(new Error('lib')); };
        document.head.appendChild(sc);
      });
      return shotLib;
    };
    // Sobe na árvore até achar um bloco com tamanho razoável para dar contexto ao print
    var shotContext = function (el) {
      var ctx = el, best = el;
      while (ctx && ctx !== document.body && ctx !== document.documentElement) {
        var r = ctx.getBoundingClientRect();
        if (r.height > 1600 || r.width > 2600) break;
        best = ctx;
        if (r.height >= 260 && r.width >= 320) break;
        ctx = ctx.parentElement;
      }
      return best;
    };
    var captureShot = function (c, el, anchor) {
      if (!el || !el.isConnected) return;
      var ctxEl = shotContext(el);
      var cr = ctxEl.getBoundingClientRect(), er = el.getBoundingClientRect();
      if (!cr.width || !cr.height) return;
      var px = er.left + er.width * anchor.rel.x - cr.left, py = er.top + er.height * anchor.rel.y - cr.top;
      var bg = getComputedStyle(document.body).backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = '#ffffff';
      loadShotLib().then(function (ms) {
        return ms.domToCanvas(ctxEl, {
          scale: 1, backgroundColor: bg, timeout: 8000,
          filter: function (n) { return n !== host; },
        });
      }).then(function (cv) {
        // recorte de até 800×500 centrado no ponto do comentário
        var W = Math.min(800, cv.width), H = Math.min(500, cv.height);
        var sx = Math.max(0, Math.min(cv.width - W, px - W / 2)), sy = Math.max(0, Math.min(cv.height - H, py - H / 2));
        var out = document.createElement('canvas'); out.width = W; out.height = H;
        var g = out.getContext('2d');
        g.fillStyle = bg; g.fillRect(0, 0, W, H);
        g.drawImage(cv, sx, sy, W, H, 0, 0, W, H);
        // marca do pin
        var mx = px - sx, my = py - sy;
        g.beginPath(); g.arc(mx, my, 13, 0, Math.PI * 2); g.fillStyle = getComputedStyle(host).getPropertyValue('--cc-primitives-color-solid-tinted-on-light-950').trim() || '#2c2821'; g.fill();
        g.lineWidth = 3; g.strokeStyle = '#ffffff'; g.stroke();
        g.fillStyle = '#ffffff'; g.font = '600 12px "DM Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(st.nums[c.id] || ''), mx, my + 0.5);
        var data = out.toDataURL('image/jpeg', 0.78);
        return api('/api/comments/' + encodeURIComponent(c.id) + '/screenshot', { method: 'POST', body: JSON.stringify({ image: data }) });
      }).then(function (r) {
        if (r && r.url) {
          c.screenshot = r.url;
          if (st.open === c.id && card) { var sh = card.querySelector('.shot'); if (sh) { sh.className = 'shot'; sh.innerHTML = '<img alt="Print do comentário" src="' + esc(r.url) + '">'; sh.href = r.url; } }
          emit('changed', {});
        }
      }).catch(function () { c._shotFailed = true; });
    };

    var submit = function () {
      var text = card.querySelector('textarea').value.trim();
      if (!text) return card.querySelector('textarea').focus();
      var me = identity();
      if (!me) {
        var nm = card.querySelector('.name').value.trim();
        var err = card.querySelector('.err');
        if (!nm) { err.textContent = 'Informe seu nome.'; err.style.display = 'block'; return card.querySelector('.name').focus(); }
        saveIdentity(nm, null); me = { name: nm };
        emit('identity', {});
      }
      var d = st.draft;
      if (!d || d.sending) return;           // evita criar o mesmo comentário duas vezes (duplo clique / Enter repetido)
      d.sending = true;
      var sb = card.querySelector('.send'); if (sb) { sb.disabled = true; sb.textContent = 'Enviando…'; }
      var failed = function () { d.sending = false; if (sb && sb.isConnected) { sb.disabled = false; sb.textContent = 'Enviar'; } };
      api('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          path: st.path, text: text, author: me.name, authorEmail: me.email || null, anchor: d.anchor,
          viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
          device: st.bp, userAgent: navigator.userAgent,
        }),
      }).then(function (c) {
        if (!c || c.error) return failed();
        c._el = d.el; c._via = 'new';
        st.all.push(c);
        closeCard(); setMode(false); refresh();
        emit('changed', {});
        if (!d.el) return;
        c._shooting = true;
        setTimeout(function () { captureShot(c, d.el, d.anchor); }, 60);
      }).catch(failed);
    };

    // Comentário sem âncora: a busca varre a página, então espera cada vez mais entre tentativas
    // (0,5 s, 1 s, 2 s… até 30 s). Troca de página ou elemento que some zeram a espera.
    var ensureResolved = function (c) {
      if (isGeneral(c)) return null;
      if (c._el && c._el.isConnected) return c._el;
      if (c._el) { c._el = null; c._tries = 0; c._next = 0; }
      var now = Date.now();
      if (c._next && now < c._next) return null;
      var r = resolve(c.anchor);
      c._el = r ? r.el : null; c._via = r ? r.via : null;
      if (r) { c._tries = 0; c._next = 0; c._fx = fixedCtx(r.el); }
      else { c._tries = (c._tries || 0) + 1; c._next = now + Math.min(30000, 250 * Math.pow(2, c._tries)); }
      return c._el;
    };
    // Elemento dentro de algo fixo/grudado (menu fixo, sticky): o pin fica na camada fixa;
    // o grudado ainda precisa seguir a rolagem por JS
    var fixedCtx = function (el) {
      for (var n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
        var p = getComputedStyle(n).position;
        if (p === 'fixed' || p === 'sticky') return p;
      }
      return false;
    };
    var resetAnchors = function () { st.all.forEach(function (c) { c._el = null; c._tries = 0; c._next = 0; }); };
    var pinPos = function (c) {
      var el = c._el; if (!el) return null;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { x: r.left + r.width * c.anchor.rel.x, y: r.top + r.height * c.anchor.rel.y };
    };
    var byId = function (id) { for (var i = 0; i < st.comments.length; i++) if (st.comments[i].id === id) return st.comments[i]; return null; };
    var renderPins = function () {
      var html = '';
      st.comments.forEach(function (c) {
        if (isGeneral(c)) return;
        ensureResolved(c);
        if (!inFilter(c, st.filter) && st.open !== c.id) return;
        html += '<div class="pin' + (st.hot === c.id ? ' hot' : '') + (c._fx ? ' fx' : '') + '" data-id="' + c.id + '" style="display:none;background:' + ST_COLOR[statusOf(c)] + '">' + (isDone(c) ? '✓' : st.nums[c.id]) + '</div>';
      });
      if (st.draft) html += '<div class="pin new draft" style="display:none">+</div>';
      pinsEl.innerHTML = html;
      [].forEach.call(pinsEl.querySelectorAll('.pin[data-id]'), function (p) {
        p.onclick = function (e) { e.stopPropagation(); openCard(byId(p.dataset.id)); };
      });
      position();
    };
    // Primeiro mede todos os pins, depois escreve (evita recalcular o layout uma vez por pin)
    // e só mexe no estilo quando a posição mudou. Pins comuns usam coordenadas da página.
    var putPin = function (p, pos, page) {
      if (!pos) { if (p._k !== 'off') { p._k = 'off'; p.style.display = 'none'; } return; }
      var x = pos.x + (page ? scrollX : 0), y = pos.y + (page ? scrollY : 0);
      x = Math.round(x * 2) / 2; y = Math.round(y * 2) / 2;
      var k = x + ',' + y;
      if (p._k === k) return;
      if (p._k === 'off' || p._k == null) p.style.display = 'block';
      p._k = k; p.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    };
    // onlyMoving: na rolagem da página só os pins fixos, o rascunho e o cartão aberto precisam de JS
    var position = function (onlyMoving) {
      var pins = pinsEl.querySelectorAll('.pin[data-id]'), reads = [], cs = [];
      for (var i = 0; i < pins.length; i++) {
        var c = byId(pins[i].dataset.id);
        cs.push(c);
        reads.push(c && (!onlyMoving || c._fx === 'sticky') ? pinPos(c) : undefined);
      }
      var dp = pinsEl.querySelector('.draft');
      var dpos = dp && st.draft ? pinPos({ _el: st.draft.el, anchor: st.draft.anchor }) : null;
      var oc = st.open && card ? byId(st.open) : null, op = oc ? pinPos(oc) : null;
      for (var j = 0; j < pins.length; j++) if (reads[j] !== undefined) putPin(pins[j], reads[j], !(cs[j] && cs[j]._fx));
      if (dp && dpos) putPin(dp, dpos, false);
      if (op) placeCard(op.x, op.y);
    };
    var hasMoving = function () {
      if (st.draft || (st.open && card)) return true;
      // elemento fixo não se move com a rolagem; só o "grudado" (sticky) precisa acompanhar
      for (var i = 0; i < st.comments.length; i++) if (st.comments[i]._fx === 'sticky') return true;
      return false;
    };
    var setStatus = function (c, status) {
      var prev = c.status; c.status = status; refresh();
      api('/api/comments/' + encodeURIComponent(c.id), { method: 'PATCH', body: JSON.stringify({ status: status }) })
        .then(function (r) { if (!r || r.error) { c.status = prev; refresh(); } else emit('changed', {}); })
        .catch(function () { c.status = prev; refresh(); });
    };
    var replyHTML = function (r) {
      return '<div class="rp"><div class="rh">' + avatarHTML(r.author, 18) + '<b>' + esc(r.author) + '</b><span>· ' + esc(ago(r.createdAt)) + '</span></div>' +
        '<div class="rt">' + esc(r.text) + '</div></div>';
    };
    var openCard = function (c) {
      if (!c) return;
      closeCard();
      st.open = c.id;
      c.replies = c.replies || [];
      card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = '<div class="meta"></div><div class="body"></div>' +
        (c.screenshot ? '<a class="shot" target="_blank" rel="noopener"></a>' : (c._shooting && !c._shotFailed ? '<a class="shot wait">Gerando print…</a>' : '')) +
        '<div class="thread"></div>' +
        '<div class="reply"><textarea rows="1" placeholder="Responder…"></textarea><button class="btn primary rsend" title="Enviar (Ctrl+Enter)" disabled>Enviar</button></div>' +
        '<div class="row" style="margin-top:var(--s3)"><button class="btn tgl"></button><button class="btn close">Fechar</button></div>';
      var drawMeta = function () {
        card.querySelector('.meta').innerHTML = avatarHTML(c.author, 20) + '<span class="mt" title="' + esc(new Date(c.createdAt).toLocaleString('pt-BR')) + '">' + esc('#' + st.nums[c.id] + ' · ' + c.author + ' · ' + ago(c.createdAt)) +
          '</span>' + (c.editedAt ? '<span class="ed">· editado</span>' : '') +
          (c.mine ? '<span class="own"><button class="edt" title="Editar comentário">Editar</button><button class="del" title="Apagar comentário">Apagar</button></span>' : '');
        if (!c.mine) return;
        card.querySelector('.edt').onclick = startEdit;
        card.querySelector('.del').onclick = askDelete;
      };
      var bodyEl = card.querySelector('.body');
      bodyEl.textContent = c.text;
      var startEdit = function () {
        if (card.querySelector('.edit')) return;
        var box = document.createElement('div'); box.className = 'edit';
        box.innerHTML = '<textarea rows="3"></textarea><div class="row"><button class="btn ecancel">Cancelar</button><button class="btn primary esave">Salvar</button></div>';
        var et = box.querySelector('textarea'); et.value = c.text;
        bodyEl.style.display = 'none'; bodyEl.parentNode.insertBefore(box, bodyEl.nextSibling);
        et.focus(); et.setSelectionRange(et.value.length, et.value.length);
        var stop = function () { box.remove(); bodyEl.style.display = ''; };
        var save = function () {
          var t = et.value.trim();
          if (!t) return;
          if (t === c.text) return stop();
          var sv = box.querySelector('.esave'); sv.disabled = true; sv.textContent = 'Salvando…';
          api('/api/comments/' + encodeURIComponent(c.id), { method: 'PATCH', body: JSON.stringify({ text: t }) }).then(function (r) {
            if (!r || r.error) { sv.disabled = false; sv.textContent = 'Salvar'; return; }
            c.text = r.text; c.editedAt = r.editedAt;
            bodyEl.textContent = c.text; stop(); drawMeta(); emit('changed', {});
          }).catch(function () { sv.disabled = false; sv.textContent = 'Salvar'; });
        };
        box.querySelector('.ecancel').onclick = stop;
        box.querySelector('.esave').onclick = save;
        et.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); }
        });
      };
      var askDelete = function () {
        if (card.querySelector('.confirm')) return;
        var box = document.createElement('div'); box.className = 'confirm';
        box.innerHTML = 'Apagar este comentário' + (c.replies.length ? ' e as ' + c.replies.length + ' resposta(s)' : '') + '? Não dá para desfazer.' +
          '<div class="row"><button class="btn dcancel">Cancelar</button><button class="btn danger dok">Apagar</button></div>';
        bodyEl.parentNode.insertBefore(box, bodyEl.nextSibling);
        box.querySelector('.dcancel').onclick = function () { box.remove(); };
        box.querySelector('.dok').onclick = function () {
          var b = box.querySelector('.dok'); b.disabled = true; b.textContent = 'Apagando…';
          api('/api/comments/' + encodeURIComponent(c.id), { method: 'DELETE' }).then(function (r) {
            if (!r || r.error) { b.disabled = false; b.textContent = 'Apagar'; return; }
            closeCard();
            st.all = st.all.filter(function (x) { return x.id !== c.id; });
            refresh(); emit('changed', {});
          }).catch(function () { b.disabled = false; b.textContent = 'Apagar'; });
        };
      };
      drawMeta();
      if (c.screenshot) { var sa = card.querySelector('.shot'); sa.href = c.screenshot; sa.title = 'Abrir print em tamanho real'; sa.innerHTML = '<img alt="Print do comentário" src="' + esc(c.screenshot) + '">'; }
      var th = card.querySelector('.thread');
      var drawThread = function () { th.innerHTML = c.replies.map(replyHTML).join(''); th.scrollTop = th.scrollHeight; };
      drawThread();
      var ta = card.querySelector('.reply textarea'), rs = card.querySelector('.rsend');
      ta.addEventListener('input', function () {
        rs.disabled = !ta.value.trim();
        ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
      });
      var sendReply = function () {
        var text = ta.value.trim();
        if (!text || rs.disabled) return;
        var me = identity() || { name: 'Convidado' };
        rs.disabled = true;
        api('/api/comments/' + encodeURIComponent(c.id) + '/replies', {
          method: 'POST', body: JSON.stringify({ text: text, author: me.name, authorEmail: me.email || null }),
        }).then(function (r) {
          if (!r || r.error) { rs.disabled = false; return; }
          c.replies.push(r);
          ta.value = ''; ta.style.height = '';
          drawThread();
          emit('changed', {});
        }).catch(function () { rs.disabled = false; });
      };
      rs.onclick = sendReply;
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } });
      var tg = card.querySelector('.tgl');
      tg.className = 'btn tgl ' + (isDone(c) ? 'reopen' : 'ok');
      tg.innerHTML = isDone(c) ? 'Reabrir' : ICON.check + 'Resolver';
      tg.onclick = function () { var next = isDone(c) ? 'open' : 'resolved'; closeCard(); setStatus(c, next); };
      card.querySelector('.close').onclick = closeCard;
      card.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCard(); e.stopPropagation(); });
      root.appendChild(card);
      if (!pinPos(c)) placeCard(Math.max(8, (innerWidth - 300) / 2), 80);
      renderPins();
    };
    var focusComment = function (id) {
      var c = byId(id);
      if (!c) return false;
      if (c._el) { c._el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(function () { openCard(c); }, 450); }
      else openCard(c);
      return true;
    };
    var lastReport = '';
    var report = function () {
      var anchors = {};
      st.comments.forEach(function (c) { anchors[c.id] = isGeneral(c) ? { anchored: true, shown: false, general: true } : { anchored: !!c._el, shown: !!pinPos(c) }; });
      var msg = { path: st.path, device: st.bp, width: innerWidth, anchors: anchors, title: document.title };
      var key = JSON.stringify(msg);
      if (key === lastReport) return;   // nada mudou: não faz a lista da janela principal se redesenhar
      lastReport = key;
      emit('state', msg);
    };
    var refresh = function () {
      st.bp = bpOf(innerWidth);
      st.nums = numbers(st.all);
      st.comments = screenComments();
      renderPins();
      report();
    };
    var load = function () {
      return loadAll().then(function (list) {
        st.all = list;
        refresh();
        var p = ss('fb_pending');
        if (p && p.path === st.path && p.device === st.bp) { ss('fb_pending', null); setTimeout(function () { focusComment(p.id); }, 300); }
      });
    };

    // Pins acompanham o site sem um laço em todo frame. Rolagem da página: os pins comuns já
    // rolam sozinhos; só os fixos/rascunho/cartão seguem por JS. Rolagem dentro de um elemento,
    // resize ou rolagem "falsa" (sites que movem a página por transform): segue tudo por um instante.
    // Parado: uma conferência leve a cada 0,5 s (animações e mudanças de layout do site).
    var raf = 0, burstUntil = 0, burstAll = false, lastDocScroll = 0;
    var tick = function () {
      raf = 0;
      if (st.comments.length || st.draft) position(!burstAll);
      if (performance.now() < burstUntil) raf = requestAnimationFrame(tick);
      else burstAll = false;
    };
    var kick = function (ms, all) {
      if (all) burstAll = true;
      burstUntil = Math.max(burstUntil, performance.now() + (ms || 0));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    // O evento de rolagem chega antes das animações do site mexerem na página naquele quadro:
    // medir aqui é barato (o layout ainda está pronto). Por isso os pins "grudados" se atualizam
    // direto no evento, sem um laço de quadros.
    addEventListener('scroll', function (e) {
      if (e.target === document || e.target === document.documentElement || e.target === document.body) {
        lastDocScroll = performance.now();
        if ((st.comments.length || st.draft) && hasMoving()) position(true);
      } else kick(350, true);
    }, { capture: true, passive: true });
    var onGesture = function () {
      var t = performance.now();
      setTimeout(function () { if (lastDocScroll < t) kick(350, true); }, 80);
    };
    addEventListener('wheel', onGesture, { passive: true });
    addEventListener('touchmove', onGesture, { passive: true });
    addEventListener('keydown', function () { kick(350, true); }, true);
    var shotPending = false;
    setInterval(function () {
      if (shotPending || document.hidden || !(st.comments.length || st.draft)) return;
      shotPending = true;
      requestAnimationFrame(function () { shotPending = false; position(false); });
    }, 500);
    var rT = null;
    addEventListener('resize', function () {
      kick(350, true);
      clearTimeout(rT);
      rT = setTimeout(function () { if (bpOf(innerWidth) !== st.bp) { closeCard(); refresh(); } else report(); }, 120);
    });
    var moTimer = null;
    new MutationObserver(function (muts) {
      if (moTimer) return;   // já tem uma conferência marcada
      var ours = true;
      for (var i = 0; i < muts.length; i++) { var t = muts[i].target; if (t !== host && !host.contains(t)) { ours = false; break; } }
      if (ours) return;
      moTimer = setTimeout(function () {
        moTimer = null;
        var now = Date.now(), need = st.comments.some(function (c) {
          if (isGeneral(c)) return false;
          if (c._el) return !c._el.isConnected;          // elemento saiu da página
          return !c._next || now >= c._next;              // sem âncora e já pode tentar de novo
        });
        if (need) { renderPins(); report(); }
      }, 150);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    var onRoute = function () {
      if (location.pathname === st.path) return;
      st.path = location.pathname;
      closeCard(); resetAnchors(); refresh();
      setTimeout(function () { resetAnchors(); refresh(); }, 60);
    };
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () { var r = orig.apply(this, arguments); setTimeout(onRoute, 0); return r; };
    });
    addEventListener('popstate', onRoute);

    addEventListener('message', function (e) {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.fb !== 'cmd') return;
      var d = e.data;
      if (d.cmd === 'mode') setMode(d.on);
      if (d.cmd === 'filter') { st.filter = d.f; renderPins(); }
      if (d.cmd === 'reload') load();
      if (d.cmd === 'hot') { st.hot = d.id; renderPins(); }
      if (d.cmd === 'general') { setMode(false); startDraft(null); }
      if (d.cmd === 'open') {
        refresh();
        if (!focusComment(d.id)) load().then(function () { focusComment(d.id); });
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
      if (e.key === 'c' || e.key === 'C') setMode(!st.mode);
      else if (e.key === 'Escape') { setMode(false); closeCard(); }
    });

    window.FeedbackReviewer = {
      platform: PLATFORM, frame: true,
      state: function () {
        return st.comments.map(function (c) { return { id: c.id, text: c.text, anchored: !!c._el, via: c._via, device: c.device, status: statusOf(c), screenshot: c.screenshot || null, mine: !!c.mine, edited: !!c.editedAt, general: isGeneral(c) }; });
      },
      pinOf: function (id) { var c = byId(id); if (!c) return null; c._next = 0; ensureResolved(c); return pinPos(c); },
    };
    load();
    emit('ready', {});
    return;
  }

  // ==================================================================
  // CHROME — janela principal: botão flutuante + tela de revisão
  // ==================================================================
  var RC = makeRoot(CHROME_CSS), chost = RC.host, croot = RC.root;
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<button class="launch" title="Abrir revisão" style="display:none">' + ICON.chat + '<span>Revisar</span><span class="bd" style="display:none"></span></button>' +
    '<div class="bar" role="region" aria-label="Revisão do site"><div class="bi">' + ICON.chat + '</div><div class="bt"><b></b><span></span></div>' +
    '<button class="bgo"><span>Iniciar revisão</span><span class="bn" style="display:none"></span></button><button class="bx" title="Minimizar">' + ICON.close + '</button></div>' +
    '<div class="gate"><div class="gbox" role="dialog" aria-modal="true">' +
    '  <h3>Antes de começar</h3>' +
    '  <p>Como você quer aparecer nos comentários? Vamos lembrar do seu nome neste navegador.</p>' +
    '  <input class="gname" placeholder="Seu nome" autocomplete="name" maxlength="80">' +
    '  <div class="gerr">Digite seu nome para continuar.</div>' +
    '  <div class="grow"><button class="gb gcancel">Cancelar</button><button class="gb ok gok">Começar revisão</button></div>' +
    '</div></div>' +
    '<div class="shell">' +
    '  <aside class="side">' +
    '    <div class="sh">' + ICON.chat + '<span>Comentários</span><span class="n"></span></div>' +
    '    <div class="sbody">' +
    '      <label class="search">' + ICON.search + '<input type="search" placeholder="Buscar comentários…"></label>' +
    '      <div><div class="lab"><span>Dispositivo</span></div><div class="seg" style="margin-top:var(--s2)"><button data-sc="current"><span class="scicon"></span><span class="sclabel">Este dispositivo</span></button><button data-sc="all">Todos</button></div></div>' +
    '      <label class="chk"><input type="checkbox" class="onlypage"> Só comentários desta página</label>' +
    '    </div>' +
    '    <div class="groups"></div>' +
    '  </aside>' +
    '  <div class="top">' +
    '    <div class="tc"><div class="devs">' + BPS.map(function (b) { return '<button class="dev" data-d="' + b + '" title="' + BP_LABEL[b] + ' (' + BP_WIDTH[b] + ' px)">' + ICON[b] + '</button>'; }).join('') + '</div>' +
    '    <span class="vsep"></span>' +
    '    <label class="wbox"><input class="w" type="number" min="320" max="2560"> px</label>' +
    '    <select class="preset"><option value="">Personalizado</option>' + PRESETS.map(function (p) { return '<option value="' + p.w + '">' + p.label + ' · ' + p.w + '</option>'; }).join('') + '</select></div>' +
    '    <div class="tr"><button class="appr" title="Registrar que esta página está aprovada"></button><button class="exit" title="Voltar ao site">' + ICON.close + 'Sair da revisão</button><div class="apop"></div></div>' +
    '  </div>' +
    '  <div class="stage"><div class="fwrap"><iframe title="Site em revisão"></iframe></div><span class="scale"></span></div>' +
    '  <div class="foot">' +
    '    <div class="fcount">' + ICON.chat + '<span></span></div>' +
    '    <div class="me"></div>' +
    '    <div class="mode"><span class="l1 on">Navegar</span><span class="sw"></span><span class="l2">Comentar</span></div>' +
    '    <span class="hint">C comenta · Esc cancela</span>' +
    '    <button class="help" title="Como funciona (tutorial)">?</button>' +
    '  </div>' +
    '</div>';
  while (wrap.firstChild) croot.appendChild(wrap.firstChild);
  var tourEl = document.createElement('div'); tourEl.className = 'tour';
  tourEl.innerHTML = '<div class="tspot"></div><div class="tbox" role="dialog" aria-live="polite"><div class="ts"></div><h4></h4><p></p><div class="tr2"><span class="dots"></span><button class="tk">Pular</button><button class="tb">Voltar</button><button class="tn">Próximo</button></div></div>';
  croot.appendChild(tourEl);
  var $ = function (s) { return croot.querySelector(s); };
  var shell = $('.shell'), stage = $('.stage'), fwrap = $('.fwrap'), frame = $('.fwrap iframe'), groupsEl = $('.groups');

  var saved = ss('fb_shell') || {};
  var ch = {
    open: false,
    width: saved.width || BP_WIDTH.desktop,
    path: saved.path || location.pathname,
    all: [],
    filter: ['open'],   // no site, só pins abertos; resolvidos ficam na lista
    onlyPage: !!saved.onlyPage,
    scope: saved.scope || 'current', // 'current' = só o breakpoint visível; 'all' = todos
    q: '',
    mode: false,
    info: null,           // estado reportado pelo quadro
    ready: false,
    queue: [],
    collapsed: {},
    showRes: {},          // por página: mostrar resolvidos? (padrão: ocultos)
    approvals: [],        // aprovações de página {id, path, author, createdAt, mine}
  };
  function persist() { ss('fb_shell', { open: ch.open, width: ch.width, path: ch.path, filter: ch.filter, onlyPage: ch.onlyPage, scope: ch.scope }); }

  function send(msg) {
    msg.fb = 'cmd';
    if (!ch.ready) { ch.queue.push(msg); return; }
    try { frame.contentWindow.postMessage(msg, location.origin); } catch (e) {}
  }
  addEventListener('message', function (e) {
    if (e.origin !== location.origin || !frame.contentWindow || e.source !== frame.contentWindow || !e.data || e.data.fb !== 'evt') return;
    var d = e.data;
    if (d.evt === 'ready') {
      ch.ready = true;
      send({ cmd: 'filter', f: ch.filter });
      var q = ch.queue; ch.queue = []; q.forEach(send);
    }
    if (d.evt === 'mode') { ch.mode = d.on; renderMode(); }
    if (d.evt === 'state') {
      ch.info = d;
      if (d.path !== ch.path) { ch.path = d.path; persist(); closeApop(); }
      renderApproval();
      renderList(); renderFoot();
    }
    if (d.evt === 'changed') reloadList();
    if (d.evt === 'identity') renderMe();
  });

  // ---------------- Abrir / fechar ----------------
  // Com a revisão aberta o site aparece no quadro; a cópia da janela principal fica
  // escondida (display:none) e com vídeos e Lottie pausados, para o site não rodar duas vezes.
  // A ferramenta mora fora do <body>, então continua visível.
  var prevOverflow = '', sleepStyle = null, sleeping = null;
  var PLAYERS = 'video,dotlottie-player,lottie-player,dotlottie-wc';
  function sleepPage() {
    if (sleepStyle) return;
    sleeping = { x: scrollX, y: scrollY, media: [], lottie: false, raf: null };
    // vídeos e players de Lottie (dotlottie/lottie-player) que estavam tocando
    [].forEach.call(document.querySelectorAll(PLAYERS), function (v) {
      var playing = v.tagName === 'VIDEO' ? !v.paused : !(v.paused === true || v.currentState === 'paused' || v.currentState === 'stopped');
      if (playing && typeof v.pause === 'function') { sleeping.media.push(v); try { v.pause(); } catch (e) {} }
    });
    try { var lt = window.Webflow && Webflow.require && Webflow.require('lottie'); if (lt && lt.lottie && lt.lottie.freeze) { lt.lottie.freeze(); sleeping.lottie = lt.lottie; } } catch (e) {}
    // animações feitas em JavaScript (Lottie, GSAP, Framer, interações): na janela principal
    // escondida elas passam a rodar 1 vez por segundo em vez de 60 (o quadro tem a própria janela)
    var oRaf = window.requestAnimationFrame, oCaf = window.cancelAnimationFrame, q = {}, seq = 0;
    if (oRaf) {
      var flush = function () {
        var cbs = q; q = {};
        var t = performance.now();
        Object.keys(cbs).forEach(function (k) { try { cbs[k](t); } catch (e) { setTimeout(function () { throw e; }); } });
      };
      sleeping.raf = { r: oRaf, c: oCaf, timer: setInterval(flush, 1000), take: function () { var c = q; q = {}; return c; } };
      window.requestAnimationFrame = function (cb) { var id = 'fb' + (++seq); q[id] = cb; return id; };
      window.cancelAnimationFrame = function (id) { if (q[id]) delete q[id]; else oCaf.call(window, id); };
    }
    sleepStyle = document.createElement('style');
    sleepStyle.id = 'fb-sleep';
    sleepStyle.textContent = 'body{display:none!important}';
    document.head.appendChild(sleepStyle);
  }
  function wakePage() {
    if (!sleepStyle) return;
    sleepStyle.remove(); sleepStyle = null;
    var s = sleeping; sleeping = null;
    if (!s) return;
    if (s.raf) {
      clearInterval(s.raf.timer);
      window.requestAnimationFrame = s.raf.r; window.cancelAnimationFrame = s.raf.c;
      var q = s.raf.take(), cbs = Object.keys(q).map(function (k) { return q[k]; });
      if (cbs.length) s.raf.r.call(window, function (t) { cbs.forEach(function (cb) { try { cb(t); } catch (e) { setTimeout(function () { throw e; }); } }); });
    }
    if (s.lottie) { try { s.lottie.unfreeze(); } catch (e) {} }
    s.media.forEach(function (v) { try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} });
    // sliders e afins que mediram a página escondida recalculam; volta para onde estava
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
    try { scrollTo({ left: s.x, top: s.y, behavior: 'instant' }); } catch (e) { scrollTo(s.x, s.y); }
  }
  function openShell() {
    if (ch.open) return;
    ch.open = true; persist();
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    shell.classList.add('show');
    showLauncher(); bootDone();
    sleepPage();
    if (typeof maybeTour === 'function') maybeTour();
    loadFrame(ch.path);
    applyWidth();
    reloadList();
  }
  function closeShell() {
    ch.open = false; persist();
    shell.classList.remove('show');
    document.documentElement.style.overflow = prevOverflow;
    wakePage();
    showLauncher();
    frame.removeAttribute('src');
    ch.ready = false; ch.info = null; ch.mode = false;
    reloadList();
  }
  function loadFrame(path) {
    ch.ready = false; ch.queue = []; ch.info = null;
    frame.src = path + location.search + location.hash;
  }
  // Janela de nome: aparece antes da tela de revisão quando ainda não sabemos quem é
  var gate = $('.gate'), afterName = null;
  function askName(then) {
    afterName = then || null;
    var cur = identity();
    $('.gname').value = cur && !cur.personal ? cur.name : '';
    $('.gerr').style.display = 'none';
    gate.classList.add('show'); bootDone();
    setTimeout(function () { $('.gname').focus(); }, 30);
  }
  function confirmName() {
    var n = $('.gname').value.trim();
    if (!n) { $('.gerr').style.display = 'block'; $('.gname').focus(); return; }
    saveIdentity(n, null);
    gate.classList.remove('show');
    renderMe(); showLauncher();
    var f = afterName; afterName = null;
    if (f) f();
  }
  $('.gok').addEventListener('click', confirmName);
  $('.gcancel').addEventListener('click', function () { gate.classList.remove('show'); afterName = null; });
  $('.gname').addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter') confirmName();
    if (e.key === 'Escape') { gate.classList.remove('show'); afterName = null; }
  });
  function requestOpen() {
    if (identity()) openShell(); else askName(openShell);
  }
  $('.launch').addEventListener('click', requestOpen);
  // ---------------- Tutorial (primeira vez que abre a revisão) ----------------
  var TOUR = [
    { sel: '.mode', t: 'Comentar', p: 'Ative Comentar (ou aperte C) e clique em qualquer parte do site para deixar um comentário no lugar exato.' },
    { sel: '.devs', t: 'Dispositivos', p: 'Veja o site em Desktop, Tablet e Mobile. Cada tamanho tem seus próprios comentários.' },
    { sel: '.side', t: 'Lista de comentários', p: 'Todos os comentários ficam aqui, organizados por página. Clique num deles para ir até o ponto. Também dá para deixar um comentário geral sobre a página.' },
    { sel: '.appr', t: 'Aprovar página', p: 'Quando estiver tudo certo com a página, clique em Aprovar. Fica registrado quem aprovou e quando.' },
  ];
  var TOUR_KEY = 'fb_tour';
  function tourDone() {
    try { if (localStorage.getItem(TOUR_KEY)) return true; } catch (e) {}
    return !!readCookie(TOUR_KEY);
  }
  function markTour() {
    try { localStorage.setItem(TOUR_KEY, 'done'); } catch (e) {}
    document.cookie = TOUR_KEY + '=done; max-age=31536000; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  var tourStep = 0, tourSteps = [];
  function tourShow(i) {
    tourStep = i;
    var st = tourSteps[i], el = $(st.sel), r = el.getBoundingClientRect(), pad = 6;
    var spot = tourEl.querySelector('.tspot'), box = tourEl.querySelector('.tbox');
    Object.assign(spot.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
    box.querySelector('.ts').textContent = 'Passo ' + (i + 1) + ' de ' + tourSteps.length;
    box.querySelector('h4').textContent = st.t;
    box.querySelector('p').textContent = st.p;
    box.querySelector('.dots').innerHTML = tourSteps.map(function (x, k) { return '<i' + (k === i ? ' class="on"' : '') + '></i>'; }).join('');
    box.querySelector('.tb').style.display = i ? '' : 'none';
    box.querySelector('.tn').textContent = i === tourSteps.length - 1 ? 'Começar' : 'Próximo';
    // balão ao lado do destaque: à direita (se couber), senão embaixo, senão em cima
    var bw = box.offsetWidth || 300, bh = box.offsetHeight || 170, W = innerWidth, H = innerHeight, x, y;
    if (r.right + 16 + bw < W - 8 && r.height > bh * 0.6) { x = r.right + 16; y = Math.min(Math.max(8, r.top), H - bh - 8); }
    else if (r.bottom + 16 + bh < H - 8) { x = r.left + r.width / 2 - bw / 2; y = r.bottom + 16; }
    else { x = r.left + r.width / 2 - bw / 2; y = r.top - bh - 16; }
    box.style.left = Math.min(Math.max(12, x), W - bw - 12) + 'px';
    box.style.top = Math.min(Math.max(12, y), H - bh - 12) + 'px';
  }
  function tourStart() {
    if (!ch.open) return;
    // só os passos cujo botão está visível agora (ex.: no celular a lista pode estar escondida)
    tourSteps = TOUR.filter(function (st) { var el = $(st.sel); if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!tourSteps.length) return;
    closeApop && closeApop();
    tourEl.classList.add('show');
    tourShow(0);
    setTimeout(function () { tourShow(tourStep); tourEl.querySelector('.tn').focus(); }, 30); // reposiciona já com o tamanho real do balão
  }
  function tourEnd() { tourEl.classList.remove('show'); markTour(); }
  tourEl.querySelector('.tn').addEventListener('click', function () { if (tourStep < tourSteps.length - 1) tourShow(tourStep + 1); else tourEnd(); });
  tourEl.querySelector('.tb').addEventListener('click', function () { if (tourStep > 0) tourShow(tourStep - 1); });
  tourEl.querySelector('.tk').addEventListener('click', tourEnd);
  tourEl.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Escape') tourEnd();
    if (e.key === 'ArrowRight') tourEl.querySelector('.tn').click();
    if (e.key === 'ArrowLeft') tourEl.querySelector('.tb').click();
  });
  addEventListener('resize', function () { if (tourEl.classList.contains('show')) tourShow(tourStep); });
  $('.help').addEventListener('click', tourStart);
  function maybeTour() { if (!tourDone()) setTimeout(function () { if (ch.open && !gate.classList.contains('show')) tourStart(); }, 700); }

  // Barra de boas-vindas (quem ainda não se identificou) × botão flutuante (quem já se identificou)
  var BAR_TITLE = String(CFG.barTitle || 'Revisão do site').slice(0, 60);
  var BAR_TEXT = String(CFG.barText || 'Deixe seus comentários direto nas páginas: aponte o que quer ajustar e escreva. Tudo fica organizado para o estúdio.').slice(0, 140);
  $('.bar .bt b').textContent = BAR_TITLE;
  $('.bar .bt span').textContent = BAR_TEXT;
  function showLauncher() {
    var useBar = !ch.open && !ss('fb_bar_min'); // barra sempre que a revisão está fechada (× minimiza para o botão)
    $('.bar .bgo').firstChild.textContent = identity() ? 'Abrir revisão' : 'Iniciar revisão';
    $('.bar').classList.toggle('show', useBar);
    $('.launch').style.display = !ch.open && !useBar ? 'flex' : 'none';
    // selo "Made in Webflow" (só aparece no staging): o botão flutuante sobe para não ficar por cima dele
    var badge = document.querySelector('.w-webflow-badge');
    var bh = badge ? badge.getBoundingClientRect().height : 0; // (elemento fixo: offsetParent é sempre null)
    $('.launch').style.bottom = bh ? Math.round(bh + 24) + 'px' : '';
  }
  setTimeout(showLauncher, 1500); // o selo do Webflow entra depois do carregamento
  $('.bar .bgo').addEventListener('click', requestOpen);
  $('.bar .bx').addEventListener('click', function () { ss('fb_bar_min', 1); showLauncher(); });
  // Camada "Abrindo revisão…" criada pelo loader ao recarregar com a revisão aberta
  function bootDone() { var b = document.getElementById('fb-boot'); if (b) b.remove(); }
  $('.exit').addEventListener('click', closeShell);

  // ---------------- Largura e dispositivo ----------------
  function applyWidth() {
    var w = Math.max(320, Math.min(2560, ch.width | 0));
    ch.width = w; persist();
    $('.w').value = w;
    var pr = $('.preset');
    pr.value = PRESETS.some(function (p) { return p.w === w; }) ? String(w) : '';
    var bp = bpOf(w);
    [].forEach.call(croot.querySelectorAll('.dev'), function (b) { b.classList.toggle('on', b.dataset.d === bp); });
    fitFrame();
    renderList();
  }
  function fitFrame() {
    var availW = stage.clientWidth - 32, availH = stage.clientHeight - 32;
    if (availW <= 0) return;
    var s = Math.min(1, availW / ch.width);
    frame.style.width = ch.width + 'px';
    frame.style.height = Math.round(availH / s) + 'px';
    fwrap.style.transform = s < 1 ? 'scale(' + s + ')' : '';
    fwrap.style.width = ch.width + 'px';
    fwrap.style.height = Math.round(availH / s) + 'px';
    var sc = $('.scale');
    sc.style.display = s < 1 ? 'block' : 'none';
    sc.textContent = 'Visualizando em ' + Math.round(s * 100) + '%';
  }
  function setWidth(w) { ch.width = w; applyWidth(); }
  [].forEach.call(croot.querySelectorAll('.dev'), function (b) {
    b.addEventListener('click', function () { setWidth(BP_WIDTH[b.dataset.d]); });
  });
  $('.w').addEventListener('change', function () { setWidth(+this.value || ch.width); });
  $('.w').addEventListener('keydown', function (e) { if (e.key === 'Enter') setWidth(+this.value || ch.width); e.stopPropagation(); });
  $('.preset').addEventListener('change', function () { if (this.value) setWidth(+this.value); });
  addEventListener('resize', function () { if (ch.open) fitFrame(); });

  // ---------------- Navegar / Comentar ----------------
  function renderMode() {
    $('.mode').classList.toggle('cm', ch.mode);
    $('.l1').classList.toggle('on', !ch.mode);
    $('.l2').classList.toggle('on', ch.mode);
    fwrap.classList.toggle('commenting', ch.mode);
  }
  function setMode(on) { ch.mode = on; renderMode(); send({ cmd: 'mode', on: on }); }
  $('.mode').addEventListener('click', function () { setMode(!ch.mode); });
  document.addEventListener('keydown', function (e) {
    if (!ch.open) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (e.composedPath().some(function (n) { return n.tagName === 'INPUT' || n.tagName === 'SELECT'; })) return;
    if (e.key === 'c' || e.key === 'C') setMode(!ch.mode);
    else if (e.key === 'Escape') setMode(false);
  });

  // ---------------- Filtros ----------------
  [].forEach.call(croot.querySelectorAll('.seg button'), function (b) {
    b.addEventListener('click', function () { ch.scope = b.dataset.sc; persist(); renderList(); });
  });
  $('.onlypage').checked = ch.onlyPage;
  $('.onlypage').addEventListener('change', function () { ch.onlyPage = this.checked; persist(); renderList(); });
  $('.search input').addEventListener('input', function () { ch.q = this.value.trim().toLowerCase(); renderList(); });
  $('.search input').addEventListener('keydown', function (e) { e.stopPropagation(); });

  // ---------------- Lista: breakpoint → página → comentários ----------------
  function reloadList() {
    // aprovações só são usadas com a tela de revisão aberta (fechada, basta o contador do botão)
    if (ch.open) api('/api/approvals').then(function (a) { if (Array.isArray(a)) { ch.approvals = a; renderApproval(); renderList(); } }).catch(function () {});
    return loadAll().then(function (l) { ch.all = l; renderList(); renderFoot(); renderLaunch(); renderApproval(); });
  }
  function curBp() { return ch.info ? ch.info.device : bpOf(ch.width); }
  function goTo(c) {
    var d = isGeneral(c) ? bpOf(ch.width) : (c.device || 'desktop');
    var needW = bpOf(ch.width) !== d;
    if (needW) setWidth(c.viewport && c.viewport.w && bpOf(c.viewport.w) === d ? c.viewport.w : BP_WIDTH[d]);
    if (c.path !== ch.path) {
      ss('fb_pending', { id: c.id, path: c.path, device: d });
      ch.path = c.path; persist();
      loadFrame(c.path);
      return;
    }
    setTimeout(function () { send({ cmd: 'open', id: c.id }); }, needW ? 250 : 0);
  }
  function renderLaunch() {
    var n = ch.all.filter(function (c) { return !isDone(c); }).length;
    var bd = $('.launch .bd'), bn = $('.bar .bn');
    bd.style.display = n ? 'inline-block' : 'none';
    bd.textContent = n;
    bn.style.display = n ? 'inline-block' : 'none';
    bn.textContent = n; bn.title = n + (n === 1 ? ' comentário aberto' : ' comentários abertos');
  }
  function renderMe() {
    var me = identity(), el = $('.me');
    if (!me) { el.innerHTML = 'Você ainda não se identificou'; return; }
    el.innerHTML = avatarHTML(me.name, 22) + '<span>Você: <b>' + esc(me.name) + '</b></span>' + (me.personal ? '' : ' <a class="swap">trocar</a>');
    var sw = el.querySelector('.swap');
    if (sw) sw.onclick = function () { askName(null); };
  }
  function renderFoot() {
    var n = ch.all.filter(function (c) { return !isDone(c); }).length;
    $('.fcount span').textContent = n + (n === 1 ? ' comentário aberto' : ' comentários abertos');
    $('.sh .n').textContent = ch.all.length;
  }
  function setStatusFromList(c, status) {
    var prev = c.status; c.status = status; renderList(); renderFoot(); renderLaunch();
    api('/api/comments/' + encodeURIComponent(c.id), { method: 'PATCH', body: JSON.stringify({ status: status }) })
      .then(function (r) { if (!r || r.error) { c.status = prev; renderList(); renderFoot(); } else send({ cmd: 'reload' }); })
      .catch(function () { c.status = prev; renderList(); renderFoot(); });
  }
  // ---------------- Aprovação de página ----------------
  function approvalsOf(p) { return ch.approvals.filter(function (a) { return a.path === p; }); }
  function fmtDate(iso) { var d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function approvedText(list) {
    return 'Aprovada por ' + list.map(function (a) { return a.author + ' em ' + fmtDate(a.createdAt); }).join('; ');
  }
  var apop = $('.apop');
  function closeApop() { apop.classList.remove('show'); }
  function renderApproval() {
    var b = $('.appr'), mine = approvalsOf(ch.path).filter(function (a) { return a.mine; })[0];
    b.classList.toggle('on', !!mine);
    b.innerHTML = ICON.check + '<span>' + (mine ? 'Você aprovou' : 'Aprovar página') + '</span>';
    b.title = mine ? 'Aprovada em ' + fmtDate(mine.createdAt) + ' · clique para desfazer' : 'Registrar que esta página está aprovada';
  }
  function approve() {
    var me = identity() || { name: 'Convidado' }, p = ch.path;
    closeApop();
    api('/api/approvals', { method: 'POST', body: JSON.stringify({ path: p, author: me.name, authorEmail: me.email || null }) }).then(function (r) {
      if (!r || r.error) return;
      ch.approvals = ch.approvals.filter(function (a) { return !(a.path === p && a.mine); }).concat([r]);
      renderApproval(); renderList();
    });
  }
  function unapprove(a) {
    closeApop();
    api('/api/approvals/' + encodeURIComponent(a.id), { method: 'DELETE' }).then(function (r) {
      if (!r || r.error) return;
      ch.approvals = ch.approvals.filter(function (x) { return x.id !== a.id; });
      renderApproval(); renderList();
    });
  }
  function showApop(html, okLabel, okClass, onOk) {
    apop.innerHTML = '<p></p><div class="r"><button class="no">Cancelar</button><button></button></div>';
    apop.querySelector('p').innerHTML = html;
    var ok = apop.querySelectorAll('button')[1]; ok.className = okClass; ok.textContent = okLabel; ok.onclick = onOk;
    apop.querySelector('.no').onclick = closeApop;
    apop.classList.add('show');
  }
  $('.appr').addEventListener('click', function (e) {
    e.stopPropagation();
    if (apop.classList.contains('show')) return closeApop();
    var mine = approvalsOf(ch.path).filter(function (a) { return a.mine; })[0];
    if (mine) return showApop('Você aprovou <b>' + esc(pageLabel(ch.path)) + '</b> em ' + esc(fmtDate(mine.createdAt)) + '. Desfazer a aprovação?', 'Desfazer', 'undo', function () { unapprove(mine); });
    var open = ch.all.filter(function (c) { return c.path === ch.path && !isDone(c); }).length;
    showApop((open ? 'Esta página ainda tem <b>' + open + (open === 1 ? ' comentário aberto' : ' comentários abertos') + '</b>. ' : '') +
      'Aprovar <b>' + esc(pageLabel(ch.path)) + '</b>? Fica registrado seu nome e a data.', 'Aprovar', 'ok', approve);
  });
  shell.addEventListener('click', function (e) { if (!e.composedPath().some(function (n) { return n === apop || n === $('.appr'); })) closeApop(); });

  function renderList() {
    var nums = numbers(ch.all);
    if (!ch.open) return;

    var path = ch.path, bpNow = curBp();
    [].forEach.call(croot.querySelectorAll('.seg button'), function (b) { b.classList.toggle('on', b.dataset.sc === ch.scope); });
    $('.scicon').innerHTML = ICON[bpNow];
    $('.sclabel').textContent = 'Só ' + BP_LABEL[bpNow];
    var anchors = (ch.info && ch.info.anchors) || {};
    var list = ch.all.filter(function (c) {
      if (ch.scope === 'current' && !isGeneral(c) && (c.device || 'desktop') !== bpNow) return false;
      if (ch.onlyPage && c.path !== path) return false;
      if (ch.q && (c.text + ' ' + c.author).toLowerCase().indexOf(ch.q) < 0) return false;
      return true;
    });
    groupsEl.innerHTML = '';

    // Hierarquia: página → abertos → "Mostrar resolvidos" (ocultos por padrão)
    function itemEl(c, here) {
      var dev = c.device || 'desktop', done = isDone(c), stt = statusOf(c);
      var gen = isGeneral(c), onScreen = here && (gen || dev === bpNow), an = onScreen ? anchors[c.id] : null;
      var d = document.createElement('div');
      d.className = 'item' + (done ? ' done' : '');
      d.innerHTML =
        '<div class="num' + (gen ? ' g' : '') + '" style="background:' + ST_COLOR[stt] + '">' + (done ? '✓' : nums[c.id]) + '</div>' +
        '<div class="ic"><div class="it"><b></b><span class="tm"></span><span class="idev" title="' + BP_LABEL[dev] + '">' + ICON[dev] + '</span></div><div class="itx"></div>' +
        '<div class="ifoot"></div></div>' +
        '<button class="qa' + (done ? '' : ' res') + '">' + (done ? 'Reabrir' : '✓ Resolver') + '</button>';
      d.querySelector('.it b').textContent = c.author;
      d.querySelector('.tm').textContent = ago(c.createdAt);
      if (gen) { var idv = d.querySelector('.idev'); idv.title = 'Comentário geral da página (todos os dispositivos)'; idv.innerHTML = ICON.page + 'Geral'; }
      else d.querySelector('.idev').appendChild(document.createTextNode(c.viewport && c.viewport.w ? c.viewport.w + 'px' : BP_LABEL[dev]));
      d.querySelector('.itx').textContent = c.text;
      var nr = (c.replies || []).length;
      if (nr) { var rc = document.createElement('span'); rc.className = 'rcount'; rc.innerHTML = ICON.chat + nr + (nr === 1 ? ' resposta' : ' respostas'); d.querySelector('.ifoot').appendChild(rc); }
      if (an && !an.anchored) { var chp = document.createElement('span'); chp.className = 'chip'; chp.textContent = 'Sem âncora'; d.querySelector('.ifoot').appendChild(chp); }
      d.querySelector('.qa').onclick = function (e) { e.stopPropagation(); setStatusFromList(c, done ? 'open' : 'resolved'); };
      d.onclick = function () { goTo(c); };
      d.onmouseenter = function () { if (onScreen && !gen) send({ cmd: 'hot', id: c.id }); };
      d.onmouseleave = function () { if (onScreen) send({ cmd: 'hot', id: null }); };
      return d;
    }
    function byOrder(a, b) {
      var ga = isGeneral(a), gb = isGeneral(b);
      if (ga || gb) return ga && gb ? parseInt(String(nums[a.id]).slice(1), 10) - parseInt(String(nums[b.id]).slice(1), 10) : (ga ? -1 : 1);
      var da = BPS.indexOf(a.device || 'desktop'), db = BPS.indexOf(b.device || 'desktop');
      return da !== db ? da - db : nums[a.id] - nums[b.id];
    }
    var pages = {};
    list.forEach(function (c) { (pages[c.path] = pages[c.path] || []).push(c); });
    var keys = Object.keys(pages).sort(function (a, b) {
      if (a === path) return -1; if (b === path) return 1;
      return a < b ? -1 : 1;
    });
    if (!pages[path] && !ch.q) { pages[path] = []; keys.unshift(path); }
    ch.approvals.forEach(function (a) { if (!pages[a.path] && !ch.q && (!ch.onlyPage || a.path === path)) { pages[a.path] = []; keys.push(a.path); } });
    keys.forEach(function (p) {
      var here = p === path, apv = approvalsOf(p);
      var open = pages[p].filter(function (c) { return !isDone(c); }).sort(byOrder);
      var res = pages[p].filter(isDone).sort(byOrder);
      var collapsed = ch.collapsed[p] != null ? ch.collapsed[p] : !here && !ch.q && keys.length > 1;
      var ph = document.createElement('div');
      ph.className = 'pgh' + (here ? ' cur' : '');
      ph.innerHTML = '<span class="car">' + (collapsed ? ICON.chevR : ICON.chevD) + '</span><span class="pl"></span><span class="n" title="abertos"></span>';
      ph.children[1].textContent = pageLabel(p).toUpperCase() + (here ? '  ·  página atual' : '');
      ph.querySelector('.n').textContent = open.length;
      if (apv.length) { var ab = document.createElement('span'); ab.className = 'apb'; ab.innerHTML = ICON.check; ab.title = approvedText(apv); ph.insertBefore(ab, ph.querySelector('.n')); }
      ph.onclick = function () { ch.collapsed[p] = !collapsed; renderList(); };
      groupsEl.appendChild(ph);
      if (collapsed) return;
      if (here) {
        var gb = document.createElement('button'); gb.className = 'gnew';
        gb.innerHTML = ICON.plus + 'Comentário geral da página';
        gb.title = 'Comentar a página inteira, sem apontar um elemento';
        gb.onclick = function () { setMode(false); send({ cmd: 'general' }); };
        groupsEl.appendChild(gb);
      }
      if (apv.length) { var al = document.createElement('div'); al.className = 'apline'; al.textContent = '✓ ' + approvedText(apv); groupsEl.appendChild(al); }
      if (!open.length) { var no = document.createElement('div'); no.className = 'noopen'; no.textContent = 'Nada em aberto nesta página.'; groupsEl.appendChild(no); }
      open.forEach(function (c) { groupsEl.appendChild(itemEl(c, here)); });
      if (res.length) {
        var showing = !!ch.showRes[p] || !!ch.q;
        var bt = document.createElement('button');
        bt.className = 'showres';
        bt.innerHTML = '<span class="car">' + (showing ? ICON.chevD : ICON.chevR) + '</span><i></i><span></span>';
        bt.lastChild.textContent = (showing ? 'Ocultar ' : 'Mostrar ') + res.length + (res.length === 1 ? ' resolvido' : ' resolvidos');
        bt.onclick = function () { ch.showRes[p] = !showing; renderList(); };
        groupsEl.appendChild(bt);
        if (showing) res.forEach(function (c) { groupsEl.appendChild(itemEl(c, here)); });
      }
    });
    if (!ch.all.length) {
      var e1 = document.createElement('div'); e1.className = 'empty';
      e1.innerHTML = 'Nenhum comentário ainda.<br>Ative <b>Comentar</b> e clique em qualquer elemento do site.';
      groupsEl.appendChild(e1);
    }
    if (ch.all.length && !list.length) {
      var e = document.createElement('div'); e.className = 'empty';
      e.innerHTML = ch.scope === 'current' ? 'Nenhum comentário neste dispositivo.<br>Escolha <b>Todos</b> para ver os outros.' : 'Nenhum comentário com esses filtros.';
      groupsEl.insertBefore(e, groupsEl.firstChild);
    }
  }


  // ---------------- Tempo real (Realtime do Supabase, canal público "fb-<projeto>") ----------------
  // O canal só avisa "mudou algo" (sem conteúdo); os dados vêm sempre da API, que exige sessão.
  var RT_KEY = '__SUPABASE_PUBLISHABLE_KEY__';
  var RT_URL = '__SUPABASE_URL__';
  function realtime(base, onChange) {
    // endereço do Supabase: vem da configuração (scripts servidos pela Vercel); sem ela, deduz de onde o script veio
    var m = /^https:\/\/([a-z0-9]+)\.supabase\.co\//.exec(RT_URL.charAt(0) === '_' ? (base || '') : RT_URL + '/');
    if (!m || !window.WebSocket) return { set: function () {} };
    var url = 'wss://' + m[1] + '.supabase.co/realtime/v1/websocket?apikey=' + RT_KEY + '&vsn=1.0.0';
    var ws = null, topics = [], ref = 0, hb = null, wait = 1000, timers = {}, closed = false, everOpen = false, fails = 0;
    var fire = function (topic) { clearTimeout(timers[topic]); timers[topic] = setTimeout(function () { onChange(topic); }, 350); };
    var join = function (t) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic: 'realtime:' + t, event: 'phx_join', payload: { config: { broadcast: { self: false }, presence: { key: '' }, private: false } }, ref: String(++ref), join_ref: String(ref) })); };
    var connect = function () {
      if (closed) return;
      try { ws = new WebSocket(url); } catch (e) { return; }
      ws.onopen = function () {
        if (everOpen) topics.forEach(fire); // reconectou: busca o que pode ter perdido
        everOpen = true; fails = 0; wait = 1000; topics.forEach(join);
        clearInterval(hb); hb = setInterval(function () { if (ws.readyState === 1) ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) })); }, 25000);
      };
      ws.onmessage = function (e) {
        var msg; try { msg = JSON.parse(e.data); } catch (x) { return; }
        if (msg.event === 'broadcast' && msg.payload && msg.payload.event === 'changed') fire(String(msg.topic).replace(/^realtime:/, ''));
      };
      ws.onclose = function () {
        clearInterval(hb);
        if (closed) return;
        if (!everOpen && ++fails > 4) return; // rede bloqueia websocket: desiste (o resto funciona sem tempo real)
        setTimeout(connect, wait);
        wait = Math.min(wait * 2, 30000);
      };
      ws.onerror = function () { try { ws.close(); } catch (x) {} };
    };
    // volta a sincronizar quando a aba volta a ficar visível (computador dormiu, etc.)
    document.addEventListener('visibilitychange', function () { if (!document.hidden) topics.forEach(fire); });
    connect();
    return {
      set: function (list) {
        list.forEach(function (t) { if (topics.indexOf(t) < 0) { topics.push(t); join(t); } });
      },
    };
  }

  var rt = realtime(CFG.base, function () { reloadList(); if (ch.open) send({ cmd: 'reload' }); });
  if (CFG.project) rt.set(['fb-' + CFG.project]);

  // ---------------- Início ----------------
  window.FeedbackReviewer = {
    platform: PLATFORM,
    open: openShell, close: closeShell,
    setWidth: setWidth,
    frame: function () { return frame; },
    all: function () { return ch.all; },
    info: function () { return ch.info; },
    reload: reloadList,
    approvals: function () { return ch.approvals; },
  };
  renderMode();
  reloadList();
  renderMe();
  showLauncher();
  if (saved.open || CFG.via === 'token' || CFG.via === 'person') requestOpen();
  else bootDone();
})();
