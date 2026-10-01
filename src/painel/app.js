/*!
 * painel.js — painel do estúdio.
 * Abre em qualquer site com o snippet, adicionando ?painel à URL
 * (o loader carrega este arquivo em vez do revisor). Login com a senha do estúdio.
 */
(function () {
  if (window.__FB_PANEL_LOADED__) return;
  window.__FB_PANEL_LOADED__ = true;
  var CFG = window.__FB_PANEL__ || {};
  var BASE = CFG.base;
  var SKEY = 'fb_panel_session';
  // cor de fundo de cada favicon (lida dos cantos do ícone) para pintar o círculo
  var FAVBG = {};
  function favTint(im) {
    var dom = im.getAttribute('data-dom'), box = im.parentNode;
    if (!(dom in FAVBG)) {
      var color = null;
      try {
        var n = 32, cv = document.createElement('canvas'); cv.width = cv.height = n;
        var cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, n, n);
        var px = [[1, 1], [n - 2, 1], [1, n - 2], [n - 2, n - 2]].map(function (p) { return cx.getImageData(p[0], p[1], 1, 1).data; })
          .filter(function (d) { return d[3] > 200; });
        if (px.length >= 3) {
          var avg = [0, 1, 2].map(function (i) { return Math.round(px.reduce(function (t, d) { return t + d[i]; }, 0) / px.length); });
          var same = px.every(function (d) { return Math.abs(d[0] - avg[0]) + Math.abs(d[1] - avg[1]) + Math.abs(d[2] - avg[2]) < 40; });
          if (same && avg[0] + avg[1] + avg[2] < 735) color = 'rgb(' + avg.join(',') + ')'; // quase branco: fica o círculo padrão
        }
      } catch (e) {}
      FAVBG[dom] = color;
    }
    if (FAVBG[dom] && box) { box.style.background = FAVBG[dom]; box.style.boxShadow = 'none'; }
  }
  // favicon de cada site (função "favicon" no Supabase: lê o ícone do próprio site)
  var FAVICON = /\/painel$/.test(BASE || '') ? BASE.replace(/\/painel$/, '/favicon') : (BASE || '') + '/../favicon';
  // ?painel=sugestoes → área do administrador (sugestões de todos os estúdios), com senha própria
  // página própria do painel (Vercel): CFG.standalone / CFG.admin vêm do index.html / sugestoes.html
  var ADMIN = CFG.admin === true || (function () { try { return new URLSearchParams(location.search).get('painel') === 'sugestoes'; } catch (e) { return false; } })();

  // ---------------- utilidades ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function ago(iso) {
    if (!iso) return '—';
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    if (s < 604800) return Math.floor(s / 86400) + ' d';
    return new Date(iso).toLocaleDateString('pt-BR');
  }
  function fmtDate(iso) { var d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function pageLabel(p) { return p === '/' ? 'Página inicial' : p; }
  function isGeneral(c) { return !!(c && c.anchor && c.anchor.kind === 'page'); }
  function isDone(c) { return c.status === 'resolved'; }
  // coluna do board: Aberto → Com o agente → Para conferir → Resolvido
  function colOf(c) { return isDone(c) ? 'resolved' : c.agent_status === 'queued' ? 'agent' : (c.agent_status === 'review' || c.agent_status === 'blocked') ? 'review' : 'open'; }
  function numbers(all) {
    var seq = {}, map = {};
    all.slice().sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); }).forEach(function (c) {
      var g = isGeneral(c), k = c.path + '|' + (g ? 'geral' : (c.device || 'desktop'));
      seq[k] = (seq[k] || 0) + 1; map[c.id] = g ? 'G' + seq[k] : seq[k];
    });
    return map;
  }
  var DEV = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
  var ICON = { // ícones Remix (os do design system Lysch)
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM11 13H4V19H11V13ZM20 13H13V19H20V13ZM11 5H4V11H11V5ZM20 5H13V11H20V5Z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM9.71002 19.6674C8.74743 17.6259 8.15732 15.3742 8.02731 13H4.06189C4.458 16.1765 6.71639 18.7747 9.71002 19.6674ZM10.0307 13C10.1811 15.4388 10.8778 17.7297 12 19.752C13.1222 17.7297 13.8189 15.4388 13.9693 13H10.0307ZM19.9381 13H15.9727C15.8427 15.3742 15.2526 17.6259 14.29 19.6674C17.2836 18.7747 19.542 16.1765 19.9381 13ZM4.06189 11H8.02731C8.15732 8.62577 8.74743 6.37407 9.71002 4.33256C6.71639 5.22533 4.458 7.8235 4.06189 11ZM10.0307 11H13.9693C13.8189 8.56122 13.1222 6.27025 12 4.24799C10.8778 6.27025 10.1811 8.56122 10.0307 11ZM14.29 4.33256C15.2526 6.37407 15.8427 8.62577 15.9727 11H19.9381C19.542 7.8235 17.2836 5.22533 14.29 4.33256Z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.29117 20.8242L2 22L3.17581 16.7088C2.42544 15.3056 2 13.7025 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C10.2975 22 8.6944 21.5746 7.29117 20.8242ZM7.58075 18.711L8.23428 19.0605C9.38248 19.6745 10.6655 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 13.3345 4.32549 14.6175 4.93949 15.7657L5.28896 16.4192L4.63416 19.3658L7.58075 18.711Z"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3638 15.5355L16.9496 14.1213L18.3638 12.7071C20.3164 10.7545 20.3164 7.58866 18.3638 5.63604C16.4112 3.68341 13.2453 3.68341 11.2927 5.63604L9.87849 7.05025L8.46428 5.63604L9.87849 4.22182C12.6122 1.48815 17.0443 1.48815 19.778 4.22182C22.5117 6.95549 22.5117 11.3876 19.778 14.1213L18.3638 15.5355ZM15.5353 18.364L14.1211 19.7782C11.3875 22.5118 6.95531 22.5118 4.22164 19.7782C1.48797 17.0445 1.48797 12.6123 4.22164 9.87868L5.63585 8.46446L7.05007 9.87868L5.63585 11.2929C3.68323 13.2455 3.68323 16.4113 5.63585 18.364C7.58847 20.3166 10.7543 20.3166 12.7069 18.364L14.1211 16.9497L15.5353 18.364ZM14.8282 7.75736L16.2425 9.17157L9.17139 16.2426L7.75717 14.8284L14.8282 7.75736Z"/></svg>',
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6V8H5V19H16V14H18V20C18 20.5523 17.5523 21 17 21H4C3.44772 21 3 20.5523 3 20V7C3 6.44772 3.44772 6 4 6H10ZM21 3V11H19L18.9999 6.413L11.2071 14.2071L9.79289 12.7929L17.5849 5H13V3H21Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.9998 6V3C6.9998 2.44772 7.44752 2 7.9998 2H19.9998C20.5521 2 20.9998 2.44772 20.9998 3V17C20.9998 17.5523 20.5521 18 19.9998 18H16.9998V20.9991C16.9998 21.5519 16.5499 22 15.993 22H4.00666C3.45059 22 3 21.5554 3 20.9991L3.0026 7.00087C3.0027 6.44811 3.45264 6 4.00942 6H6.9998ZM5.00242 8L5.00019 20H14.9998V8H5.00242ZM8.9998 6H16.9998V16H18.9998V4H8.9998V6Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z"/></svg>',
    desktop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16H20V5H4V16ZM13 18V20H17V22H7V20H11V18H2.9918C2.44405 18 2 17.5511 2 16.9925V4.00748C2 3.45107 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44892 22 4.00748V16.9925C22 17.5489 21.5447 18 21.0082 18H13Z"/></svg>',
    tablet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4V20H18V4H6ZM5 2H19C19.5523 2 20 2.44772 20 3V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V3C4 2.44772 4.44772 2 5 2ZM12 17C12.5523 17 13 17.4477 13 18C13 18.5523 12.5523 19 12 19C11.4477 19 11 18.5523 11 18C11 17.4477 11.4477 17 12 17Z"/></svg>',
    mobile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4V20H17V4H7ZM6 2H18C18.5523 2 19 2.44772 19 3V21C19 21.5523 18.5523 22 18 22H6C5.44772 22 5 21.5523 5 21V3C5 2.44772 5.44772 2 6 2ZM12 17C12.5523 17 13 17.4477 13 18C13 18.5523 12.5523 19 12 19C11.4477 19 11 18.5523 11 18C11 17.4477 11.4477 17 12 17Z"/></svg>',
    page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8V20.9932C21 21.5501 20.5552 22 20.0066 22H3.9934C3.44495 22 3 21.556 3 21.0082V2.9918C3 2.45531 3.4487 2 4.00221 2H14.9968L21 8ZM19 9H14V4H5V20H19V9ZM8 7H11V9H8V7ZM8 11H16V13H8V11ZM8 15H16V17H8V15Z"/></svg>',
    out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22C4.44772 22 4 21.5523 4 21V3C4 2.44772 4.44772 2 5 2H19C19.5523 2 20 2.44772 20 3V6H18V4H6V20H18V18H20V21C20 21.5523 19.5523 22 19 22H5ZM18 16V13H11V11H18V8L23 12L18 16Z"/></svg>',
    slack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.501 3C15.3294 3 16.001 3.67157 16.001 4.5V9.5C16.001 10.3284 15.3294 11 14.501 11C13.6725 11 13.001 10.3284 13.001 9.5V4.5C13.001 3.67157 13.6725 3 14.501 3ZM4.50098 13H6.00098V14.5C6.00098 15.3284 5.3294 16 4.50098 16C3.67255 16 3.00098 15.3284 3.00098 14.5C3.00098 13.6716 3.67255 13 4.50098 13ZM13.001 18H14.501C15.3294 18 16.001 18.6716 16.001 19.5C16.001 20.3284 15.3294 21 14.501 21C13.6725 21 13.001 20.3284 13.001 19.5V18ZM14.501 13H19.501C20.3294 13 21.001 13.6716 21.001 14.5C21.001 15.3284 20.3294 16 19.501 16H14.501C13.6725 16 13.001 15.3284 13.001 14.5C13.001 13.6716 13.6725 13 14.501 13ZM19.501 8C20.3294 8 21.001 8.67157 21.001 9.5C21.001 10.3284 20.3294 11 19.501 11H18.001V9.5C18.001 8.67157 18.6725 8 19.501 8ZM4.50098 8H9.50098C10.3294 8 11.001 8.67157 11.001 9.5C11.001 10.3284 10.3294 11 9.50098 11H4.50098C3.67255 11 3.00098 10.3284 3.00098 9.5C3.00098 8.67157 3.67255 8 4.50098 8ZM9.50098 3C10.3294 3 11.001 3.67157 11.001 4.5V6H9.50098C8.67255 6 8.00098 5.32843 8.00098 4.5C8.00098 3.67157 8.67255 3 9.50098 3ZM9.50098 13C10.3294 13 11.001 13.6716 11.001 14.5V19.5C11.001 20.3284 10.3294 21 9.50098 21C8.67255 21 8.00098 20.3284 8.00098 19.5V14.5C8.00098 13.6716 8.67255 13 9.50098 13Z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4.4375C15.3462 4.4375 16.4375 3.34619 16.4375 2H17.5625C17.5625 3.34619 18.6538 4.4375 20 4.4375V5.5625C18.6538 5.5625 17.5625 6.65381 17.5625 8H16.4375C16.4375 6.65381 15.3462 5.5625 14 5.5625V4.4375ZM1 11C4.31371 11 7 8.31371 7 5H9C9 8.31371 11.6863 11 15 11V13C11.6863 13 9 15.6863 9 19H7C7 15.6863 4.31371 13 1 13V11ZM4.87601 12C6.18717 12.7276 7.27243 13.8128 8 15.124 8.72757 13.8128 9.81283 12.7276 11.124 12 9.81283 11.2724 8.72757 10.1872 8 8.87601 7.27243 10.1872 6.18717 11.2724 4.87601 12ZM17.25 14C17.25 15.7949 15.7949 17.25 14 17.25V18.75C15.7949 18.75 17.25 20.2051 17.25 22H18.75C18.75 20.2051 20.2051 18.75 22 18.75V17.25C20.2051 17.25 18.75 15.7949 18.75 14H17.25Z"/></svg>',
    stack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.0833 15.1999L21.2854 15.9212C21.5221 16.0633 21.5989 16.3704 21.4569 16.6072C21.4146 16.6776 21.3557 16.7365 21.2854 16.7787L12.5144 22.0412C12.1977 22.2313 11.8021 22.2313 11.4854 22.0412L2.71451 16.7787C2.47772 16.6366 2.40093 16.3295 2.54301 16.0927C2.58523 16.0223 2.64413 15.9634 2.71451 15.9212L3.9166 15.1999L11.9999 20.0499L20.0833 15.1999ZM20.0833 10.4999L21.2854 11.2212C21.5221 11.3633 21.5989 11.6704 21.4569 11.9072C21.4146 11.9776 21.3557 12.0365 21.2854 12.0787L11.9999 17.6499L2.71451 12.0787C2.47772 11.9366 2.40093 11.6295 2.54301 11.3927C2.58523 11.3223 2.64413 11.2634 2.71451 11.2212L3.9166 10.4999L11.9999 15.3499L20.0833 10.4999ZM12.5144 1.30864L21.2854 6.5712C21.5221 6.71327 21.5989 7.0204 21.4569 7.25719C21.4146 7.32757 21.3557 7.38647 21.2854 7.42869L11.9999 12.9999L2.71451 7.42869C2.47772 7.28662 2.40093 6.97949 2.54301 6.7427C2.58523 6.67232 2.64413 6.61343 2.71451 6.5712L11.4854 1.30864C11.8021 1.11864 12.1977 1.11864 12.5144 1.30864ZM11.9999 3.33233L5.88723 6.99995L11.9999 10.6676L18.1126 6.99995L11.9999 3.33233Z"/></svg>',
    archive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10H2V4.00293C2 3.44903 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.43788 22 4.00293V10H21V20.0015C21 20.553 20.5551 21 20.0066 21H3.9934C3.44476 21 3 20.5525 3 20.0015V10ZM19 10H5V19H19V10ZM4 5V8H20V5H4ZM9 12H15V14H9V12Z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.382 3C12.7607 3 13.107 3.214 13.2764 3.55279L14 5H20C20.5523 5 21 5.44772 21 6V17C21 17.5523 20.5523 18 20 18H13.618C13.2393 18 12.893 17.786 12.7236 17.4472L12 16H5V22H3V3H12.382ZM11.7639 5H5V14H13.2361L14.2361 16H19V7H12.7639L11.7639 5Z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.7279 9.57627L14.3137 8.16206L5 17.4758V18.89H6.41421L15.7279 9.57627ZM17.1421 8.16206L18.5563 6.74785L17.1421 5.33363L15.7279 6.74785L17.1421 8.16206ZM7.24264 20.89H3V16.6473L16.435 3.21231C16.8256 2.82179 17.4587 2.82179 17.8492 3.21231L20.6777 6.04074C21.0682 6.43126 21.0682 7.06443 20.6777 7.45495L7.24264 20.89Z"/></svg>',
    bot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2C13.5 2.44425 13.3069 2.84339 13 3.11805V5H18C19.6569 5 21 6.34315 21 8V18C21 19.6569 19.6569 21 18 21H6C4.34315 21 3 19.6569 3 18V8C3 6.34315 4.34315 5 6 5H11V3.11805C10.6931 2.84339 10.5 2.44425 10.5 2C10.5 1.17157 11.1716 0.5 12 0.5C12.8284 0.5 13.5 1.17157 13.5 2ZM6 7C5.44772 7 5 7.44772 5 8V18C5 18.5523 5.44772 19 6 19H18C18.5523 19 19 18.5523 19 18V8C19 7.44772 18.5523 7 18 7H13H11H6ZM2 10H0V16H2V10ZM22 10H24V16H22V10ZM9 14.5C9.82843 14.5 10.5 13.8284 10.5 13C10.5 12.1716 9.82843 11.5 9 11.5C8.17157 11.5 7.5 12.1716 7.5 13C7.5 13.8284 8.17157 14.5 9 14.5ZM15 14.5C15.8284 14.5 16.5 13.8284 16.5 13C16.5 12.1716 15.8284 11.5 15 11.5C14.1716 11.5 13.5 12.1716 13.5 13C13.5 13.8284 14.1716 14.5 15 14.5Z"/></svg>',
    key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.7577 11.8281L18.6066 3.97919L20.0208 5.3934L18.6066 6.80761L21.0815 9.28249L19.6673 10.6967L17.1924 8.22183L15.7782 9.63604L17.8995 11.7574L16.4853 13.1716L14.364 11.0503L12.1719 13.2423C13.4581 15.1837 13.246 17.8251 11.5355 19.5355C9.58291 21.4882 6.41709 21.4882 4.46447 19.5355C2.51184 17.5829 2.51184 14.4171 4.46447 12.4645C6.17493 10.754 8.81633 10.5419 10.7577 11.8281ZM10.1213 18.1213C11.2929 16.9497 11.2929 15.0503 10.1213 13.8787C8.94975 12.7071 7.05025 12.7071 5.87868 13.8787C4.70711 15.0503 4.70711 16.9497 5.87868 18.1213C7.05025 19.2929 8.94975 19.2929 10.1213 18.1213Z"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.97308 18H11V13H13V18H14.0269C14.1589 16.7984 14.7721 15.8065 15.7676 14.7226C15.8797 14.6006 16.5988 13.8564 16.6841 13.7501C17.5318 12.6931 18 11.385 18 10C18 6.68629 15.3137 4 12 4C8.68629 4 6 6.68629 6 10C6 11.3843 6.46774 12.6917 7.31462 13.7484C7.40004 13.855 8.12081 14.6012 8.23154 14.7218C9.22766 15.8064 9.84103 16.7984 9.97308 18ZM10 20V21H14V20H10ZM5.75395 14.9992C4.65645 13.6297 4 11.8915 4 10C4 5.58172 7.58172 2 12 2C16.4183 2 20 5.58172 20 10C20 11.8925 19.3428 13.6315 18.2443 15.0014C17.624 15.7748 16 17 16 18.5V21C16 22.1046 15.1046 23 14 23H10C8.89543 23 8 22.1046 8 21V18.5C8 17 6.37458 15.7736 5.75395 14.9992Z"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H21ZM7.41604 14H4V19H20V14H16.584C15.8124 15.7659 14.0503 17 12 17C9.94968 17 8.1876 15.7659 7.41604 14ZM20 5H4V12H9C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12H20V5Z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.46257 4.43262C7.21556 2.91688 9.5007 2 12 2C17.5228 2 22 6.47715 22 12C22 14.1361 21.3302 16.1158 20.1892 17.7406L17 12H20C20 7.58172 16.4183 4 12 4C9.84982 4 7.89777 4.84827 6.46023 6.22842L5.46257 4.43262ZM18.5374 19.5674C16.7844 21.0831 14.4993 22 12 22C6.47715 22 2 17.5228 2 12C2 9.86386 2.66979 7.88416 3.8108 6.25944L7 12H4C4 16.4183 7.58172 20 12 20C14.1502 20 16.1022 19.1517 17.5398 17.7716L18.5374 19.5674Z"/></svg>',
  };

  // ------------------------------------------------------------------
  // Design system Lysch: tokens (--cc-*), fonte DM Sans e ícones Remix
  // Os tokens vêm de @lysch/design-system (src/tokens/tokens.css, tema claro).
  // Para atualizar: codigo/supabase/design-system/ (ver LEIA-ME.md lá).
  // ------------------------------------------------------------------
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


  // ---------------- raiz isolada ----------------
  var host = document.createElement('div');
  host.id = 'fb-panel-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;';
  document.documentElement.appendChild(host);
  loadDsFont();
  document.documentElement.style.overflow = 'hidden';
  var root = host.attachShadow({ mode: 'open' });
  var CSS = (CFG.standalone ? '.cl{display:none!important}' : '') + DS_BASE +
    ':host{--st-agent:var(--cc-semantic-theme-palette-purple-high-bg);--st-agent-lo:var(--cc-semantic-theme-palette-purple-low-bg);--st-agent-lo-c:var(--cc-semantic-theme-palette-purple-low-content);' +
    '--st-review:var(--cc-semantic-theme-feedback-warning-high-bg)}' +
    'svg{width:var(--s4);height:var(--s4)}' +
    'button,input,select,textarea{font:var(--f-bsm)}' +
    'a{color:inherit}' +
    '.app{position:fixed;inset:0;background:var(--bg-sec);color:var(--c-pri);font:var(--f-bsm);display:grid;grid-template-columns:280px 1fr}' +
    // login (Dialog do DS)
    '.login{position:fixed;inset:0;background:var(--bg-sec);display:flex;align-items:center;justify-content:center;color:var(--c-pri)}' +
    '.lbox{width:420px;max-width:calc(100vw - var(--s8));max-height:calc(100vh - var(--s8));overflow:auto;background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r6);padding:var(--s10)}' +
    '.lbox h1{margin:0 0 var(--s3);font:var(--f-hmd)}.lbox p{margin:0 0 var(--s6);color:var(--c-sec);font:var(--f-bmd)}.lbox p b{color:var(--c-pri)}' +
    '.lbox label{display:block;font:var(--f-bsm);color:var(--c-sec);margin:var(--s4) 0 var(--s2)}' +
    // Input do DS
    '.inp{width:100%;border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:0 var(--s4);height:var(--s12);font:var(--f-bmd);outline:0;background:var(--bg-pri);color:var(--c-pri)}.inp:focus{border-color:var(--bd-str)}.inp::placeholder{color:var(--c-ph)}' +
    '.lerr{color:var(--crit-lo-c);font:var(--f-bsm);margin-top:var(--s2);min-height:var(--s5)}' +
    // Button do DS: md 40 (padrão) · sm 32 · primary / secondary / tertiary · brand / critical
    '.btn{border:0;border-radius:var(--r4);height:var(--s10);padding:0 var(--s4);font:var(--f-lmd-s);cursor:pointer;background:var(--brand-lo);color:var(--brand-lo-c);display:inline-flex;align-items:center;justify-content:center;gap:var(--s2);white-space:nowrap;text-decoration:none;transition:background-color var(--mf)}' +
    '.btn:hover{background-image:linear-gradient(var(--hov-br),var(--hov-br))}' +
    '.btn.sm{height:var(--s8);padding:0 var(--s3);font:var(--f-lsm-s);gap:var(--s1)}' +
    '.btn.primary{background-color:var(--brand);color:var(--brand-c)}.btn.primary:hover,.btn.ok:hover,.btn.crit:hover{background-image:linear-gradient(var(--hov-inv),var(--hov-inv))}' +
    '.btn.ok{background-color:var(--ok);color:var(--ok-c)}.btn.danger{background-color:var(--crit-lo);color:var(--crit-lo-c)}.btn.crit{background-color:var(--crit);color:var(--crit-c)}' +
    '.btn.ghost{background-color:transparent;box-shadow:inset 0 0 0 var(--b1) var(--bd-sec)}' +
    '.btn[disabled]{pointer-events:none;background:var(--bg-dis);color:var(--c-dis);box-shadow:none}.btn.full{width:100%;margin-top:var(--s6)}' +
    // barra lateral (Sidebar + Menu item do DS)
    '.side{background:var(--bg-srf);border-right:var(--b1) solid var(--bd-pri);display:flex;flex-direction:column;min-height:0}' +
    '.brand{padding:var(--s5) var(--s5) var(--s4);border-bottom:var(--b1) solid var(--bd-pri)}.brand b{display:block;font:var(--f-hxs)}.brand span{color:var(--c-ter);font:var(--f-cap)}' +
    '.nav{flex:1;overflow:auto;padding:var(--s3)}' +
    '.nl{font:var(--f-lsm-s);color:var(--c-ter);letter-spacing:var(--ls-wide);text-transform:uppercase;padding:var(--s4) var(--s2) var(--s2)}' +
    '.ni{display:flex;align-items:center;gap:var(--s3);padding:var(--s2) var(--s3);border-radius:var(--r2);cursor:pointer;color:var(--c-sec);transition:background-color var(--mf)}' +
    '.ni svg{width:var(--s5);height:var(--s5)}' +
    '.ni:hover{background:var(--hov-br)}.ni.on{background:var(--bg-ter);color:var(--c-pri)}.ni.on:hover{background:var(--bg-ter);background-image:linear-gradient(var(--hov-br),var(--hov-br))}' +
    '.ni .t{flex:1;min-width:0}.ni .t b{display:block;font:var(--f-lmd-s);color:var(--c-pri);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ni .t span{display:block;font:var(--f-cap);color:var(--c-ter);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    // Badge do DS
    '.bd{background:var(--brand);color:var(--brand-c);border-radius:var(--rp);min-width:var(--s5);height:var(--s5);line-height:var(--s5);font:var(--f-lsm-s);line-height:var(--s5);text-align:center;padding:0 var(--s1)}.bd.z{background:var(--bg-ter);color:var(--c-ter)}' +
    '.sfoot{border-top:var(--b1) solid var(--bd-pri);padding:var(--s3);display:flex;flex-direction:column;gap:var(--s0)}' +
    '.sfoot .ni{padding:var(--s2) var(--s3);font:var(--f-bsm)}.sfoot .ni svg{width:var(--s4);height:var(--s4)}' +
    // conteúdo
    '.main{min-width:0;display:flex;flex-direction:column;min-height:0}' +
    '.head{background:var(--bg-pri);border-bottom:var(--b1) solid var(--bd-pri);padding:var(--s5) var(--s8) 0}' +
    '.hrow{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap}' +
    '.hrow h2{margin:0;font:var(--f-hlg)}.hrow .dom{color:var(--c-ter);font:var(--f-bsm);display:inline-flex;align-items:center;gap:var(--s1);text-decoration:none}.hrow .dom:hover{color:var(--c-pri);text-decoration:underline}' +
    '.hact{margin-left:auto;display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap}' +
    '.tabs{display:flex;gap:var(--s1);margin-top:var(--s4);overflow-x:auto;scrollbar-width:none}' +
    '.tab{flex:0 0 auto;white-space:nowrap;border:0;background:transparent;height:var(--s12);padding:0 var(--s3);font:var(--f-lmd);color:var(--c-ter);cursor:pointer;border-bottom:var(--b2) solid transparent;display:inline-flex;align-items:center;gap:var(--s1)}' +
    '.tab:hover{color:var(--c-sec)}.tab.on{color:var(--c-pri);font-weight:var(--cc-semantic-type-label-md-weight-strong);border-color:var(--bd-str)}.tab .c{color:var(--c-ter);font:var(--f-lsm-s)}' +
    '.body{flex:1;overflow:auto;padding:var(--s6) var(--s8) var(--s10);min-height:0}' +
    // Tag do DS
    '.chip{display:inline-flex;align-items:center;gap:var(--s1);font:var(--f-lsm);border-radius:var(--rp);padding:var(--s1) var(--s2);background:var(--warn-lo);color:var(--warn-lo-c)}.chip::before{content:"";width:var(--s1);height:var(--s1);border-radius:var(--rp);background:currentColor}' +
    '.chip.g{background:var(--ok-lo);color:var(--ok-lo-c)}.chip.gray{background:var(--cc-semantic-theme-palette-neutral-low-bg);color:var(--c-sec)}' +
    // Toggle do DS (md)
    '.sw{display:inline-flex;align-items:center;gap:var(--s2);cursor:pointer;font:var(--f-lmd);color:var(--c-pri);user-select:none;padding:0 var(--s2)}' +
    '.sw i{width:var(--cc-primitives-dimension-0900);height:var(--s5);border-radius:var(--rp);background:var(--bg-ter);position:relative;transition:background-color var(--mf) cubic-bezier(.4,0,.2,1)}' +
    '.sw i::after{content:"";position:absolute;top:var(--s0);left:var(--s0);width:var(--s4);height:var(--s4);border-radius:var(--rp);background:var(--bg-pri);box-shadow:var(--sh1);transition:transform var(--mf) cubic-bezier(.4,0,.2,1)}' +
    '.sw.on i{background:var(--ok)}.sw.on i::after{transform:translateX(var(--s4));box-shadow:none}' +
    // visão geral (Card do DS com número em "data")
    '.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3);margin-bottom:var(--s6)}' +
    '.stat{background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:var(--s5) var(--s6)}.stat b{display:block;font:var(--f-dsm);letter-spacing:var(--cc-semantic-type-data-sm-letter-spacing);margin-top:var(--s2)}.stat span{color:var(--c-sec);font:var(--f-lmd)}' +
    '.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--s3)}' +
    '.sc{background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:var(--s5);cursor:pointer;transition:background-color var(--mf)}' +
    '.sc:hover{background-image:linear-gradient(var(--hov),var(--hov))}' +
    '.sc h3{margin:0;font:var(--f-hxs);display:flex;align-items:center;gap:var(--s2)}.sc .d{color:var(--c-ter);font:var(--f-cap);margin-top:var(--s1)}' +
    '.bar{height:var(--s1);border-radius:var(--rp);background:var(--bg-ter);overflow:hidden;margin:var(--s4) 0 var(--s3);display:flex}.bar i{background:var(--st-open)}.bar u{background:var(--st-done)}' +
    '.sc .n{display:flex;gap:var(--s4);font:var(--f-cap);color:var(--c-sec);flex-wrap:wrap}.sc .n span{white-space:nowrap}.sc .n b{color:var(--c-pri);font-weight:var(--cc-semantic-type-caption-weight-strong)}.sc .l{color:var(--c-ter);font:var(--f-cap);margin-top:var(--s3)}' +
    // board
    '.fbar{display:flex;gap:var(--s2);margin-bottom:var(--s4);flex-wrap:wrap;align-items:center}' +
    '.fbar select,.fbar input{height:var(--s10);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:0 var(--s3);background:var(--bg-pri);color:var(--c-pri);font:var(--f-bsm);outline:0}.fbar select:focus,.fbar input:focus{border-color:var(--bd-str)}.fbar input{width:240px}.fbar input::placeholder{color:var(--c-ph)}' +
    '.fbar select,.mbar select{-webkit-appearance:none;appearance:none;padding-right:var(--s8);cursor:pointer;background:var(--bg-pri) ' + CHEVRON + '}' +
    '.board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s3);align-items:start}' +
    '@media (max-width:1280px){.board{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '.col.ag.over,.col.rv.over{background:var(--st-agent-lo)}.col.ag .num{background:var(--st-agent)}.col.rv .num{background:var(--st-review);color:var(--cc-semantic-theme-feedback-warning-high-content)}' +
    '.ch .hint{margin-left:auto;border:0;background:none;color:var(--st-agent-lo-c);font:var(--f-lsm-s);cursor:pointer;padding:var(--s1) var(--s2);border-radius:var(--rp)}.ch .hint:hover{background:var(--hov)}' +
    '.agn{margin-top:var(--s2);font:var(--f-cap);background:var(--st-agent-lo);color:var(--st-agent-lo-c);border-radius:var(--r2);padding:var(--s2);display:flex;gap:var(--s2)}.agn svg{flex:0 0 14px;width:14px;height:14px}' +
    '.agn.q{background:var(--warn-lo);color:var(--warn-lo-c)}' +
    '.btn.agt{background-color:var(--st-agent-lo);color:var(--st-agent-lo-c)}' +
    '.cmd{display:flex;gap:var(--s2);align-items:center;background:var(--bg-sec);border:var(--b1) solid var(--bd-pri);border-radius:var(--r3);padding:var(--s2) var(--s2) var(--s2) var(--s3);font:13px/1.4 ui-monospace,Menlo,monospace;margin:0 0 var(--s4)}.cmd code{flex:1;word-break:break-all}' +
    '.col{background:var(--bg-ter);border-radius:var(--r4);padding:var(--s2);min-height:200px;transition:background-color var(--mf)}' +
    '.col.over{background:var(--tint-lo);box-shadow:inset 0 0 0 var(--b2) var(--bd-foc)}.col.done.over{background:var(--ok-lo)}' +
    '.ch{display:flex;align-items:center;gap:var(--s2);padding:var(--s2) var(--s2) var(--s3);font:var(--f-lmd-s)}.ch i{width:var(--s2);height:var(--s2);border-radius:var(--rp)}.ch .c{color:var(--c-ter);font:var(--f-lmd)}' +
    '.card{background:var(--bg-pri);border-radius:var(--r3);padding:var(--s3);margin-bottom:var(--s2);cursor:grab;border:var(--b1) solid var(--bd-pri);display:flex;gap:var(--s3);transition:border-color var(--mf)}' +
    '.card:hover{border-color:var(--bd-sec)}.card.dragging{opacity:.4}.col.done .card .tx{color:var(--c-ter)}' +
    '.num{flex:0 0 var(--s6);height:var(--s6);border-radius:var(--s6) var(--s6) var(--s6) var(--s0);color:var(--c-inv);font:var(--f-lsm-s);line-height:var(--s6);text-align:center;background:var(--st-open)}.num.g{font-size:11px}' +
    '.col.done .num{background:var(--st-done)}' +
    '.cc{flex:1;min-width:0}.cc .cp{font:var(--f-cap);color:var(--c-ter);display:flex;align-items:center;gap:var(--s1);margin-bottom:var(--s1)}.cc .cp svg{width:14px;height:14px}' +
    '.tx{font:var(--f-bsm);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-wrap:break-word}' +
    '.cm{display:flex;align-items:center;gap:var(--s2);white-space:nowrap;margin-top:var(--s2);font:var(--f-cap);color:var(--c-ter)}.cm b{color:var(--c-sec);font-weight:var(--cc-semantic-type-caption-weight-strong)}.cm .r{display:inline-flex;align-items:center;gap:var(--s1)}.cm .r svg{width:12px;height:12px}' +
    '.th{width:100%;height:84px;object-fit:cover;border-radius:var(--r2);margin-top:var(--s2);display:block;background:var(--bg-sec);border:var(--b1) solid var(--bd-pri)}' +
    '.qa{margin-left:auto;border:var(--b1) solid var(--bd-sec);background:var(--bg-pri);border-radius:var(--rp);height:var(--s6);padding:0 var(--s2);font:var(--f-lsm-s);cursor:pointer;color:var(--c-pri);opacity:0;transition:opacity var(--mf)}.qa:hover{background-image:linear-gradient(var(--hov),var(--hov))}.card:hover .qa,.card:focus-within .qa{opacity:1}' +
    '.emp{color:var(--c-ter);text-align:center;padding:var(--s8) var(--s3);font:var(--f-bsm)}.emp b{color:var(--c-pri)}' +
    // tabelas
    '.tbl{width:100%;border-collapse:separate;border-spacing:0;background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);overflow:hidden}' +
    '.tbl th{font:var(--f-lsm-s);letter-spacing:var(--ls-wide);text-transform:uppercase;color:var(--c-ter);text-align:left;padding:var(--s3) var(--s4);background:var(--bg-srf);border-bottom:var(--b1) solid var(--bd-pri)}' +
    '.tbl td{padding:var(--s3) var(--s4);border-bottom:var(--b1) solid var(--bd-pri);vertical-align:middle;font:var(--f-bsm)}.tbl td b{font-weight:var(--cc-semantic-type-body-sm-weight-strong)}.tbl tr:last-child td{border-bottom:0}' +
    '.tbl td.u{width:100%;min-width:260px}.tbl td:first-child{white-space:nowrap}.url{display:flex;align-items:center;gap:var(--s2)}.url code{font:12px/1.45 ui-monospace,Menlo,monospace;color:var(--c-sec);background:var(--bg-sec);padding:var(--s1) var(--s2);border-radius:var(--r2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:all;min-width:0;flex:0 1 auto}.url .ib{flex:0 0 var(--s8)}' +
    // Icon button do DS (terciário)
    '.ib{border:0;background:transparent;border-radius:var(--rp);width:var(--s8);height:var(--s8);cursor:pointer;color:var(--c-sec);display:inline-flex;align-items:center;justify-content:center}.ib:hover{background:var(--hov);color:var(--c-pri)}' +
    '.off td{color:var(--c-dis)}.off code{color:var(--c-dis)}' +
    '.form{display:flex;gap:var(--s2);align-items:center;background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:var(--s4);margin-bottom:var(--s4);flex-wrap:wrap}' +
    '.form .inp{width:auto;flex:1;min-width:160px;height:var(--s10);font:var(--f-bsm)}' +
    '.sub{font:var(--f-bsm);color:var(--c-sec);margin:0 0 var(--s3)}' +
    '.ok{color:var(--ok-lo-c)}' +
    // gaveta de detalhe
    '.scrim{position:fixed;inset:0;background:var(--bg-bkd);display:none}.scrim.show{display:block}' +
    '.drawer,.modal,.toast{font:var(--f-bsm);color:var(--c-pri)}.toast{color:var(--c-inv)}' +
    '.mbar{display:none}' +
    '.pri{display:inline-flex;align-items:center;font:var(--f-lsm-s);border-radius:var(--rp);padding:var(--s0) var(--s2);margin-left:auto}' +
    '.pri.alta{background:var(--crit-lo);color:var(--crit-lo-c)}.pri.media{background:var(--warn-lo);color:var(--warn-lo-c)}.pri.baixa{background:var(--cc-semantic-theme-palette-neutral-low-bg);color:var(--c-sec)}' +
    '.cc .cp{width:100%}.why{font:var(--f-cap);color:var(--c-ter);margin-top:var(--s1)}.why svg{width:12px;height:12px;vertical-align:-2px;color:var(--st-agent)}' +
    '.dupb{white-space:nowrap;display:inline-flex;align-items:center;gap:var(--s1);border:var(--b1) solid var(--bd-sec);background:var(--bg-pri);border-radius:var(--rp);height:var(--s6);padding:0 var(--s2);font:var(--f-lsm-s);color:var(--c-sec);cursor:pointer}.dupb:hover{border-color:var(--bd-str);color:var(--c-pri)}.dupb svg{width:12px;height:12px}' +
    '.dups{margin:calc(var(--s1) * -1) 0 var(--s2) var(--s4);border-left:var(--b2) solid var(--bd-sec);padding-left:var(--s2)}.dups .card{border-style:dashed}' +
    '.btn.ai{background-color:var(--st-agent-lo);color:var(--st-agent-lo-c)}' +
    '.dai{background:var(--st-agent-lo);border:var(--b1) solid var(--tint-lo-bd);border-radius:var(--r3);padding:var(--s3);margin:var(--s3) 0;font:var(--f-cap);color:var(--c-sec)}.dai b{color:var(--c-pri)}.dai svg{width:14px;height:14px;vertical-align:-3px}' +
    '.rchip{display:inline-flex;align-items:center;gap:var(--s2);font:var(--f-lsm-s);color:var(--brand-lo-c);background:var(--tint-lo);border-radius:var(--rp);height:var(--s8);padding:0 var(--s3)}.rchip svg{width:14px;height:14px}' +
    '.rounds{display:flex;flex-direction:column;gap:var(--s3)}.rd{background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:var(--s5);display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap}' +
    '.rd h4{margin:0;font:var(--f-hxs);display:flex;align-items:center;gap:var(--s2)}.rd .dt{color:var(--c-ter);font:var(--f-cap);margin-top:var(--s1)}.rd .nums{display:flex;gap:var(--s5);margin-left:auto;font:var(--f-cap);color:var(--c-sec)}.rd .nums b{display:block;font:var(--f-hsm);color:var(--c-pri)}' +
    '.rd.cur{border-color:var(--bd-str)}.rd.pend{border-style:dashed;background:var(--bg-srf)}.rd.pend h4,.rd.pend .nums{opacity:.6}' +
    '.rchip.off{background:transparent;color:var(--c-sec);box-shadow:inset 0 0 0 var(--b1) var(--bd-sec)}' +
    '.rnb{border:0;background:none;padding:0;margin-left:var(--s0);cursor:pointer;display:inline-flex;color:var(--c-ter);border-radius:var(--rp)}.rnb:hover{color:var(--c-pri)}.rnb svg{width:14px;height:14px}' +
    '.rd h4 .rn{border:0;background:none;width:var(--s6);height:var(--s6);border-radius:var(--rp);cursor:pointer;color:var(--c-ter);display:inline-flex;align-items:center;justify-content:center}.rd h4 .rn:hover{color:var(--c-pri);background:var(--hov)}.rd h4 .rn svg{width:14px;height:14px}.rd h4 em{font-style:normal;font-weight:var(--cc-semantic-type-heading-xs-weight);color:var(--c-sec)}' +
    '.banner{margin-top:var(--s3);background:var(--bg-srf);border:var(--b1) solid var(--bd-pri);border-radius:var(--r3);padding:var(--s3);font:var(--f-bsm);color:var(--c-sec)}' +
    '.ni.grp .t{flex:0 1 auto}' +
    '.fav{flex:0 0 var(--s7);width:var(--s7);height:var(--s7);border-radius:var(--rp);background:var(--bg-pri);box-shadow:inset 0 0 0 var(--b1) var(--bd-sec);display:inline-flex;align-items:center;justify-content:center;overflow:hidden;color:var(--c-ter)}' +
    '.ni .fav svg{width:var(--s4);height:var(--s4)}.fav img{width:var(--s4);height:var(--s4);display:block}.fav img+svg{display:none}.fav img.x{display:none}.fav img.x+svg{display:block}' +
    '.fold{margin-left:auto;border:0;background:transparent;width:var(--s6);height:var(--s6);border-radius:var(--rp);cursor:pointer;color:var(--c-ter);display:inline-flex;align-items:center;justify-content:center;padding:0}' +
    '.fold:hover{background:var(--hov);color:var(--c-pri)}.fold svg{width:var(--s4);height:var(--s4);transition:transform var(--mf)}.fold.shut svg{transform:rotate(-90deg)}' +
    '.nsep{height:var(--b1);background:var(--bd-pri);margin:var(--s2) calc(var(--s3) * -1)}' +
    '.ni.grp .gc{font:var(--f-lsm-s);color:var(--c-ter);background:var(--bg-ter);border-radius:var(--rp);min-width:var(--s5);height:var(--s5);line-height:var(--s5);text-align:center;padding:0 var(--s1)}.ni.grp.on .gc{background:var(--brand);color:var(--brand-c)}' +
    '.ni.arc{opacity:.6}.ni.arc:hover,.ni.arc.on{opacity:1}.sc.arc{opacity:.75}.sc.arc:hover{opacity:1}' +
    '.box{background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:var(--s6);margin-bottom:var(--s3);max-width:720px}.box h4{margin:0 0 var(--s2);font:var(--f-hxs)}.box p{margin:0 0 var(--s4);color:var(--c-sec);font:var(--f-bsm)}' +
    '.box ol{margin:0 0 var(--s4);padding-left:var(--s5);color:var(--c-sec);font:var(--f-bsm)}.box ol li{margin-bottom:var(--s1)}.box .row{display:flex;gap:var(--s2);flex-wrap:wrap;align-items:center}.box .inp{flex:1;min-width:240px;height:var(--s10);font:var(--f-bsm)}' +
    '.okline{display:inline-flex;align-items:center;gap:var(--s1);color:var(--ok-lo-c);font:var(--f-lmd-s)}.okline svg{width:var(--s4);height:var(--s4)}' +
    '.lbox .chk{display:flex;font:var(--f-bsm);color:var(--c-pri);margin:var(--s3) 0}.lbox .chk.dis{color:var(--c-dis)}.lbox .chk i{font-style:normal;color:var(--c-ter)}' +
    // Checkbox do DS
    '.chk{display:flex;gap:var(--s2);align-items:flex-start;margin:var(--s3) 0;color:var(--c-pri);cursor:pointer}' +
    '.chk input{-webkit-appearance:none;appearance:none;margin:var(--s0) 0 0;width:var(--s4);height:var(--s4);flex:0 0 var(--s4);border:var(--b2) solid var(--neu-lo-c);border-radius:var(--r1);background:transparent;cursor:pointer}' +
    '.chk input:checked{background:var(--neu-lo-c) ' + CHECKMARK + '}.chk input:disabled{background:var(--bg-dis);border-color:var(--c-dis)}.chk.dis{color:var(--c-dis);cursor:default}' +
    '.sumg{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s2);margin:0 0 var(--s3)}.sumg div{background:var(--bg-sec);border-radius:var(--r3);padding:var(--s3);text-align:center;font:var(--f-cap);color:var(--c-sec)}.sumg b{display:block;font:var(--f-hmd);color:var(--c-pri)}' +
    '.drawer{position:fixed;top:0;right:0;bottom:0;width:460px;max-width:100vw;background:var(--bg-pri);border-left:var(--b1) solid var(--bd-sec);box-shadow:var(--sh3);transform:translateX(105%);transition:transform .18s;display:flex;flex-direction:column}' +
    '.drawer.show{transform:none}' +
    '.dh{display:flex;align-items:center;gap:var(--s3);height:var(--s16);padding:0 var(--s4) 0 var(--s6);border-bottom:var(--b1) solid var(--bd-pri)}.dh b{font:var(--f-hxs)}.dh .ib{margin-left:auto}' +
    '.db{flex:1;overflow:auto;padding:var(--s6)}' +
    '.dmeta{color:var(--c-ter);font:var(--f-cap);display:flex;flex-wrap:wrap;gap:var(--s2) var(--s3);margin-bottom:var(--s3)}.dmeta span{display:inline-flex;align-items:center;gap:var(--s1)}.dmeta b{color:var(--c-pri);font-weight:var(--cc-semantic-type-caption-weight-strong)}.dmeta svg{width:14px;height:14px}' +
    '.dtext{font:var(--f-bmd);white-space:pre-wrap;word-wrap:break-word}' +
    '.dshot{display:block;margin-top:var(--s4);border:var(--b1) solid var(--bd-pri);border-radius:var(--r3);overflow:hidden}.dshot img{display:block;width:100%}' +
    // respostas: Chat balloon do DS
    '.rp{padding:var(--s3) var(--s4);margin-top:var(--s2);background:var(--bg-sec);border-radius:var(--r4)}.rp .rh{font:var(--f-cap);color:var(--c-ter);margin-bottom:var(--s1)}.rp .rh b{color:var(--c-pri);font-weight:var(--cc-semantic-type-caption-weight-strong)}.rp .rt{font:var(--f-bsm);white-space:pre-wrap}' +
    '.rl{font:var(--f-lsm-s);letter-spacing:var(--ls-wide);text-transform:uppercase;color:var(--c-ter);margin:var(--s6) 0 var(--s1)}' +
    '.df{border-top:var(--b1) solid var(--bd-pri);padding:var(--s4) var(--s6);display:flex;gap:var(--s2);flex-wrap:wrap;align-items:center}' +
    '.df .sp{flex:1}' +
    '.conf{background:var(--crit-lo);border-radius:var(--r3);padding:var(--s3);font:var(--f-bsm);width:100%;display:flex;align-items:center;gap:var(--s2)}' +
    // toast: superfície inversa (Tooltip do DS)
    '.toast{position:fixed;left:50%;bottom:var(--s6);transform:translateX(-50%) translateY(var(--s5));background:var(--bg-inv);color:var(--c-inv);border-radius:var(--r3);padding:var(--s3) var(--s4);font:var(--f-bsm);opacity:0;transition:all .18s;pointer-events:none;box-shadow:var(--sh2)}' +
    '.toast.show{opacity:1;transform:translateX(-50%)}' +
    '.modal{position:fixed;inset:0;background:var(--bg-bkd);display:flex;align-items:center;justify-content:center}' +
    // sugestões de melhoria (Dialog, Segmented/Tag, Textarea e Card do DS)
    '.sfoot .ni.sug{color:var(--c-pri)}.sfoot .ni.sug svg{color:var(--brand)}' +
    '.sgbox{width:560px}' +
    '.kinds,.seg{display:flex;gap:var(--s2);flex-wrap:wrap}.kinds{margin:0 0 var(--s1)}.seg{margin:0 0 var(--s2)}' +
    '.kd{height:var(--s8);border:0;box-shadow:inset 0 0 0 var(--b1) var(--bd-sec);background:var(--bg-pri);border-radius:var(--rp);padding:0 var(--s3);font:var(--f-lsm-s);cursor:pointer;color:var(--c-sec);transition:background-color var(--mf)}' +
    '.kd:hover{background-color:var(--bg-sec)}.kd.on{background:var(--brand-lo);color:var(--brand-lo-c);box-shadow:inset 0 0 0 var(--b1) var(--brand)}' +
    'textarea.inp{height:auto;min-height:120px;padding:var(--s3) var(--s4);resize:vertical;font:var(--f-bmd)}' +
    '.cnt{font:var(--f-cap);color:var(--c-ter);text-align:right;margin-top:var(--s1)}' +
    '.sgnote{font:var(--f-cap);color:var(--c-ter);margin-top:var(--s2)}' +
    '.sgl{margin-top:var(--s8);border-top:var(--b1) solid var(--bd-pri);padding-top:var(--s5)}.sgl h2{margin:0 0 var(--s2);font:var(--f-hxs);color:var(--c-pri)}' +
    '.sgi{padding:var(--s3) 0;border-bottom:var(--b1) solid var(--bd-pri)}.sgi:last-child{border-bottom:0}' +
    '.sgh{display:flex;align-items:center;gap:var(--s2);font:var(--f-cap);color:var(--c-ter);margin-bottom:var(--s1);flex-wrap:wrap}.sgh b{color:var(--c-pri);font-weight:var(--cc-semantic-type-caption-weight-strong)}' +
    '.sgt{font:var(--f-bsm);color:var(--c-pri);white-space:pre-wrap;word-wrap:break-word}' +
    '.sgr{margin-top:var(--s2);background:var(--bg-sec);border-radius:var(--r4);padding:var(--s2) var(--s3);font:var(--f-bsm);color:var(--c-sec);white-space:pre-wrap}.sgr b{color:var(--c-pri)}' +
    '.sst,.kchip{display:inline-flex;align-items:center;font:var(--f-lsm-s);border-radius:var(--rp);padding:var(--s0) var(--s2);background:var(--cc-semantic-theme-palette-neutral-low-bg);color:var(--c-sec)}' +
    '.sst.planejada{background:var(--cc-semantic-theme-palette-blue-low-bg);color:var(--cc-semantic-theme-palette-blue-low-content)}' +
    '.sst.em_andamento{background:var(--warn-lo);color:var(--warn-lo-c)}.sst.feita{background:var(--ok-lo);color:var(--ok-lo-c)}.sst.nao_vamos_fazer{background:var(--bg-ter);color:var(--c-ter)}' +
    '.kchip.problema{background:var(--crit-lo);color:var(--crit-lo-c)}.kchip.ideia{background:var(--st-agent-lo);color:var(--st-agent-lo-c)}.kchip.melhoria{background:var(--brand-lo);color:var(--brand-lo-c)}' +
    '.skd{font:var(--f-cap-s);color:var(--c-sec)}' +
    // área do administrador
    '.sgc{background:var(--bg-pri);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:var(--s4);margin-bottom:var(--s2);cursor:pointer;transition:border-color var(--mf),box-shadow var(--mf)}' +
    '.sgc:hover{border-color:var(--bd-str);box-shadow:var(--sh1)}.sgc.on{border-color:var(--brand);box-shadow:inset 0 0 0 var(--b1) var(--brand)}' +
    '.sgc .sgt{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}' +
    '.sgc .pri{margin-left:0}' +
    '.sgf{display:flex;gap:var(--s3);align-items:center;margin-top:var(--s2);font:var(--f-cap);color:var(--c-ter);flex-wrap:wrap}.sgf span{display:inline-flex;align-items:center;gap:var(--s1)}.sgf svg{width:14px;height:14px}' +
    '.fl{font:var(--f-lsm-s);letter-spacing:var(--ls-wide);text-transform:uppercase;color:var(--c-ter);margin:var(--s5) 0 var(--s2)}' +
    '.ctx{display:grid;grid-template-columns:auto 1fr;gap:var(--s1) var(--s3);font:var(--f-cap);color:var(--c-sec);background:var(--bg-sec);border-radius:var(--r3);padding:var(--s3)}.ctx b{color:var(--c-ter);font-weight:var(--cc-semantic-type-caption-weight-strong)}.ctx span{word-break:break-word}' +
    '.drawer textarea.inp{min-height:88px;font:var(--f-bsm)}' +
    '.mbar .msug{width:var(--s10);padding:0}' +
    '.ivc{display:flex;align-items:center;justify-content:space-between;background:var(--bg-ter);border-radius:var(--r4);padding:var(--s3) var(--s4);margin:0 0 var(--s3);font:var(--f-bsm);color:var(--c-sec)}.ivc b{font:var(--f-hlg);letter-spacing:4px;color:var(--c-pri)}' +
    '.tbl td .chip{vertical-align:1px;margin-left:var(--s1)}' +
    '@media (max-width:820px){.app{grid-template-columns:1fr;grid-template-rows:auto 1fr}.side{display:none}.main{min-height:0}' +
    '.mbar{display:flex;gap:var(--s2);align-items:center;padding:var(--s3) var(--s4);background:var(--bg-pri);border-bottom:var(--b1) solid var(--bd-pri)}.mbar select{flex:1;height:var(--s10);border:var(--b1) solid var(--bd-sec);border-radius:var(--r4);padding:0 var(--s8) 0 var(--s3);color:var(--c-pri);font:var(--f-bsm)}' +
    '.board{grid-template-columns:1fr}.stats{grid-template-columns:1fr}.body{padding:var(--s4)}.head{padding:var(--s4) var(--s4) 0}.lbox{padding:var(--s6)}.drawer{width:100vw}}';
  root.innerHTML = '<style>' + CSS + '</style><div class="view"></div><div class="toast"></div>';
  var view = root.querySelector('.view');
  function $(s, el) { return (el || root).querySelector(s); }
  function $$(s, el) { return [].slice.call((el || root).querySelectorAll(s)); }
  var toastT = null;
  function toast(msg) {
    var t = $('.toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function copy(text, msg) {
    var done = function () { toast(msg || 'Link copiado'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; root.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) {} ta.remove(); }
  }

  // ---------------- estado e API ----------------
  var S = {
    session: ls(SKEY), studio: null, projects: [], sel: ls('fb_panel_sel') || 'all',
    detail: null, tab: 'board', f: { page: '', device: '', q: '', round: 'current' }, open: null, sort: ls('fb_panel_sort') || 'page', expanded: {},
  };
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json', 'X-Panel-Session': S.session || '' }, opts.headers || {});
    if (opts.method && opts.method !== 'GET') S.lastWrite = Date.now();
    return fetch(BASE + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 401 && path !== '/api/login') { logout(true); throw new Error('no_session'); }
        if (!r.ok) { var e = new Error(b.error || 'erro'); e.status = r.status; throw e; }
        return b;
      });
    });
  }
  function closePanel() {
    var u = new URL(location.href); u.searchParams.delete('painel');
    location.href = u.pathname + (u.search || '') + u.hash;
  }
  function logout(silent) {
    if (!silent && S.session) api('/api/logout', { method: 'POST' }).catch(function () {});
    S.session = null; ls(SKEY, null); S.studio = null; renderLogin();
  }

  // ---------------- login ----------------
  function renderLogin(err) {
    document.title = 'Painel do estúdio';
    view.innerHTML =
      '<div class="login"><form class="lbox">' +
      '<h1>Painel do estúdio</h1><p>Entre com a senha do seu estúdio.</p>' +
      '<label>Estúdio</label><input class="inp st" autocomplete="username" placeholder="ex.: opengrid">' +
      '<label>Senha</label><input class="inp pw" type="password" autocomplete="current-password">' +
      '<div class="lerr"></div>' +
      '<button class="btn primary full" type="submit">Entrar</button>' +
      '<button class="btn ghost full cl" type="button" style="margin-top:var(--s2)">Voltar ao site</button>' +
      '</form></div>';
    $('.st').value = CFG.studio || ls('fb_panel_studio') || '';
    $('.lerr').textContent = err || '';
    ($('.st').value ? $('.pw') : $('.st')).focus();
    $('.cl').onclick = closePanel;
    $('.lbox').onsubmit = function (e) {
      e.preventDefault();
      var b = $('.lbox button[type=submit]'); b.disabled = true; b.textContent = 'Entrando…';
      api('/api/login', { method: 'POST', body: JSON.stringify({ studio: $('.st').value.trim(), password: $('.pw').value }) }).then(function (r) {
        S.session = r.session; ls(SKEY, r.session); ls('fb_panel_studio', r.studio.id); S.studio = r.studio;
        boot();
      }).catch(function () { renderLogin('Estúdio ou senha incorretos.'); });
    };
  }

  // ---------------- app ----------------
  function boot() {
    return api('/api/overview').then(function (r) {
      S.studio = r.studio; S.projects = r.projects;
      if (S.sel !== 'all' && S.sel !== 'archived' && !S.projects.some(function (p) { return p.id === S.sel; })) S.sel = 'all';
      shell();
      return select(S.sel);
    }).catch(function (e) { if (e.message !== 'no_session') renderLogin('Não foi possível carregar o painel.'); });
  }
  function shell() {
    document.title = 'Painel · ' + S.studio.name;
    view.innerHTML =
      '<div class="app"><aside class="side">' +
      '<div class="brand"><b></b><span>Painel do estúdio</span></div>' +
      '<nav class="nav"></nav>' +
      '<div class="sfoot"><div class="ni sug" title="Mande sugestões de melhoria para a ferramenta">' + ICON.bulb + '<span class="t">Sugerir melhoria</span></div>' +
      '<div class="ni pwd">' + ICON.key + '<span class="t">Trocar senha</span></div>' +
      '<div class="ni lo">' + ICON.out + '<span class="t">Sair</span></div>' +
      '<div class="ni cl">' + ICON.x + '<span class="t">Fechar painel</span></div></div>' +
      '</aside><div class="mbar"><select class="msel"></select><button class="btn ghost msug" title="Sugerir melhoria" aria-label="Sugerir melhoria">' + ICON.bulb + '</button><button class="btn ghost mlo">Sair</button></div><main class="main"></main></div>' +
      '<div class="scrim"></div><aside class="drawer"></aside>';
    $('.brand b').textContent = S.studio.name;
    $('.lo').onclick = function () { logout(false); };
    $('.cl').onclick = closePanel;
    $('.pwd').onclick = changePassword;
    $('.sug').onclick = suggest;
    $('.scrim').onclick = closeDrawer;
    $('.mlo').onclick = function () { logout(false); };
    $('.msug').onclick = suggest;
    $('.msel').onchange = function () { select(this.value); };
    renderNav();
  }
  function actives() { return S.projects.filter(function (p) { return !p.archivedAt; }); }
  function archived() { return S.projects.filter(function (p) { return !!p.archivedAt; }); }
  function renderNav() {
    var nav = $('.nav'); if (!nav) return;
    var act = actives(), arc = archived();
    var item = function (p) {
      var dom = (p.domains || [])[0] || '';
      return '<div class="ni' + (S.sel === p.id ? ' on' : '') + (p.archivedAt ? ' arc' : '') + '" data-id="' + esc(p.id) + '">' +
        '<span class="fav"' + (FAVBG[dom] ? ' style="background:' + FAVBG[dom] + ';box-shadow:none"' : '') + '>' +
        (dom ? '<img alt="" decoding="sync" crossorigin="anonymous" data-dom="' + esc(dom) + '" src="' + FAVICON + '?domain=' + encodeURIComponent(dom) + '">' : '') + ICON.globe + '</span>' +
        '<span class="t"><b>' + esc(p.name) + '</b><span>' + esc((p.domains || [])[0] || '') + (p.archivedAt ? ' · encerrado' : p.paused ? ' · pausado' : '') + '</span></span>' +
        (p.archivedAt ? '' : '<span class="bd' + (p.open ? '' : ' z') + '">' + p.open + '</span>') + '</div>';
    };
    // grupos Ativos/Encerrados: contagem ao lado do nome, chevron abre/fecha a lista (lembrado neste navegador)
    var fold = {}; try { fold = JSON.parse(ls('fb_panel_fold') || '{}') || {}; } catch (e) {}
    var grp = function (key, id, label, n, title, extra) {
      var shut = !!fold[key];
      return '<div class="ni grp' + (S.sel === id ? ' on' : '') + '" data-id="' + id + '"' + (extra || '') + ' title="' + title + '">' +
        '<span class="t"><b>' + label + '</b></span><span class="gc">' + n + '</span>' +
        '<button class="fold' + (shut ? ' shut' : '') + '" type="button" data-fold="' + key + '" aria-expanded="' + !shut + '" aria-label="' + (shut ? 'Mostrar' : 'Esconder') + ' os projetos ' + label.toLowerCase() + '" title="' + (shut ? 'Mostrar' : 'Esconder') + ' projetos">' + ICON.chev + '</button></div>' +
        (shut ? '' : '<div class="nsep" role="separator"></div>');
    };
    var h = grp('act', 'all', 'Ativos', act.length, 'Ver todos os projetos ativos');
    if (!fold.act) {
      if (!act.length) h += '<div class="emp">Nenhum site ativo. Cole o snippet num site de staging e abra a revisão.</div>';
      act.forEach(function (p) { h += item(p); });
    }
    h += '<div class="nsep" role="separator"></div>' + grp('arc', 'archived', 'Encerrados', arc.length, 'Ver todos os projetos encerrados');
    if (!fold.arc) {
      if (!arc.length) h += '<div class="emp" style="padding:var(--s2) var(--s3);text-align:left">Nenhum projeto encerrado.</div>';
      arc.forEach(function (p) { h += item(p); });
    }
    // reaproveita os favicons já carregados (não piscam quando a lista é redesenhada)
    var keep = {}; $$('.fav img', nav).forEach(function (im) { if (im.complete && im.naturalWidth) keep[im.getAttribute('src')] = im; });
    nav.innerHTML = h;
    $$('.fav img', nav).forEach(function (im) { var o = keep[im.getAttribute('src')]; if (o) im.parentNode.replaceChild(o, im); });
    var ms = $('.msel');
    if (ms) {
      ms.innerHTML = '<optgroup label="Ativos"><option value="all">Todos os ativos</option>' + act.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.open ? ' (' + p.open + ')' : '') + '</option>'; }).join('') + '</optgroup>' +
        '<optgroup label="Encerrados"><option value="archived">Todos os encerrados</option>' + arc.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</optgroup>';
      ms.value = S.sel;
    }
    $$('.ni[data-id]', nav).forEach(function (el) { el.onclick = function () { select(el.dataset.id); }; });
    $$('.fav img', nav).forEach(function (im) {
      if (im.__fb) return; im.__fb = true;
      im.onload = function () { favTint(im); };
      // sem CORS no servidor do ícone: carrega sem ler a cor; se nem assim, mostra o globo
      im.onerror = function () { if (im.getAttribute('crossorigin') !== null) { im.removeAttribute('crossorigin'); im.src = im.src; } else im.className = 'x'; };
      if (im.complete && im.naturalWidth) favTint(im);
    });
    $$('.fold', nav).forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); fold[b.dataset.fold] = !fold[b.dataset.fold]; ls('fb_panel_fold', JSON.stringify(fold)); renderNav(); };
    });
  }
  function select(id) {
    S.sel = id; ls('fb_panel_sel', id); renderNav(); closeDrawer();
    if (id === 'all' || id === 'archived') { S.detail = null; renderOverview(id === 'archived'); return Promise.resolve(); }
    $('.main').innerHTML = '<div class="body"><div class="emp">Carregando…</div></div>';
    return loadProject(id);
  }
  function loadProject(id) {
    return api('/api/projects/' + encodeURIComponent(id)).then(function (d) {
      if (S.sel !== id) return;
      S.detail = d; S.nums = numbers(d.comments);
      var p = S.projects.find(function (x) { return x.id === id; });
      if (p) { p.open = d.comments.filter(function (c) { return !isDone(c); }).length; p.resolved = d.comments.length - p.open; p.paused = d.project.paused; renderNav(); }
      renderProject();
    });
  }

  // ---------------- visão geral ----------------
  function renderOverview(arc) {
    var list = arc ? archived() : actives(), open = 0, res = 0;
    list.forEach(function (p) { open += p.open; res += p.resolved; });
    var h = '<header class="head" style="padding-bottom:var(--s5)"><div class="hrow"><h2>' + (arc ? 'Projetos encerrados' : 'Projetos ativos') + '</h2></div>' +
      (arc ? '<p class="sub" style="margin:var(--s2) 0 0">Projetos encerrados não aparecem para o cliente (a revisão fica desativada). Reabra quando precisar voltar a um deles.</p>' : '') + '</header><div class="body">';
    if (!arc) h += '<div class="stats"><div class="stat"><span>Sites ativos</span><b>' + list.length + '</b></div>' +
      '<div class="stat"><span>Comentários abertos</span><b>' + open + '</b></div>' +
      '<div class="stat"><span>Resolvidos</span><b>' + res + '</b></div></div>';
    h += '<div class="cards">';
    list.slice().sort(function (a, b) {
      var ka = arc ? a.archivedAt : a.lastActivity, kb = arc ? b.archivedAt : b.lastActivity;
      return (kb || '') < (ka || '') ? -1 : 1;
    }).forEach(function (p) {
      var t = p.open + p.resolved;
      h += '<div class="sc' + (arc ? ' arc' : '') + '" data-id="' + esc(p.id) + '"><h3>' + esc(p.name) + (arc ? ' <span class="chip gray">Encerrado</span>' : p.paused ? ' <span class="chip">Pausado</span>' : '') + '</h3>' +
        '<div class="d">' + esc((p.domains || [])[0] || '') + ' · Rodada ' + (p.round || 1) + (p.roundName ? ' · ' + esc(p.roundName) : '') + (p.roundStatus === 'pending' ? ' (aguardando)' : '') + '</div>' +
        '<div class="bar">' + (t ? '<i style="width:' + (p.open / t * 100) + '%"></i><u style="width:' + (p.resolved / t * 100) + '%"></u>' : '') + '</div>' +
        '<div class="n"><span><b>' + p.open + '</b> abertos</span><span><b>' + p.resolved + '</b> resolvidos</span><span><b>' + p.approvedPages + '</b> ' + (p.approvedPages === 1 ? 'página aprovada' : 'páginas aprovadas') + '</span></div>' +
        (arc ? '<div class="l" style="display:flex;align-items:center;gap:var(--s2)">Encerrado em ' + esc(new Date(p.archivedAt).toLocaleDateString('pt-BR')) + '<button class="btn ghost reo sm" style="margin-left:auto">Reabrir</button></div>'
          : '<div class="l">Último comentário: ' + esc(p.lastActivity ? ago(p.lastActivity) : 'nenhum') + '</div>') + '</div>';
    });
    h += '</div>' + (list.length ? '' : '<div class="emp">' + (arc ? 'Nenhum projeto encerrado. Use "Encerrar projeto" dentro de um site para tirá-lo da lista de ativos.' : 'Os sites aparecem aqui quando o snippet do estúdio é aberto pela primeira vez em um domínio de staging.') + '</div>') + '</div>';
    $('.main').innerHTML = h;
    $$('.sc').forEach(function (el) {
      el.onclick = function () { select(el.dataset.id); };
      var rb = $('.reo', el); if (rb) rb.onclick = function (e) { e.stopPropagation(); setArchived(el.dataset.id, false); };
    });
  }
  function setArchived(id, v) {
    api('/api/projects/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ archived: v }) }).then(function (r) {
      var p = S.projects.find(function (x) { return x.id === id; });
      if (p) { p.archivedAt = r.archived_at; p.paused = r.paused; }
      if (S.detail && S.detail.project.id === id) { S.detail.project.archivedAt = r.archived_at; S.detail.project.paused = r.paused; }
      toast(v ? 'Projeto encerrado: saiu da lista de ativos e a revisão foi desativada' : 'Projeto reaberto e revisão ativada');
      renderNav();
      if (S.sel === id) renderProject(); else select(S.sel);
    });
  }
  function confirmArchive() {
    var p = S.detail.project;
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<form class="lbox" style="width:420px"><h1>Encerrar projeto</h1><p>' +
      '<b></b> sai da lista de ativos e a revisão é desativada no site (o botão Revisar some). Os comentários, rodadas e links ficam guardados.</p>' +
      '<p>Você encontra o projeto em <b>Encerrados</b> e pode reabrir quando quiser.</p>' +
      '<button class="btn primary full" type="submit">Encerrar projeto</button><button class="btn ghost full cn" type="button" style="margin-top:var(--s2)">Cancelar</button></form>';
    $('p b', m).textContent = p.name;
    root.appendChild(m);
    $('.cn', m).onclick = function () { m.remove(); };
    $('form', m).onsubmit = function (e) { e.preventDefault(); m.remove(); setArchived(p.id, true); };
  }

  // ---------------- site ----------------
  function renderProject() {
    var d = S.detail, p = d.project, cs = d.comments;
    var open = cs.filter(function (c) { return !isDone(c); }).length;
    var dom = (p.domains || [])[0] || '';
    $('.main').innerHTML =
      '<header class="head"><div class="hrow"><h2></h2>' +
      (dom ? '<a class="dom" target="_blank" rel="noopener">' + ICON.ext + '<span></span></a>' : '') +
      '<div class="hact">' + (p.archivedAt ? '<span class="chip gray">Encerrado em ' + esc(new Date(p.archivedAt).toLocaleDateString('pt-BR')) + '</span><button class="btn primary reo">Reabrir projeto</button>' :
        '<span class="sw pause' + (p.paused ? '' : ' on') + '" title="Com a revisão pausada, o botão Revisar some do site"><i></i><span></span></span>' +
        (p.reviewUrl ? '<button class="btn ghost cpy">' + ICON.link + 'Copiar link de revisão</button>' : '') +
        '<button class="btn ghost arcb" title="Tira o site da lista de ativos e desativa a revisão">' + ICON.archive + 'Encerrar projeto</button>') + '</div></div>' +
      (p.archivedAt ? '<div class="banner">Projeto encerrado: o cliente não vê mais o botão Revisar. O histórico continua aqui; clique em <b>Reabrir projeto</b> para voltar a trabalhar nele.</div>' : '') +
      roundBar() +
      '<div class="tabs"><button class="tab" data-t="board">Board<span class="c">' + open + '</span></button>' +
      '<button class="tab" data-t="pages">Páginas</button>' +
      '<button class="tab" data-t="links">Links de revisão<span class="c">' + d.reviewers.filter(function (r) { return r.active; }).length + '</span></button>' +
      '<button class="tab" data-t="rounds">Rodadas</button>' +
      '<button class="tab" data-t="slack">Slack' + (p.slack && p.slack.configured ? '<span class="c" style="color:var(--st-done)">●</span>' : '') + '</button></div></header>' +
      '<div class="body"></div>';
    $('.hrow h2').textContent = p.name;
    if (dom) { $('.dom').href = 'https://' + dom + '/'; $('.dom span').textContent = dom; }
    if ($('.pause')) { $('.pause span').textContent = p.paused ? 'Revisão pausada' : 'Revisão ativa'; $('.pause').onclick = function () { setPaused(!p.paused); }; }
    if ($('.arcb')) $('.arcb').onclick = confirmArchive;
    if ($('.reo')) $('.reo').onclick = function () { setArchived(p.id, false); };
    if ($('.orb')) $('.orb').onclick = openRound;
    if ($('.cpy')) $('.cpy').onclick = function () { copyLink(p.reviewUrl); };
    if ($('.crb')) $('.crb').onclick = closeRound;
    if ($('.rnb')) $('.rnb').onclick = function () { renameRound(curRound()); };
    $$('.tab').forEach(function (t) {
      t.classList.toggle('on', t.dataset.t === S.tab);
      t.onclick = function () { S.tab = t.dataset.t; renderProject(); };
    });
    if (S.tab === 'pages') renderPages(); else if (S.tab === 'links') renderLinks(); else if (S.tab === 'rounds') renderRounds(); else if (S.tab === 'slack') renderSlack(); else renderBoard();
  }
  function setPaused(v) {
    api('/api/projects/' + encodeURIComponent(S.detail.project.id), { method: 'PATCH', body: JSON.stringify({ paused: v }) }).then(function () {
      S.detail.project.paused = v;
      var p = S.projects.find(function (x) { return x.id === S.detail.project.id; }); if (p) p.paused = v;
      renderNav(); renderProject(); toast(v ? 'Revisão pausada: o botão some do site' : 'Revisão ativada');
    });
  }

  // ---------------- rodadas ----------------
  // rodada vigente: a aberta, ou a que está aguardando ser aberta
  function curRound() { var rs = (S.detail && S.detail.rounds) || []; return rs.filter(function (r) { return r.status === 'open' || r.status === 'pending'; }).pop() || rs[rs.length - 1] || null; }
  // "Rodada 3 · Home v2" (o nome é opcional)
  function rLabel(r) { return 'Rodada ' + r.number + (r.name ? ' · ' + r.name : ''); }
  function roundBar() {
    var r = curRound(); if (!r) return '';
    var RN = S.detail.project.archivedAt ? '' : '<button class="rnb" title="Dar nome à rodada">' + ICON.edit + '</button>';
    if (r.status === 'pending') {
      var prev = (S.detail.rounds || []).filter(function (x) { return x.number === r.number - 1; })[0];
      return '<div class="hrow" style="margin-top:var(--s2)"><span class="rchip off">' + ICON.flag + (prev ? 'Rodada ' + prev.number + ' fechada · ' : '') + esc(rLabel(r)) + ' aguardando' + RN + '</span>' +
        (S.detail.project.archivedAt ? '' : '<button class="btn primary orb sm">Abrir Rodada ' + r.number + '</button>') + '</div>';
    }
    return '<div class="hrow" style="margin-top:var(--s2)"><span class="rchip">' + ICON.flag + esc(rLabel(r)) + ' · desde ' + esc(new Date(r.startedAt).toLocaleDateString('pt-BR')) + RN + '</span>' +
      (S.detail.project.archivedAt ? '' : '<button class="btn ghost crb sm">Fechar rodada</button>') + '</div>';
  }
  function openRound() {
    var r = curRound(); if (!r || r.status !== 'pending') return;
    api('/api/projects/' + encodeURIComponent(S.detail.project.id) + '/rounds/open', { method: 'POST' }).then(function (res) {
      var p = S.projects.find(function (x) { return x.id === S.detail.project.id; }); if (p) { p.round = res.opened; p.roundStatus = 'open'; }
      toast('Rodada ' + res.opened + ' aberta'); loadProject(S.detail.project.id);
    }).catch(function () { toast('Não foi possível abrir a rodada'); });
  }
  function roundCounts(r) {
    var cs = S.detail.comments.filter(function (c) { return c.round_id === r.id; });
    var res = cs.filter(isDone).length;
    return { total: cs.length, resolved: res, open: cs.length - res };
  }
  function closeRound() {
    var r = curRound(); if (!r || r.status !== 'open') return;
    var k = roundCounts(r), sl = S.detail.project.slack;
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<form class="lbox" style="width:420px"><h1>Fechar a ' + esc(rLabel(r)) + '</h1><p>A Rodada ' + (r.number + 1) + ' fica <b>aguardando</b> até você abri-la (ex.: quando enviar a nova versão ao cliente). O histórico fica na aba Rodadas.</p>' +
      '<div class="sumg"><div><b>' + k.total + '</b>pedidos</div><div><b>' + k.resolved + '</b>entregues</div><div><b>' + k.open + '</b>em aberto</div></div>' +
      '<label class="chk"><input type="checkbox" class="carry" checked> <span>Levar os ' + k.open + ' comentários em aberto para a Rodada ' + (r.number + 1) + '</span></label>' +
      '<label>Nome da Rodada ' + (r.number + 1) + ' <span style="color:var(--c-ter)">(opcional)</span></label><input class="inp nn" maxlength="60" placeholder="Ex.: Ajustes da home, Versão final…">' +
      '<label class="chk' + (sl.configured ? '' : ' dis') + '"><input type="checkbox" class="sl"' + (sl.configured ? ' checked' : ' disabled') + '> <span>Enviar o resumo da rodada para o Slack' + (sl.configured ? '' : ' <i>(configure na aba Slack)</i>') + '</span></label>' +
      '<div class="lerr"></div><button class="btn primary full" type="submit">Fechar rodada</button><button class="btn ghost full cn" type="button" style="margin-top:var(--s2)">Cancelar</button></form>';
    root.appendChild(m);
    $('.cn', m).onclick = function () { m.remove(); };
    $('form', m).onsubmit = function (e) {
      e.preventDefault();
      var bt = $('button[type=submit]', m); bt.disabled = true; bt.textContent = 'Fechando…';
      api('/api/projects/' + encodeURIComponent(S.detail.project.id) + '/rounds/close', { method: 'POST', body: JSON.stringify({ carry: $('.carry', m).checked, slack: !!($('.sl', m) && $('.sl', m).checked), nextName: $('.nn', m).value.trim() }) }).then(function (res) {
        m.remove();
        var p = S.projects.find(function (x) { return x.id === S.detail.project.id; }); if (p) { p.round = res.next; p.roundStatus = 'pending'; }
        S.f.round = 'current';
        toast('Rodada ' + res.closed + ' fechada · Rodada ' + res.next + ' aguardando' + (res.slack ? (res.slack.ok ? ' · resumo enviado ao Slack' : ' · Slack falhou') : ''));
        loadProject(S.detail.project.id);
      }).catch(function () { bt.disabled = false; bt.textContent = 'Fechar rodada'; $('.lerr', m).textContent = 'Não foi possível fechar a rodada.'; });
    };
  }
  function renameRound(r) {
    if (!r) return;
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<form class="lbox" style="width:400px"><h1>Nome da Rodada ' + r.number + '</h1><p>Um nome curto ajuda a lembrar o que foi entregue (ex.: "Home v2", "Ajustes finais"). Aparece no painel e no Slack.</p>' +
      '<input class="inp rnm" maxlength="60" placeholder="Ex.: Ajustes da home"><div class="lerr"></div>' +
      '<button class="btn primary full" type="submit">Salvar</button>' +
      (r.name ? '<button class="btn ghost full rm" type="button" style="margin-top:var(--s2)">Tirar o nome</button>' : '') +
      '<button class="btn ghost full cn" type="button" style="margin-top:var(--s2)">Cancelar</button></form>';
    root.appendChild(m);
    var inp = $('.rnm', m); inp.value = r.name || ''; inp.focus(); inp.select();
    $('.cn', m).onclick = function () { m.remove(); };
    function save(name) {
      api('/api/projects/' + encodeURIComponent(S.detail.project.id) + '/rounds/' + r.id, { method: 'PATCH', body: JSON.stringify({ name: name }) }).then(function (res) {
        r.name = res.name || null; m.remove();
        var cr = curRound(), p = S.projects.find(function (x) { return x.id === S.detail.project.id; });
        if (p && cr && cr.id === r.id) p.roundName = r.name;
        toast(r.name ? 'Rodada ' + r.number + ' agora se chama "' + r.name + '"' : 'Nome da rodada removido');
        renderNav(); renderProject();
      }).catch(function () { $('.lerr', m).textContent = 'Não foi possível salvar o nome.'; });
    }
    if ($('.rm', m)) $('.rm', m).onclick = function () { save(''); };
    $('form', m).onsubmit = function (e) { e.preventDefault(); save(inp.value.trim()); };
  }
  function renderRounds() {
    var body = $('.body'), rs = (S.detail.rounds || []).slice().reverse();
    body.innerHTML = '<p class="sub">Cada rodada guarda o que foi pedido e o que foi entregue. Feche a rodada quando enviar uma nova versão para o cliente.</p><div class="rounds"></div>';
    var list = $('.rounds', body);
    rs.forEach(function (r) {
      var open = r.status === 'open', pend = r.status === 'pending', k = (open || pend) ? roundCounts(r) : (r.summary || {});
      var el = document.createElement('div'); el.className = 'rd' + (open ? ' cur' : '') + (pend ? ' pend' : '');
      var canAct = !S.detail.project.archivedAt;
      el.innerHTML = '<div><h4>Rodada ' + r.number + (r.name ? ' <em>· ' + esc(r.name) + '</em>' : '') + (canAct ? '<button class="rn" title="' + (r.name ? 'Renomear' : 'Dar nome') + '">' + ICON.edit + '</button>' : '') + (open ? ' <span class="chip g">Atual</span>' : pend ? ' <span class="chip gray">Aguardando</span>' : '') + '</h4><div class="dt">' +
        (open ? 'Desde ' + esc(fmtDate(r.startedAt)) : pend ? 'Ainda não começou' + (k.total ? ' · ' + k.total + ' comentário(s) já esperando' : '') :
          (r.startedAt ? esc(new Date(r.startedAt).toLocaleDateString('pt-BR')) + ' → ' : '') + esc(new Date(r.closedAt).toLocaleDateString('pt-BR'))) + '</div></div>' +
        (pend ? '<div class="nums"><span><b>' + (k.open || 0) + '</b>levados</span></div>' :
          '<div class="nums"><span><b>' + (k.total || 0) + '</b>pedidos</span><span><b>' + (k.resolved || 0) + '</b>entregues</span>' +
          (open ? '<span><b>' + (k.open || 0) + '</b>em aberto</span>' : '<span><b>' + (k.carried || 0) + '</b>levados</span>') + '</div>') +
        '<button class="btn ghost vb">Ver no board</button>' +
        (canAct && open ? '<button class="btn primary cr">' + ICON.flag + 'Fechar rodada</button>' : '') +
        (canAct && pend ? '<button class="btn primary orb2">' + ICON.flag + 'Abrir Rodada ' + r.number + '</button>' : '');
      $('.vb', el).onclick = function () { S.f.round = (open || pend) ? 'current' : r.id; S.tab = 'board'; renderProject(); };
      if ($('.cr', el)) $('.cr', el).onclick = closeRound;
      if ($('.rn', el)) $('.rn', el).onclick = function () { renameRound(r); };
      if ($('.orb2', el)) $('.orb2', el).onclick = openRound;
      list.appendChild(el);
    });
  }

  // ---------------- Slack ----------------
  function toSlack(ids, title) {
    var sl = S.detail.project.slack;
    if (!sl.configured) { S.tab = 'slack'; renderProject(); toast('Configure o Slack deste site primeiro'); return; }
    if (!ids.length) { toast('Nenhum comentário para enviar'); return; }
    api('/api/projects/' + encodeURIComponent(S.detail.project.id) + '/slack/send', { method: 'POST', body: JSON.stringify({ ids: ids, title: title || undefined }) })
      .then(function (r) { toast(r.sent === 1 ? 'Comentário enviado ao Slack' : r.sent + ' comentários enviados ao Slack'); })
      .catch(function (e) { toast(e.message === 'webhook_invalido' ? 'O Slack recusou o webhook. Confira na aba Slack.' : 'Não foi possível enviar ao Slack'); });
  }
  function renderSlack() {
    var body = $('.body'), d = S.detail, sl = d.project.slack, pid = encodeURIComponent(d.project.id);
    body.innerHTML =
      '<div class="box"><h4>Canal do Slack deste site</h4>' +
      (sl.configured ? '<p><span class="okline">' + ICON.check + 'Conectado</span> <span style="color:var(--c-ter);font:var(--f-cap);margin-left:var(--s2)"></span></p>' :
        '<p>Cole o endereço de um <b>Incoming Webhook</b> do Slack. Ele define o canal que recebe as mensagens.</p>' +
        '<ol><li>Abra <b>api.slack.com/apps</b> → <b>Create New App</b> → <b>From scratch</b>, escolha o workspace.</li>' +
        '<li>Em <b>Incoming Webhooks</b>, ative e clique em <b>Add New Webhook to Workspace</b>.</li>' +
        '<li>Escolha o canal (ex.: #cliente-flowout) e copie o endereço que começa com <b>https://hooks.slack.com/</b>.</li></ol>') +
      '<div class="row"><input class="inp wh" placeholder="https://hooks.slack.com/services/…"><button class="btn primary sv">' + (sl.configured ? 'Trocar' : 'Salvar') + '</button>' +
      (sl.configured ? '<button class="btn ghost ts">Enviar teste</button><button class="btn danger rm">Remover</button>' : '') + '</div><div class="lerr"></div></div>' +
      '<div class="box"><h4>Avisos automáticos</h4><p>Manda uma mensagem no canal a cada comentário novo e a cada página aprovada.</p>' +
      '<span class="sw nt' + (sl.notify ? ' on' : '') + (sl.configured ? '' : '" style="opacity:.45;pointer-events:none') + '"><i></i><span>' + (sl.notify ? 'Avisos ligados' : 'Avisos desligados') + '</span></span></div>' +
      '<div class="box"><h4>Enviar manualmente</h4><p>No <b>Board</b>, o botão <b>Enviar ao Slack</b> manda os comentários em aberto que estão na tela (respeitando os filtros). No detalhe de um comentário, dá para enviar só ele. Ao fechar uma rodada, o resumo pode ir junto.</p></div>';
    if (sl.configured) $('.okline + span', body).textContent = sl.masked || '';
    var err = $('.lerr', body);
    var save = function (payload, msg) {
      return api('/api/projects/' + pid + '/slack', { method: 'PATCH', body: JSON.stringify(payload) }).then(function (r) {
        d.project.slack = r; renderSlack(); if (msg) toast(msg);
      }).catch(function (e) { err.textContent = e.message === 'webhook_invalido' ? 'Esse endereço não parece um webhook do Slack (https://hooks.slack.com/…).' : 'Não foi possível salvar.'; });
    };
    $('.sv', body).onclick = function () { var v = $('.wh', body).value.trim(); if (!v) { err.textContent = 'Cole o endereço do webhook.'; return; } save({ webhook: v }, 'Slack conectado'); };
    if ($('.ts', body)) $('.ts', body).onclick = function () {
      api('/api/projects/' + pid + '/slack/test', { method: 'POST' }).then(function () { toast('Mensagem de teste enviada'); })
        .catch(function (e) { err.textContent = e.message === 'webhook_invalido' ? 'O Slack recusou o webhook (removido ou incorreto).' : 'O Slack não respondeu. Tente de novo.'; });
    };
    if ($('.rm', body)) $('.rm', body).onclick = function () { save({ webhook: null }, 'Slack desconectado'); };
    $('.nt', body).onclick = function () { save({ notify: !sl.notify }, !sl.notify ? 'Avisos automáticos ligados' : 'Avisos automáticos desligados'); };
  }

  // ---------------- board ----------------
  function pagesOf(cs) {
    var set = {}; cs.forEach(function (c) { set[c.path] = 1; });
    (S.detail.approvals || []).forEach(function (a) { set[a.path] = 1; });
    return Object.keys(set).sort();
  }
  function filtered() {
    var f = S.f, q = f.q.toLowerCase();
    return S.detail.comments.filter(function (c) {
      var cr = curRound();
      if (f.round === 'current' && cr && c.round_id !== cr.id) return false;
      if (f.round !== 'current' && f.round !== 'all' && c.round_id !== f.round) return false;
      if (f.page && c.path !== f.page) return false;
      if (f.device && (isGeneral(c) || (c.device || 'desktop') !== f.device)) return false;
      if (q && (c.text + ' ' + c.author).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderBoard() {
    var body = $('.body'), cs = S.detail.comments;
    var pages = pagesOf(cs);
    if (S.f.page && pages.indexOf(S.f.page) < 0) S.f.page = '';
    body.innerHTML =
      '<div class="fbar"><select class="fp"><option value="">Todas as páginas</option>' +
      pages.map(function (p) { return '<option value="' + esc(p) + '">' + esc(pageLabel(p)) + '</option>'; }).join('') + '</select>' +
      '<select class="fd"><option value="">Todos os dispositivos</option><option value="desktop">Desktop</option><option value="tablet">Tablet</option><option value="mobile">Mobile</option></select>' +
      '<select class="fr"><option value="current">Rodada atual' + (curRound() && curRound().name ? ' · ' + esc(curRound().name) : '') + '</option><option value="all">Todas as rodadas</option>' +
      (S.detail.rounds || []).filter(function (r) { return r.status === 'closed'; }).reverse().map(function (r) { return '<option value="' + r.id + '">' + esc(rLabel(r)) + ' (fechada)</option>'; }).join('') + '</select>' +
      '<input class="fq" type="search" placeholder="Buscar texto ou autor…">' +
      // priorização por IA: pausada (fica no backlog); só aparece se a chave da IA estiver cadastrada
      (S.detail.ai ? '<select class="fs"><option value="page">Ordenar por página</option><option value="ai">Ordenar por prioridade (IA)</option></select>' +
        '<button class="btn ai tai" style="margin-left:auto" title="A IA lê os comentários em aberto e ordena por urgência">' + ICON.spark + 'Priorizar com IA</button>' : '') +
      '<button class="btn agt tag"' + (S.detail.ai ? '' : ' style="margin-left:auto"') + ' title="Manda os comentários em aberto (com os filtros atuais) para o agente resolver">' + ICON.bot + 'Resolver com Agente</button>' +
      '<button class="btn ghost tsl">' + ICON.slack + 'Enviar ao Slack</button></div>' +
      '<div class="board"><section class="col" data-s="open"><div class="ch"><i style="background:var(--st-open)"></i>Aberto <span class="c"></span></div><div class="list"></div></section>' +
      '<section class="col ag" data-s="agent"><div class="ch"><i style="background:var(--st-agent)"></i>Com o agente <span class="c"></span><button class="hint" title="Como chamar o agente">Como rodar</button></div><div class="list"></div></section>' +
      '<section class="col rv" data-s="review"><div class="ch"><i style="background:var(--st-review)"></i>Para conferir <span class="c"></span></div><div class="list"></div></section>' +
      '<section class="col done" data-s="resolved"><div class="ch"><i style="background:var(--st-done)"></i>Resolvido <span class="c"></span></div><div class="list"></div></section></div>';
    $('.fp').value = S.f.page; $('.fd').value = S.f.device; $('.fq').value = S.f.q;
    if (S.f.round !== 'current' && S.f.round !== 'all' && !(S.detail.rounds || []).some(function (r) { return r.id === S.f.round; })) S.f.round = 'current';
    $('.fr').value = S.f.round;
    $('.fr').onchange = function () { S.f.round = this.value; fillBoard(); };
    if (!S.detail.ai) S.sort = 'page';
    if ($('.fs')) { $('.fs').value = S.sort; $('.fs').onchange = function () { S.sort = this.value; ls('fb_panel_sort', S.sort); fillBoard(); }; }
    if ($('.tai')) $('.tai').onclick = prioritize;
    $('.tag').onclick = function () {
      var ids = filtered().filter(function (c) { return colOf(c) === 'open'; }).map(function (c) { return c.id; });
      if (!ids.length) { toast('Nenhum comentário em aberto para mandar ao agente'); return; }
      sendToAgent(ids);
    };
    $('.hint').onclick = function () { agentHelp(0); };
    $('.tsl').onclick = function () {
      var ids = filtered().filter(function (c) { return !isDone(c); }).map(function (c) { return c.id; });
      toSlack(ids);
    };
    $('.fp').onchange = function () { S.f.page = this.value; fillBoard(); };
    $('.fd').onchange = function () { S.f.device = this.value; fillBoard(); };
    $('.fq').oninput = function () { S.f.q = this.value.trim(); fillBoard(); };
    $$('.col').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault(); col.classList.remove('over');
        var id = e.dataTransfer.getData('text/plain'), c = S.detail.comments.find(function (x) { return x.id === id; });
        if (c && colOf(c) !== col.dataset.s) moveTo(c, col.dataset.s);
      });
    });
    fillBoard();
  }
  var PRI = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  function cardHTML(c, dupCount, isChild) {
    var gen = isGeneral(c), dev = c.device || 'desktop', nr = (c.replies || []).length;
    return '<div class="card" draggable="true" data-id="' + c.id + '">' +
      '<div class="num' + (gen ? ' g' : '') + '">' + esc(S.nums[c.id]) + '</div><div class="cc">' +
      '<div class="cp">' + (gen ? ICON.page + 'Geral' : ICON[dev] + DEV[dev]) + ' · ' + esc(pageLabel(c.path)) +
      (c.ai_priority && !isDone(c) ? '<span class="pri ' + c.ai_priority + '" title="Prioridade sugerida pela IA">' + PRI[c.ai_priority] + '</span>' : '') + '</div>' +
      '<div class="tx">' + esc(c.text) + '</div>' +
      (c.ai_reason && !isDone(c) && S.sort === 'ai' ? '<div class="why">' + ICON.spark + ' ' + esc(c.ai_reason) + '</div>' : '') +
      (c.agent_note && colOf(c) === 'review' ? '<div class="agn' + (c.agent_status === 'blocked' ? ' q' : '') + '">' + ICON.bot + '<span>' + (c.agent_status === 'blocked' ? '<b>Precisa de você:</b> ' : '') + esc(c.agent_note) + '</span></div>' : '') +
      (c.screenshot && !isChild ? '<img class="th" loading="lazy" alt="" src="' + esc(c.screenshot) + '">' : '') +
      '<div class="cm"><b>' + esc(c.author) + '</b><span>' + esc(ago(c.createdAt)) + '</span>' +
      (nr ? '<span class="r">' + ICON.chat + nr + '</span>' : '') +
      (dupCount ? '<span class="dupb" data-g="' + c.id + '" title="Comentários no mesmo elemento ou com o mesmo pedido">' + ICON.stack + '+' + dupCount + ' parecido' + (dupCount > 1 ? 's' : '') + '</span>' : '') +
      '<button class="qa">' + (isDone(c) ? 'Reabrir' : ICON.check + (colOf(c) === 'review' ? 'Conferido' : 'Resolver')) + '</button></div></div></div>';
  }
  // Chave do elemento comentado (mesma página + mesmo breakpoint + mesmo elemento = duplicado)
  function elementKey(c) {
    var a = c.anchor || {};
    if (isGeneral(c)) return null;
    var el = a.css ? 'css:' + a.css.sel + '#' + a.css.index : a.framer ? 'fr:' + (a.framer.chain || []).join('/') + '#' + a.framer.index + ':' + JSON.stringify(a.framer.sub || []) : a.path ? 'p:' + JSON.stringify(a.path) : null;
    return el ? c.path + '|' + (c.device || 'desktop') + '|' + el : null; // mesma página + mesmo breakpoint + mesmo elemento
  }
  // Agrupa: mesmo elemento na mesma página, ou mesmo pedido segundo a IA (ai_group)
  function groupsOf(items) {
    var parent = {}, find = function (x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    items.forEach(function (c) { parent[c.id] = c.id; });
    var join = function (a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
    var byKey = {};
    items.forEach(function (c) {
      [elementKey(c), c.ai_group ? 'ai:' + c.ai_group : null].forEach(function (k) {
        if (!k) return;
        if (byKey[k]) join(byKey[k], c.id); else byKey[k] = c.id;
      });
    });
    var out = {};
    items.forEach(function (c) { var r = find(c.id); (out[r] = out[r] || []).push(c); });
    return Object.keys(out).map(function (k) { return out[k]; });
  }
  function fillBoard() {
    var list = filtered();
    var byPage = function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : new Date(a.created_at) - new Date(b.created_at); };
    var byAi = function (a, b) { var ra = a.ai_rank || 1e9, rb = b.ai_rank || 1e9; return ra !== rb ? ra - rb : byPage(a, b); };
    var order = S.sort === 'ai' ? byAi : byPage;
    var EMP = { open: S.detail.comments.length ? 'Nada em aberto com esses filtros.' : 'Nenhum comentário ainda.<br>Os comentários feitos no site aparecem aqui.',
      agent: 'Arraste cards para cá ou use <b>Resolver com Agente</b>.', review: 'O que o agente ajustar aparece aqui para você conferir.', resolved: 'Arraste um card para cá para resolver.' };
    ['open', 'agent', 'review', 'resolved'].forEach(function (s) {
      var col = $('.col[data-s=' + s + ']'), items = list.filter(function (c) { return colOf(c) === s; });
      $('.c', col).textContent = items.length;
      var groups = groupsOf(items).map(function (g) { return g.sort(order); }).sort(function (a, b) { return order(a[0], b[0]); });
      var html = groups.map(function (g) {
        var lead = g[0], rest = g.slice(1), open = !!S.expanded[lead.id];
        return cardHTML(lead, rest.length, false) + (rest.length && open ? '<div class="dups">' + rest.map(function (c) { return cardHTML(c, 0, true); }).join('') + '</div>' : '');
      }).join('');
      $('.list', col).innerHTML = items.length ? html : '<div class="emp">' + EMP[s] + '</div>';
    });
    $$('.card').forEach(function (el) {
      var c = S.detail.comments.find(function (x) { return x.id === el.dataset.id; });
      el.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); });
      el.onclick = function () { openDrawer(c); };
      $('.qa', el).onclick = function (e) { e.stopPropagation(); setStatus(c, isDone(c) ? 'open' : 'resolved'); };
      var db = $('.dupb', el); if (db) db.onclick = function (e) { e.stopPropagation(); S.expanded[c.id] = !S.expanded[c.id]; fillBoard(); };
    });
  }
  function prioritize() {
    if (S.detail.ai === false) { aiHelp(); return; }
    var ids = filtered().filter(function (c) { return !isDone(c); }).map(function (c) { return c.id; });
    if (!ids.length) { toast('Nenhum comentário em aberto para priorizar'); return; }
    var b = $('.tai'); b.disabled = true; b.innerHTML = ICON.spark + 'Analisando ' + ids.length + '…';
    api('/api/projects/' + encodeURIComponent(S.detail.project.id) + '/ai/prioritize', { method: 'POST', body: JSON.stringify({ ids: ids }) }).then(function (r) {
      S.sort = 'ai'; ls('fb_panel_sort', 'ai');
      toast('IA priorizou ' + r.done + ' comentário(s)' + (r.groups ? ' · ' + r.groups + ' com pedido parecido' : ''));
      return loadProject(S.detail.project.id);
    }).catch(function (e) {
      if (e.message === 'sem_chave_ia') aiHelp();
      else toast(e.message === 'chave_ia_invalida' ? 'A chave da API da Anthropic é inválida' : e.message === 'sem_credito_ia' ? 'A conta da Anthropic está sem crédito' : 'A IA não respondeu. Tente de novo.');
    }).then(function () { var b2 = $('.tai'); if (b2) { b2.disabled = false; b2.innerHTML = ICON.spark + 'Priorizar com IA'; } });
  }
  function aiHelp() {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="lbox" style="width:440px"><h1>Ligar a IA</h1><p>Para priorizar com IA, cadastre uma chave da API da Anthropic no Supabase (uma vez só, vale para todos os sites):</p>' +
      '<ol style="margin:0 0 var(--s4);padding-left:var(--s5);color:var(--c-sec);font:var(--f-bsm)"><li>Crie a chave em <b>console.anthropic.com</b> → API Keys.</li><li>No <b>supabase.com/dashboard</b>, abra o projeto → <b>Edge Functions</b> → <b>Secrets</b>.</li><li>Adicione <b>ANTHROPIC_API_KEY</b> com a chave como valor.</li></ol>' +
      '<button class="btn primary full cn">Entendi</button></div>';
    root.appendChild(m); $('.cn', m).onclick = function () { m.remove(); };
  }
  function setStatus(c, status) {
    var prev = c.status; c.status = status; refreshCounts();
    api('/api/comments/' + c.id, { method: 'PATCH', body: JSON.stringify({ status: status }) }).then(function () {
      var cr = curRound(), was = (S.detail.rounds || []).find(function (r) { return r.id === c.round_id; });
      if (status === 'open' && cr && (!was || was.status === 'closed')) { c.round_id = cr.id; refreshCounts(); } // reaberto volta para a rodada atual
      toast(status === 'resolved' ? 'Comentário resolvido' : 'Comentário reaberto');
    }).catch(function () { c.status = prev; refreshCounts(); toast('Não foi possível salvar'); });
  }
  // move o card entre as 4 colunas
  function moveTo(c, col) {
    if (col === 'resolved' || (col === 'open' && isDone(c))) { if (col === 'open') { c.agent_status = null; } return setStatus(c, col); }
    var agent = col === 'agent' ? 'queued' : col === 'review' ? 'review' : null;
    var prev = { status: c.status, agent_status: c.agent_status, agent_note: c.agent_note };
    c.status = 'open'; c.agent_status = agent; if (agent !== 'review') c.agent_note = null; refreshCounts();
    api('/api/comments/' + c.id, { method: 'PATCH', body: JSON.stringify({ agent: agent }) }).then(function () {
      toast(agent === 'queued' ? 'Na fila do agente' : agent === 'review' ? 'Movido para conferir' : 'Voltou para Aberto');
    }).catch(function () { c.status = prev.status; c.agent_status = prev.agent_status; c.agent_note = prev.agent_note; refreshCounts(); toast('Não foi possível salvar'); });
  }
  function agentCmd() { return '/resolver-feedback ' + S.detail.project.name; }
  function sendToAgent(ids) {
    api('/api/projects/' + encodeURIComponent(S.detail.project.id) + '/agent', { method: 'POST', body: JSON.stringify({ ids: ids }) }).then(function (r) {
      ids.forEach(function (id) { var c = S.detail.comments.find(function (x) { return x.id === id; }); if (c && !isDone(c)) { c.agent_status = 'queued'; c.agent_note = null; } });
      refreshCounts(); agentHelp(r.queued);
    }).catch(function () { toast('Não foi possível mandar para o agente'); });
  }
  function agentHelp(n) {
    var m = document.createElement('div'), cmd = agentCmd(); m.className = 'modal';
    m.innerHTML = '<div class="lbox" style="width:480px"><h1>' + (n ? n + (n === 1 ? ' comentário' : ' comentários') + ' na fila do agente' : 'Como rodar o agente') + '</h1>' +
      '<p>Para o agente resolver, chame no Claude (aqui no projeto Feedback ou no Claude Code):</p>' +
      '<div class="cmd"><code></code><button class="btn ghost cp">' + ICON.copy + 'Copiar</button></div>' +
      '<p style="font:var(--f-bsm);color:var(--c-sec)">O agente encontra o site, aplica os ajustes (no Webflow, sem publicar) e move cada card para <b>Para conferir</b> com uma nota do que fez. Você confere, publica e marca como resolvido. O que ele não conseguir fazer volta com uma pergunta.</p>' +
      '<button class="btn primary full cn">Entendi</button></div>';
    $('code', m).textContent = cmd;
    root.appendChild(m);
    $('.cp', m).onclick = function () { copy(cmd, 'Comando copiado'); };
    $('.cn', m).onclick = function () { m.remove(); };
  }
  function refreshCounts() {
    var p = S.projects.find(function (x) { return x.id === S.detail.project.id; });
    var open = S.detail.comments.filter(function (c) { return !isDone(c); }).length;
    if (p) { p.open = open; p.resolved = S.detail.comments.length - open; }
    renderNav();
    var t = $('.tab[data-t=board] .c'); if (t) t.textContent = open;
    if (S.tab === 'board' && $('.board')) fillBoard();
    if (S.open) { var c = S.detail.comments.find(function (x) { return x.id === S.open; }); if (c) openDrawer(c); }
  }

  // ---------------- detalhe ----------------
  function siteUrl(path) {
    var m = (S.detail.project.reviewUrl || '').match(/^(https?:\/\/[^/]+)\/\?review=(.*)$/);
    return m ? m[1] + (path || '/') + '?review=' + m[2] : null;
  }
  function openDrawer(c) {
    S.open = c.id;
    var dr = $('.drawer'), gen = isGeneral(c), dev = c.device || 'desktop', link = siteUrl(c.path);
    dr.innerHTML =
      '<div class="dh"><div class="num' + (gen ? ' g' : '') + '" style="background:' + (isDone(c) ? 'var(--st-done)' : 'var(--st-open)') + '">' + esc(S.nums[c.id]) + '</div><b></b><button class="ib x" title="Fechar">' + ICON.x + '</button></div>' +
      '<div class="db"><div class="dmeta"><span><b></b></span><span>' + esc(fmtDate(c.createdAt)) + '</span>' +
      '<span>' + (gen ? ICON.page + 'Geral (todos os dispositivos)' : ICON[dev] + DEV[dev] + (c.viewport && c.viewport.w ? ' · ' + c.viewport.w + 'px' : '')) + '</span>' +
      (c.editedAt ? '<span>editado</span>' : '') + '</div>' +
      '<div class="dtext"></div>' +
      (c.ai_priority && !isDone(c) ? '<div class="dai">' + ICON.spark + ' Prioridade sugerida pela IA: <b>' + PRI[c.ai_priority] + '</b>' + (c.ai_reason ? ' — ' + esc(c.ai_reason) : '') + '</div>' : '') +
      (function () {
        var g = groupsOf(S.detail.comments.filter(function (x) { return isDone(x) === isDone(c); })).filter(function (gr) { return gr.some(function (x) { return x.id === c.id; }); })[0] || [];
        var others = g.filter(function (x) { return x.id !== c.id; });
        return others.length ? '<div class="dai" style="background:var(--bg-sec);border-color:var(--bd-pri)">' + ICON.stack + ' Parecidos: ' + others.map(function (x) { return '<b>#' + esc(S.nums[x.id]) + '</b> ' + esc(String(x.text).slice(0, 60)); }).join(' · ') + '</div>' : '';
      })() +
      (c.agent_status && !isDone(c) ? '<div class="agn' + (c.agent_status === 'blocked' ? ' q' : '') + '" style="margin:0 0 var(--s3)">' + ICON.bot + '<span>' +
        (c.agent_status === 'queued' ? 'Na fila do agente.' : c.agent_status === 'blocked' ? '<b>O agente precisa de você:</b> ' + esc(c.agent_note || '') : '<b>Ajustado pelo agente:</b> ' + esc(c.agent_note || '')) + '</span></div>' : '') +
      (c.screenshot ? '<a class="dshot" target="_blank" rel="noopener" href="' + esc(c.screenshot) + '"><img alt="Print do comentário" src="' + esc(c.screenshot) + '"></a>' : '') +
      '<div class="rl">' + (c.replies.length ? c.replies.length + (c.replies.length === 1 ? ' resposta' : ' respostas') : 'Sem respostas') + '</div>' +
      c.replies.map(function (r) { return '<div class="rp"><div class="rh"><b>' + esc(r.author) + '</b> · ' + esc(ago(r.createdAt)) + '</div><div class="rt">' + esc(r.text) + '</div></div>'; }).join('') +
      '</div><div class="df">' +
      '<button class="btn ' + (isDone(c) ? 'ghost' : 'ok') + ' tg">' + (isDone(c) ? 'Reabrir' : ICON.check + (colOf(c) === 'review' ? 'Conferido' : 'Resolver')) + '</button>' +
      (isDone(c) ? '' : c.agent_status === 'queued' ? '<button class="btn ghost ag1">Tirar da fila</button>' : '<button class="btn agt ag1">' + ICON.bot + (c.agent_status ? 'Mandar de novo' : 'Resolver com Agente') + '</button>') +
      (link ? '<a class="btn ghost op" target="_blank" rel="noopener" href="' + esc(link) + '">' + ICON.ext + 'Abrir no site</a>' : '') +
      '<button class="btn ghost sl1" title="Enviar este comentário ao Slack">' + ICON.slack + 'Slack</button>' +
      '<span class="sp"></span><button class="btn danger del">Apagar</button></div>';
    $('.dh b', dr).textContent = pageLabel(c.path);
    $('.dmeta b', dr).textContent = c.author;
    $('.dtext', dr).textContent = c.text;
    $('.x', dr).onclick = closeDrawer;
    $('.tg', dr).onclick = function () { setStatus(c, isDone(c) ? 'open' : 'resolved'); };
    $('.sl1', dr).onclick = function () { toSlack([c.id]); };
    var ag1 = $('.ag1', dr); if (ag1) ag1.onclick = function () { if (c.agent_status === 'queued') moveTo(c, 'open'); else sendToAgent([c.id]); };
    $('.del', dr).onclick = function () {
      var f = $('.df', dr);
      if ($('.conf', f)) return;
      var box = document.createElement('div'); box.className = 'conf';
      box.innerHTML = '<span style="flex:1">Apagar este comentário' + (c.replies.length ? ' e as respostas' : '') + '? Não dá para desfazer.</span><button class="btn sm no">Cancelar</button><button class="btn sm crit yes">Apagar</button>';
      f.appendChild(box);
      $('.no', box).onclick = function () { box.remove(); };
      $('.yes', box).onclick = function () {
        api('/api/comments/' + c.id, { method: 'DELETE' }).then(function () {
          S.detail.comments = S.detail.comments.filter(function (x) { return x.id !== c.id; });
          S.nums = numbers(S.detail.comments);
          closeDrawer(); refreshCounts(); toast('Comentário apagado');
        });
      };
    };
    dr.classList.add('show'); $('.scrim').classList.add('show');
  }
  function closeDrawer() {
    S.open = null;
    var dr = $('.drawer'); if (dr) dr.classList.remove('show');
    var sc = $('.scrim'); if (sc) sc.classList.remove('show');
  }

  // ---------------- páginas ----------------
  function renderPages() {
    var body = $('.body'), cs = S.detail.comments, aps = S.detail.approvals || [];
    var pages = pagesOf(cs);
    if (!pages.length) { body.innerHTML = '<div class="emp">Nenhuma página com comentários ou aprovação ainda.</div>'; return; }
    body.innerHTML = '<p class="sub">Situação de cada página: comentários e quem aprovou.</p><table class="tbl"><thead><tr><th>Página</th><th>Abertos</th><th>Resolvidos</th><th>Aprovação</th><th></th></tr></thead><tbody></tbody></table>';
    var tb = $('tbody', body);
    pages.forEach(function (p) {
      var mine = cs.filter(function (c) { return c.path === p; }), open = mine.filter(function (c) { return !isDone(c); }).length;
      var ap = aps.filter(function (a) { return a.path === p; });
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><b></b></td><td>' + open + '</td><td>' + (mine.length - open) + '</td><td class="ap"></td><td style="text-align:right"><button class="btn ghost vb">Ver no board</button></td>';
      $('b', tr).textContent = pageLabel(p);
      $('.ap', tr).innerHTML = ap.length ? ap.map(function (a) { return '<div class="ok okline">' + ICON.check + esc(a.author) + ' <span style="color:var(--c-ter)">· ' + esc(fmtDate(a.createdAt)) + '</span></div>'; }).join('') : '<span style="color:var(--c-ter)">Não aprovada</span>';
      $('.vb', tr).onclick = function () { S.f.page = p; S.tab = 'board'; renderProject(); };
      tb.appendChild(tr);
    });
  }

  // ---------------- links ----------------
  // ---------------- links e convites ----------------
  // Convite por email: o servidor manda link + código de acesso de 6 dígitos (pedido na 1ª vez em cada navegador)
  var INV_ERR = {
    sem_chave_email: 'O envio de email ainda não está configurado (falta a chave RESEND_API_KEY no Supabase).',
    chave_email_invalida: 'A chave do Resend é inválida. Confira RESEND_API_KEY no Supabase.',
    dominio_nao_confirmado: 'O Resend ainda está em modo teste: só entrega para o email da sua conta até você confirmar um domínio.',
    email_recusado: 'O Resend recusou esse endereço de email.',
    sem_conexao: 'O serviço de email não respondeu.',
    sem_dominio: 'Este site ainda não tem domínio para montar o link.',
  };
  function invErr(e) { return INV_ERR[e] || 'Não foi possível enviar o email (' + e + ').'; }
  function inviteText(r, inv) {
    return 'Olá, ' + r.name.split(/\s+/)[0] + '! Segue o link para revisar o site ' + S.detail.project.name + ':\n' + inv.url +
      '\n\nNa primeira vez, digite o código de acesso: ' + inv.code + '\n\nO convite é pessoal: seus comentários saem com o seu nome.';
  }
  // Resultado do envio: deu certo, ou falhou e mostra o código para mandar por outro meio
  function inviteResult(r, inv) {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<div class="lbox" style="width:460px"><h1></h1><p class="ip"></p>' +
      '<div class="ivc"><span>Código de acesso</span><b></b></div>' +
      '<div class="url" style="margin-bottom:var(--s4)"><code></code></div>' +
      '<button class="btn primary full cpi">' + ICON.copy + 'Copiar convite (link + código)</button>' +
      '<button class="btn ghost full cn" style="margin-top:var(--s2)">Fechar</button></div>';
    $('h1', m).textContent = inv.sent ? 'Convite enviado' : 'O email não foi enviado';
    $('.ip', m).innerHTML = inv.sent ? 'Mandamos o link e o código para <b></b>. O código é pedido só na primeira vez em cada navegador.'
      : esc(invErr(inv.error)) + ' Você pode copiar o convite e mandar por WhatsApp ou pelo seu email.';
    if (inv.sent) $('.ip b', m).textContent = r.email;
    $('.ivc b', m).textContent = inv.code ? inv.code.slice(0, 3) + ' ' + inv.code.slice(3) : '—';
    $('code', m).textContent = inv.url || '';
    root.appendChild(m);
    $('.cpi', m).onclick = function () { copy(inviteText(r, inv), 'Convite copiado'); };
    $('.cn', m).onclick = function () { m.remove(); };
  }
  function inviteStatus(r) {
    if (!r.invited) return '';
    if (!r.active) return '';
    if (r.verifiedAt) return '<span class="chip g" title="Entrou com o código em ' + esc(fmtDate(r.verifiedAt)) + '">Entrou</span>';
    if (r.inviteError && !r.inviteSentAt) return '<span class="chip" title="' + esc(invErr(r.inviteError)) + '">Email não enviado</span>';
    return '<span class="chip gray" title="' + (r.inviteSentAt ? 'Enviado em ' + esc(fmtDate(r.inviteSentAt)) : '') + '">Convite enviado</span>';
  }
  function renderLinks() {
    var body = $('.body'), d = S.detail;
    body.innerHTML =
      (d.project.paused ? '<div class="banner" style="margin:0 0 var(--s4)"><b>A revisão deste site está pausada.</b> Quem abrir um link vê o aviso "Revisão pausada" até você ativar a revisão no topo.</div>' : '') +
      '<p class="sub">Convide por email: a pessoa recebe o link e um <b>código de acesso</b>, pedido só na primeira vez em cada navegador. Sem email, o link abre direto. Nos dois casos os comentários saem com o nome da pessoa.</p>' +
      '<form class="form"><input class="inp nm" placeholder="Nome (ex.: Beatriz)" required maxlength="80"><input class="inp em" type="email" placeholder="Email (para mandar o convite)" maxlength="200"><input class="inp org" placeholder="Empresa (opcional)" maxlength="80"><button class="btn primary sb" type="submit">Criar link</button></form>' +
      '<div class="lerr fe" style="margin:calc(var(--s2) * -1) 0 var(--s3)"></div>' +
      '<table class="tbl"><thead><tr><th>Pessoa</th><th>Link</th><th>Criado</th><th></th></tr></thead><tbody></tbody></table>';
    var tb = $('tbody', body);
    if (d.project.reviewUrl) {
      var g = document.createElement('tr');
      g.innerHTML = '<td><b>Link genérico</b><div style="color:var(--c-ter);font:var(--f-cap)">pede o nome de quem abre</div></td><td class="u"><div class="url"><code></code><button class="ib cp" title="Copiar">' + ICON.copy + '</button></div></td><td>—</td><td></td>';
      $('code', g).textContent = d.project.reviewUrl;
      $('.cp', g).onclick = function () { copyLink(d.project.reviewUrl); };
      tb.appendChild(g);
    }
    d.reviewers.forEach(function (r) {
      var tr = document.createElement('tr'); if (!r.active) tr.className = 'off';
      tr.innerHTML = '<td><b></b> ' + inviteStatus(r) + '<div class="og" style="color:var(--c-ter);font:var(--f-cap)"></div></td><td class="u"><div class="url"><code></code><button class="ib cp" title="Copiar link">' + ICON.copy + '</button></div></td>' +
        '<td>' + esc(ago(r.createdAt)) + '</td><td style="text-align:right;white-space:nowrap">' +
        (r.email ? '<button class="btn ghost sm rs" title="Gera um código novo e manda o convite de novo (o código anterior deixa de valer)">' + (r.invited ? 'Reenviar' : 'Enviar convite') + '</button> ' : '') +
        '<button class="btn ghost sm tg">' + (r.active ? 'Desativar' : 'Reativar') + '</button></td>';
      $('b', tr).textContent = r.name;
      $('.og', tr).textContent = [r.email, r.org].filter(Boolean).join(' · ') + (r.active ? '' : (r.email || r.org ? ' · ' : '') + 'desativado');
      $('code', tr).textContent = r.url || r.token;
      $('.cp', tr).onclick = function () { copyLink(r.url || r.token, r.invited ? 'Link copiado (o código vai no email do convite)' : null); };
      var rs = $('.rs', tr); if (rs) rs.onclick = function () {
        rs.disabled = true; rs.textContent = 'Enviando…';
        api('/api/reviewers/' + encodeURIComponent(r.token) + '/invite', { method: 'POST', body: '{}' }).then(function (x) {
          var i = d.reviewers.indexOf(r); if (i >= 0) d.reviewers[i] = x;
          renderProject(); inviteResult(x, x.invite);
        }).catch(function () { rs.disabled = false; rs.textContent = 'Reenviar'; toast('Não foi possível reenviar o convite'); });
      };
      $('.tg', tr).onclick = function () {
        api('/api/reviewers/' + encodeURIComponent(r.token), { method: 'PATCH', body: JSON.stringify({ active: !r.active }) }).then(function () {
          r.active = !r.active; renderProject(); toast(r.active ? 'Link reativado' : 'Link desativado: não abre mais a revisão');
        });
      };
      tb.appendChild(tr);
    });
    var em = $('.em', body), sbt = $('.sb', body), fe = $('.fe', body);
    em.oninput = function () { sbt.textContent = em.value.trim() ? 'Enviar convite' : 'Criar link'; fe.textContent = ''; };
    $('.form', body).onsubmit = function (e) {
      e.preventDefault();
      var nm = $('.nm', body).value.trim(), mail = em.value.trim(); if (!nm) return;
      if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(mail)) { fe.textContent = 'Confira o email.'; em.focus(); return; }
      sbt.disabled = true; sbt.textContent = mail ? 'Enviando…' : 'Criando…';
      api('/api/projects/' + encodeURIComponent(d.project.id) + '/reviewers', { method: 'POST', body: JSON.stringify({ name: nm, org: $('.org', body).value.trim(), email: mail }) }).then(function (r) {
        d.reviewers.push(r); renderProject();
        if (r.invite) inviteResult(r, r.invite);
        else { copyLink(r.url || r.token); toast('Link de ' + r.name + ' criado e copiado'); }
      }).catch(function (x) {
        sbt.disabled = false; sbt.textContent = mail ? 'Enviar convite' : 'Criar link';
        fe.textContent = x.message === 'email_invalido' ? 'Confira o email.' : 'Não foi possível criar o link.';
      });
    };
  }
  // Copiar link avisando quando a revisão está pausada (o link não abre até ativar)
  function copyLink(url, msg) {
    copy(url, S.detail && S.detail.project.paused ? 'Link copiado, mas a revisão está pausada: ative para ele abrir' : msg);
  }

  // ---------------- senha ----------------
  function changePassword() {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<form class="lbox"><h1>Trocar senha</h1><p>A nova senha vale para todos que entram no painel de ' + esc(S.studio.name) + '.</p>' +
      '<label>Senha atual</label><input class="inp cur" type="password" autocomplete="current-password">' +
      '<label>Nova senha (mínimo 8 caracteres)</label><input class="inp nw" type="password" autocomplete="new-password">' +
      '<div class="lerr"></div><button class="btn primary full" type="submit">Salvar</button><button class="btn ghost full cn" type="button" style="margin-top:var(--s2)">Cancelar</button></form>';
    root.appendChild(m);
    $('.cur', m).focus();
    $('.cn', m).onclick = function () { m.remove(); };
    $('form', m).onsubmit = function (e) {
      e.preventDefault();
      var nw = $('.nw', m).value;
      if (nw.length < 8) { $('.lerr', m).textContent = 'A nova senha precisa ter pelo menos 8 caracteres.'; return; }
      api('/api/password', { method: 'POST', body: JSON.stringify({ current: $('.cur', m).value, next: nw }) }).then(function () {
        m.remove(); toast('Senha alterada');
      }).catch(function () { $('.lerr', m).textContent = 'Senha atual incorreta.'; });
    };
  }

  // ---------------- sugestões de melhoria da ferramenta ----------------
  // Função própria no Supabase (\"sugestoes\"), com a mesma sessão do painel.
  var SBASE = /\/painel$/.test(BASE || '') ? BASE.replace(/\/painel$/, '/sugestoes') : (BASE || '') + '/../sugestoes';
  function sapi(method, body) {
    return fetch(SBASE + '/api/suggestions', { method: method, headers: { 'Content-Type': 'application/json', 'X-Panel-Session': S.session || '' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          if (r.status === 401) { logout(true); throw new Error('no_session'); }
          if (!r.ok) throw new Error(b.error || 'erro');
          return b;
        });
      });
  }
  var KIND = { melhoria: 'Melhoria', problema: 'Problema', ideia: 'Ideia nova' };
  var SST = { recebida: 'Recebida', planejada: 'Planejada', em_andamento: 'Em andamento', feita: 'Feita', nao_vamos_fazer: 'Não vamos fazer' };
  var PH = { melhoria: 'Ex.: queria filtrar o board por quem comentou.', problema: 'Ex.: ao fechar a rodada no celular o botão fica escondido. O que você fez e o que aconteceu?', ideia: 'Ex.: mandar um resumo semanal por email para o cliente.' };
  // ================= área do administrador (?painel=sugestoes) =================
  var AKEY = 'fb_admin_session';
  var A = { session: ls(AKEY), list: [], studios: [], f: { status: ls('fb_admin_f') || 'recebida', studio: '', kind: '', pri: '', q: '' }, sort: 'new', open: null };
  var ASTATUS = ['recebida', 'planejada', 'em_andamento', 'feita', 'nao_vamos_fazer'];
  var AGROUP = { recebida: 'Novas', planejada: 'Planejadas', em_andamento: 'Em andamento', feita: 'Feitas', nao_vamos_fazer: 'Não vamos fazer', all: 'Todas' };
  var PRIO = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
  function aapi(path, method, body) {
    return fetch(SBASE + '/api/admin' + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json', 'X-Admin-Session': A.session || '' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          if (r.status === 401 && path !== '/login') { A.session = null; ls(AKEY, null); adminLogin('Sua sessão expirou. Entre de novo.'); throw new Error('no_session'); }
          if (!r.ok) { var e = new Error(b.error || 'erro'); e.status = r.status; throw e; }
          return b;
        });
      });
  }
  function adminLogin(err) {
    document.title = 'Sugestões · administrador';
    view.innerHTML = '<div class="login"><form class="lbox"><h1>Sugestões dos estúdios</h1><p>Área do administrador. Os estúdios não têm acesso a esta tela.</p>' +
      '<label>Senha do administrador</label><input class="inp pw" type="password" autocomplete="current-password">' +
      '<div class="lerr"></div><button class="btn primary full" type="submit">Entrar</button>' +
      '<button class="btn ghost full cl" type="button" style="margin-top:8px">Voltar ao site</button></form></div>';
    $('.lerr').textContent = err || ''; $('.pw').focus();
    $('.cl').onclick = closePanel;
    $('.lbox').onsubmit = function (e) {
      e.preventDefault();
      var b = $('.lbox button[type=submit]'); b.disabled = true; b.textContent = 'Entrando…';
      aapi('/login', 'POST', { password: $('.pw').value }).then(function (r) {
        A.session = r.session; ls(AKEY, r.session); adminBoot();
      }).catch(function (x) { adminLogin(x.message === 'bloqueado' ? 'Muitas tentativas erradas. Espere 15 minutos.' : 'Senha incorreta.'); });
    };
  }
  function adminBoot() {
    if (!A.session) return adminLogin();
    return aapi('/suggestions').then(function (r) {
      A.list = r.suggestions || []; A.studios = r.studios || [];
      if (!$('.app.adm')) adminShell();
      adminNav(); adminList();
    }).catch(function (e) { if (e.message !== 'no_session') adminLogin('Não foi possível carregar as sugestões.'); });
  }
  function adminShell() {
    document.title = 'Sugestões dos estúdios';
    view.innerHTML = '<div class="app adm"><aside class="side"><div class="brand"><b>Sugestões</b><span>Área do administrador</span></div><nav class="nav"></nav>' +
      '<div class="sfoot"><div class="ni rl2">' + ICON.refresh + '<span class="t">Atualizar</span></div><div class="ni pwd">' + ICON.key + '<span class="t">Trocar senha</span></div>' +
      '<div class="ni lo">' + ICON.out + '<span class="t">Sair</span></div><div class="ni cl">' + ICON.x + '<span class="t">Fechar</span></div></div></aside>' +
      '<div class="mbar"><select class="msel"></select><button class="btn ghost mlo">Sair</button></div><main class="main"></main></div>' +
      '<div class="scrim"></div><aside class="drawer"></aside>';
    $('.rl2').onclick = function () { adminBoot().then(function () { toast('Atualizado'); }); };
    $('.pwd').onclick = adminPassword;
    $('.lo').onclick = $('.mlo').onclick = function () { aapi('/logout', 'POST').catch(function () {}); A.session = null; ls(AKEY, null); adminLogin(); };
    $('.cl').onclick = closePanel;
    $('.scrim').onclick = adminClose;
    $('.msel').onchange = function () { var v = this.value; if (v.indexOf('st:') === 0) { A.f.studio = v.slice(3); } else { A.f.status = v; ls('fb_admin_f', v); } adminNav(); adminList(); };
  }
  function countBy(fn) { return A.list.filter(fn).length; }
  function adminNav() {
    var nav = $('.nav'); if (!nav) return;
    var h = '<div class="nl">Status</div>';
    ASTATUS.concat(['all']).forEach(function (k) {
      var n = k === 'all' ? A.list.length : countBy(function (x) { return x.status === k; });
      h += '<div class="ni grp' + (A.f.status === k ? ' on' : '') + '" data-s="' + k + '">' + (k === 'recebida' ? ICON.inbox : k === 'feita' ? ICON.check : k === 'all' ? ICON.stack : ICON.flag) +
        '<span class="t"><b>' + AGROUP[k] + '</b></span><span class="' + (k === 'recebida' && n ? 'bd' : 'gc') + '">' + n + '</span></div>';
    });
    h += '<div class="nl">Estúdios</div><div class="ni grp' + (!A.f.studio ? ' on' : '') + '" data-st="">' + ICON.grid + '<span class="t"><b>Todos</b></span><span class="gc">' + A.list.length + '</span></div>';
    A.studios.forEach(function (st) {
      var n = countBy(function (x) { return x.studio === st.id; });
      if (!n && A.f.studio !== st.id) return;
      h += '<div class="ni grp' + (A.f.studio === st.id ? ' on' : '') + '" data-st="' + esc(st.id) + '">' + ICON.globe + '<span class="t"><b>' + esc(st.name) + '</b></span><span class="gc">' + n + '</span></div>';
    });
    nav.innerHTML = h;
    $$('.ni[data-s]', nav).forEach(function (el) { el.onclick = function () { A.f.status = el.dataset.s; ls('fb_admin_f', A.f.status); adminNav(); adminList(); }; });
    $$('.ni[data-st]', nav).forEach(function (el) { el.onclick = function () { A.f.studio = el.dataset.st; adminNav(); adminList(); }; });
    var ms = $('.msel');
    if (ms) {
      ms.innerHTML = '<optgroup label="Status">' + ASTATUS.concat(['all']).map(function (k) { return '<option value="' + k + '">' + AGROUP[k] + ' (' + (k === 'all' ? A.list.length : countBy(function (x) { return x.status === k; })) + ')</option>'; }).join('') + '</optgroup>';
      ms.value = A.f.status;
    }
  }
  function adminFiltered() {
    var f = A.f, q = f.q.toLowerCase();
    var PR = { alta: 0, media: 1, baixa: 2 };
    return A.list.filter(function (x) {
      if (f.status !== 'all' && x.status !== f.status) return false;
      if (f.studio && x.studio !== f.studio) return false;
      if (f.kind && x.kind !== f.kind) return false;
      if (f.pri && (f.pri === 'none' ? x.priority : x.priority !== f.pri)) return false;
      if (q && (x.text + ' ' + (x.author || '') + ' ' + x.studioName + ' ' + (x.reply || '') + ' ' + (x.internalNote || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      if (A.sort === 'pri') { var pa = a.priority ? PR[a.priority] : 9, pb = b.priority ? PR[b.priority] : 9; if (pa !== pb) return pa - pb; }
      if (A.sort === 'old') return a.createdAt < b.createdAt ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }
  function adminList() {
    var main = $('.main'); if (!main) return;
    var st = A.studios.filter(function (x) { return x.id === A.f.studio; })[0];
    main.innerHTML = '<header class="head" style="padding-bottom:14px"><div class="hrow"><h2>' + esc(AGROUP[A.f.status]) + (st ? ' · ' + esc(st.name) : '') + '</h2>' +
      '<span class="chip gray lcount"></span></div></header><div class="body">' +
      '<div class="fbar"><select class="fk"><option value="">Todos os tipos</option><option value="melhoria">Melhoria</option><option value="problema">Problema</option><option value="ideia">Ideia nova</option></select>' +
      '<select class="fpr"><option value="">Qualquer prioridade</option><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option><option value="none">Sem prioridade</option></select>' +
      '<select class="fso"><option value="new">Mais recentes</option><option value="old">Mais antigas</option><option value="pri">Por prioridade</option></select>' +
      '<input class="fq" type="search" placeholder="Buscar texto, estúdio ou autor…"></div><div class="alist"></div></div>';
    $('.fk').value = A.f.kind; $('.fpr').value = A.f.pri; $('.fso').value = A.sort; $('.fq').value = A.f.q;
    $('.fk').onchange = function () { A.f.kind = this.value; fillAdmin(); };
    $('.fpr').onchange = function () { A.f.pri = this.value; fillAdmin(); };
    $('.fso').onchange = function () { A.sort = this.value; fillAdmin(); };
    $('.fq').oninput = function () { A.f.q = this.value.trim(); fillAdmin(); };
    fillAdmin();
  }
  function fillAdmin() {
    var list = adminFiltered(), box = $('.alist'); if (!box) return;
    $('.lcount').textContent = list.length + (list.length === 1 ? ' sugestão' : ' sugestões');
    if (!list.length) {
      box.innerHTML = '<div class="emp">' + (A.list.length ? 'Nada aqui com esses filtros.' : 'Nenhuma sugestão ainda.<br>Quando um estúdio usar "Sugerir melhoria" no painel, ela aparece aqui.') + '</div>';
      return;
    }
    box.innerHTML = list.map(function (x) {
      return '<div class="sgc' + (A.open === x.id ? ' on' : '') + '" data-id="' + x.id + '"><div class="sgh"><span class="kchip ' + esc(x.kind) + '">' + esc(KIND[x.kind] || x.kind) + '</span>' +
        '<span class="sst ' + esc(x.status) + '">' + esc(SST[x.status]) + '</span>' + (x.priority ? '<span class="pri ' + esc(x.priority) + '">' + PRIO[x.priority] + '</span>' : '') +
        '<span><b style="color:#555">' + esc(x.studioName) + '</b>' + (x.author ? ' · ' + esc(x.author) : '') + ' · ' + esc(ago(x.createdAt)) + '</span></div>' +
        '<div class="sgt">' + esc(x.text) + '</div>' +
        ((x.reply || x.internalNote) ? '<div class="sgf">' + (x.reply ? '<span>' + ICON.chat + 'Respondida</span>' : '') + (x.internalNote ? '<span>' + ICON.edit + 'Nota interna</span>' : '') + '</div>' : '') + '</div>';
    }).join('');
    $$('.sgc', box).forEach(function (el) { el.onclick = function () { adminOpen(el.dataset.id); }; });
  }
  function backlogLine(x) {
    var d = new Date(x.createdAt).toLocaleDateString('pt-BR');
    return '- [ ] **' + (KIND[x.kind] || x.kind) + '** — ' + String(x.text).replace(/\s+/g, ' ').trim() + ' *(' + x.studioName + (x.author ? ', ' + x.author : '') + ', ' + d + ')*';
  }
  function adminOpen(id) {
    var x = A.list.filter(function (s) { return s.id === id; })[0]; if (!x) return;
    A.open = id; fillAdmin();
    var dr = $('.drawer'), c = x.context || {};
    var st = x.status, pr = x.priority || null;
    dr.innerHTML = '<div class="dh"><span class="kchip ' + esc(x.kind) + '">' + esc(KIND[x.kind]) + '</span><b></b><button class="ib x" title="Fechar">' + ICON.x + '</button></div>' +
      '<div class="db"><div class="dmeta"><span><b>' + esc(x.studioName) + '</b></span>' + (x.author ? '<span>' + esc(x.author) + '</span>' : '') + '<span>' + esc(fmtDate(x.createdAt)) + '</span></div>' +
      '<div class="dtext"></div>' +
      '<div class="fl">Status (o estúdio vê)</div><div class="seg sst2">' + ASTATUS.map(function (k) { return '<button type="button" class="kd' + (k === st ? ' on' : '') + '" data-v="' + k + '">' + SST[k] + '</button>'; }).join('') + '</div>' +
      '<div class="fl">Prioridade (só você vê)</div><div class="seg spr">' + ['alta', 'media', 'baixa', ''].map(function (k) { return '<button type="button" class="kd' + ((k || null) === pr ? ' on' : '') + '" data-v="' + k + '">' + (k ? PRIO[k] : 'Sem') + '</button>'; }).join('') + '</div>' +
      '<div class="fl">Resposta para o estúdio</div><textarea class="inp rep" maxlength="1000" placeholder="Ex.: Boa ideia! Entra na próxima versão."></textarea>' +
      '<div class="fl">Nota interna (só você vê)</div><textarea class="inp nt2" maxlength="4000" placeholder="Como resolver, esforço, links…"></textarea>' +
      '<div class="fl">Contexto</div><div class="ctx"><b>Estúdio</b><span></span><b>Site</b><span></span><b>Aba</b><span></span><b>Tela</b><span></span><b>Navegador</b><span></span><b>Atualizada</b><span></span></div>' +
      '</div><div class="df"><button class="btn primary sv">Salvar</button><button class="btn ghost bl" title="Copia uma linha pronta para o backlog.md">' + ICON.copy + 'Copiar para o backlog</button><span class="sp"></span><button class="btn danger del">Apagar</button></div>';
    $('.dh b', dr).textContent = 'Sugestão';
    $('.dtext', dr).textContent = x.text;
    $('.rep', dr).value = x.reply || ''; $('.nt2', dr).value = x.internalNote || '';
    var cs = $$('.ctx span', dr);
    [x.studioName + ' (' + x.studio + ')', c.project || '—', c.tab || '—', c.screen || '—', c.ua || '—', fmtDate(x.updatedAt)].forEach(function (v, i) { cs[i].textContent = v; });
    $$('.sst2 .kd', dr).forEach(function (b) { b.onclick = function () { st = b.dataset.v; $$('.sst2 .kd', dr).forEach(function (o) { o.classList.toggle('on', o === b); }); }; });
    $$('.spr .kd', dr).forEach(function (b) { b.onclick = function () { pr = b.dataset.v || null; $$('.spr .kd', dr).forEach(function (o) { o.classList.toggle('on', o === b); }); }; });
    $('.x', dr).onclick = adminClose;
    $('.bl', dr).onclick = function () { copy(backlogLine(x), 'Linha copiada para colar no backlog'); };
    $('.sv', dr).onclick = function () {
      var bt = this; bt.disabled = true; bt.textContent = 'Salvando…';
      aapi('/suggestions/' + x.id, 'PATCH', { status: st, priority: pr, reply: $('.rep', dr).value, internal_note: $('.nt2', dr).value }).then(function (r) {
        A.list = A.list.map(function (s) { return s.id === r.id ? r : s; });
        toast(r.status !== x.status ? 'Salvo · ' + SST[r.status] : 'Salvo'); adminNav(); adminOpen(r.id);
      }).catch(function (e) { bt.disabled = false; bt.textContent = 'Salvar'; if (e.message !== 'no_session') toast('Não foi possível salvar'); });
    };
    $('.del', dr).onclick = function () {
      var f = $('.df', dr); if ($('.conf', f)) return;
      var box = document.createElement('div'); box.className = 'conf';
      box.innerHTML = '<span style="flex:1">Apagar esta sugestão? O estúdio deixa de vê-la. Não dá para desfazer.</span><button class="btn no">Cancelar</button><button class="btn primary yes" style="background:#d93025">Apagar</button>';
      f.appendChild(box);
      $('.no', box).onclick = function () { box.remove(); };
      $('.yes', box).onclick = function () {
        aapi('/suggestions/' + x.id, 'DELETE').then(function () {
          A.list = A.list.filter(function (s) { return s.id !== x.id; }); adminClose(); adminNav(); toast('Sugestão apagada');
        });
      };
    };
    dr.classList.add('show'); $('.scrim').classList.add('show');
  }
  function adminClose() {
    A.open = null;
    var dr = $('.drawer'); if (dr) dr.classList.remove('show');
    var sc = $('.scrim'); if (sc) sc.classList.remove('show');
    fillAdmin();
  }
  function adminPassword() {
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<form class="lbox"><h1>Trocar senha</h1><p>Senha da área do administrador. Ao trocar, as outras sessões abertas saem.</p>' +
      '<label>Senha atual</label><input class="inp cur" type="password" autocomplete="current-password">' +
      '<label>Nova senha (mínimo 12 caracteres)</label><input class="inp nw" type="password" autocomplete="new-password">' +
      '<div class="lerr"></div><button class="btn primary full" type="submit">Salvar</button><button class="btn ghost full cn" type="button" style="margin-top:8px">Cancelar</button></form>';
    root.appendChild(m); $('.cur', m).focus();
    $('.cn', m).onclick = function () { m.remove(); };
    $('form', m).onsubmit = function (e) {
      e.preventDefault();
      var nw = $('.nw', m).value;
      if (nw.length < 12) { $('.lerr', m).textContent = 'A nova senha precisa ter pelo menos 12 caracteres.'; return; }
      aapi('/password', 'POST', { current: $('.cur', m).value, next: nw }).then(function () { m.remove(); toast('Senha alterada'); })
        .catch(function () { $('.lerr', m).textContent = 'Senha atual incorreta.'; });
    };
  }

  function suggest() {
    var kind = 'melhoria';
    var m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = '<form class="lbox sgbox"><h1>Sugerir melhoria</h1><p>O que faria a ferramenta funcionar melhor para o seu estúdio? Lemos tudo e usamos para decidir as próximas versões.</p>' +
      '<label>Tipo</label><div class="kinds">' + Object.keys(KIND).map(function (k) { return '<button type="button" class="kd' + (k === kind ? ' on' : '') + '" data-k="' + k + '">' + KIND[k] + '</button>'; }).join('') + '</div>' +
      '<label>Sua sugestão</label><textarea class="inp tx2" maxlength="2000"></textarea><div class="cnt">0 / 2000</div>' +
      '<label>Seu nome <span style="font-weight:400;color:#aaa">(opcional)</span></label><input class="inp an" maxlength="80" placeholder="Para sabermos com quem falar">' +
      '<div class="sgnote">Junto vai o site e a aba que você está vendo agora, para entendermos o contexto.</div>' +
      '<div class="lerr"></div><button class="btn primary full" type="submit">Enviar sugestão</button><button class="btn ghost full cn" type="button" style="margin-top:8px">Fechar</button>' +
      '<div class="sgl"><h2>Suas sugestões</h2><div class="sgls"><div class="emp" style="padding:10px">Carregando…</div></div></div></form>';
    root.appendChild(m);
    var ta = $('.tx2', m), an = $('.an', m), err = $('.lerr', m);
    ta.placeholder = PH[kind]; an.value = ls('fb_panel_author') || ''; ta.focus();
    ta.oninput = function () { $('.cnt', m).textContent = ta.value.length + ' / 2000'; };
    $$('.kd', m).forEach(function (b) {
      b.onclick = function () { kind = b.dataset.k; $$('.kd', m).forEach(function (x) { x.classList.toggle('on', x === b); }); ta.placeholder = PH[kind]; ta.focus(); };
    });
    $('.cn', m).onclick = function () { m.remove(); };
    m.addEventListener('mousedown', function (e) { if (e.target === m) m.remove(); });
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape') m.remove(); });
    function list() {
      sapi('GET').then(function (r) {
        var el = $('.sgls', m); if (!el) return;
        var ss = r.suggestions || [];
        if (!ss.length) { el.innerHTML = '<div class="emp" style="padding:10px;text-align:left">Nenhuma sugestão enviada ainda.</div>'; return; }
        el.innerHTML = ss.map(function (x) {
          return '<div class="sgi"><div class="sgh"><span class="sst ' + esc(x.status) + '">' + esc(SST[x.status] || x.status) + '</span><span class="skd">' + esc(KIND[x.kind] || x.kind) + '</span><span>' + esc(ago(x.createdAt)) + (x.author ? ' · ' + esc(x.author) : '') + '</span></div>' +
            '<div class="sgt">' + esc(x.text) + '</div>' + (x.reply ? '<div class="sgr"><b>Resposta:</b> ' + esc(x.reply) + '</div>' : '') + '</div>';
        }).join('');
      }).catch(function (e) { var el = $('.sgls', m); if (el && e.message !== 'no_session') el.innerHTML = '<div class="emp" style="padding:10px">Não foi possível carregar suas sugestões.</div>'; });
    }
    list();
    $('form', m).onsubmit = function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (text.length < 3) { err.textContent = 'Escreva a sua sugestão.'; ta.focus(); return; }
      var bt = $('button[type=submit]', m); bt.disabled = true; bt.textContent = 'Enviando…'; err.textContent = '';
      var author = an.value.trim(); ls('fb_panel_author', author || null);
      var ctx = { project: S.sel, tab: (S.sel === 'all' || S.sel === 'archived') ? 'visao-geral' : S.tab, screen: innerWidth + 'x' + innerHeight };
      sapi('POST', { kind: kind, text: text, author: author, context: ctx }).then(function () {
        ta.value = ''; $('.cnt', m).textContent = '0 / 2000'; bt.disabled = false; bt.textContent = 'Enviar sugestão';
        toast('Sugestão enviada. Obrigado!'); list();
      }).catch(function (x) {
        bt.disabled = false; bt.textContent = 'Enviar sugestão';
        err.textContent = x.message === 'limite_diario' ? 'Limite de sugestões de hoje atingido. Tente amanhã.' : x.message === 'no_session' ? '' : 'Não foi possível enviar. Tente de novo.';
      });
    };
  }

  root.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (ADMIN) { if (A.open) adminClose(); } else closeDrawer(); } e.stopPropagation(); });

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

  // Painel: escuta todos os sites do estúdio; atualiza contagens e, se for o site aberto, o conteúdo
  var busy = function () {
    var ae = root.activeElement;
    return !!(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) || !!$('.modal') || !!$('.card.dragging');
  };
  var rtPending = {};
  var rtApply = function (topic) {
    var pid = topic.replace(/^fb-/, '');
    if (!S.session) return;
    if (busy()) { rtPending[topic] = true; return; }  // não atrapalha quem está digitando/arrastando
    var since = Date.now() - (S.lastWrite || 0);
    if (since < 2500) { setTimeout(function () { rtApply(topic); }, 2600 - since); return; } // a mudança acabou de ser feita aqui mesmo
    delete rtPending[topic];
    api('/api/overview').then(function (r) {
      S.projects = r.projects; renderNav();
      if (S.sel === 'all' || S.sel === 'archived') renderOverview(S.sel === 'archived');
    }).catch(function () {});
    if (S.detail && S.detail.project.id === pid) {
      var openId = S.open;
      api('/api/projects/' + encodeURIComponent(pid)).then(function (d) {
        if (!S.detail || S.detail.project.id !== pid || busy()) { rtPending[topic] = true; return; }
        S.detail = d; S.nums = numbers(d.comments); renderProject();
        var c = openId && d.comments.find(function (x) { return x.id === openId; });
        if (c) openDrawer(c);
      }).catch(function () {});
    }
  };
  var rt = realtime(BASE, rtApply);
  root.addEventListener('focusout', function () { setTimeout(function () { Object.keys(rtPending).forEach(rtApply); }, 300); });
  var rtWatch = function () { if (S.projects && S.projects.length) rt.set(S.projects.map(function (p) { return 'fb-' + p.id; })); };
  setInterval(rtWatch, 5000);

  window.FeedbackPanel = { state: function () { return S; }, reload: boot };
  if (ADMIN) adminBoot(); else if (S.session) boot(); else renderLogin();
})();
