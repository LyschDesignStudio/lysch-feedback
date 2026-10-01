/*!
 * loader.js — snippet instalado no site.
 * Uso:
 *   <script src=".../reviewer/loader.js" data-studio="opengrid" defer></script>   (projeto pelo domínio)
 *   <script src=".../reviewer/loader.js" data-project="prj_xxx" defer></script>   (projeto fixo)
 *
 * Roda em toda página. Pergunta ao servidor se o revisor deve ativar
 * (domínio permitido, token ?review=, sessão existente, projeto pausado).
 * Se não, para aqui: nada mais é carregado.
 * Com ?painel na URL, carrega o painel do estúdio (login por senha).
 */
(function () {
  if (window.__FB_LOADER__) return;
  window.__FB_LOADER__ = true;

  var script = document.currentScript || document.querySelector('script[src*="loader.js"][data-project],script[src*="loader.js"][data-studio]');
  if (!script) return;
  var project = script.getAttribute('data-project') || '';
  var studio = script.getAttribute('data-studio') || '';   // modo estúdio: projeto pelo domínio
  if (!project && !studio) return;
  var base = script.src.replace(/\/loader\.js.*$/, '');
  var KEY = 'fb_session_' + (project || studio);

  var params = new URLSearchParams(location.search);

  // ?painel → abre o painel do estúdio (protegido por senha) em vez do revisor
  if (params.has('painel')) {
    var pbase = /\/reviewer$/.test(base) ? base.replace(/\/reviewer$/, '/painel') : base + '/painel';
    window.__FB_PANEL__ = { base: pbase, studio: studio };
    var ps = document.createElement('script');
    ps.src = pbase + '/app.js?v=' + Math.floor(Date.now() / 60000);
    ps.async = true;
    document.head.appendChild(ps);
    return;
  }
  var token = params.get('review') || '';
  var session = '';
  try { session = sessionStorage.getItem(KEY) || ''; } catch (e) {}

  // Revisão estava aberta (ou veio por link de revisão)? Mostra na hora uma camada clara
  // "Abrindo revisão…" enquanto a ferramenta carrega. (Nunca dentro do quadro da própria revisão.)
  var inFrame = false; try { inFrame = window.top !== window.self; } catch (e) { inFrame = true; }
  var wantsOpen = false;
  try { wantsOpen = !!token || !!(JSON.parse(sessionStorage.getItem('fb_shell') || 'null') || {}).open; } catch (e) {}
  wantsOpen = wantsOpen && !inFrame;
  var boot = null;
  // Cores do design system Lysch (tokens: bg-secondary, border-secondary, brand/content-primary)
  function showBoot() {
    boot = document.createElement('div');
    boot.id = 'fb-boot';
    boot.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(248,247,245,.86);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;font:600 14px/20px \'DM Sans\',ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#2c2821');
    boot.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:14px"><span style="width:34px;height:34px;border-radius:50%;border:3px solid #e5dfd6;border-top-color:#2c2821;animation:fbspin .8s linear infinite;display:block"></span><span>Abrindo revisão…</span></div><style>@keyframes fbspin{to{transform:rotate(360deg)}}</style>';
    (document.body || document.documentElement).appendChild(boot);
    setTimeout(hideBoot, 15000); // nunca deixa a camada presa
  }
  function hideBoot() { if (boot && boot.parentNode) boot.parentNode.removeChild(boot); boot = null; }
  if (wantsOpen) { if (document.body) showBoot(); else document.addEventListener('DOMContentLoaded', showBoot, { once: true }); }

  var q = '?project=' + encodeURIComponent(project) +
          '&studio=' + encodeURIComponent(studio) +
          '&host=' + encodeURIComponent(location.hostname) +
          '&token=' + encodeURIComponent(token) +
          '&session=' + encodeURIComponent(session);
  // Convite por email: o navegador que já digitou o código guarda um passe (30 dias)
  if (token) { try { var pass = localStorage.getItem('fb_pass_' + token) || ''; if (pass) q += '&pass=' + encodeURIComponent(pass); } catch (e) {} }

  fetch(base + '/api/activate' + q)
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res.active) {
        try { sessionStorage.removeItem(KEY); } catch (e) {}
        // Veio por link de revisão e não abriu: mostra o motivo (pausada, link inválido) ou pede o código do convite
        if (token && !inFrame && /^(needs_code|paused|archived|invalid_link)$/.test(res.reason || '')) {
          window.__FB_GATE__ = { base: base, key: KEY, token: token, reason: res.reason, who: res.who || null, lockedUntil: res.lockedUntil || null };
          var g = document.createElement('script');
          g.src = base + '/gate.js' + (res.v ? '?v=' + encodeURIComponent(res.v) : '');
          g.async = true; g.onerror = hideBoot;
          document.head.appendChild(g);
          return; // a camada "Abrindo revisão…" sai quando a janela aparecer
        }
        hideBoot(); return;
      }
      try { sessionStorage.setItem(KEY, res.session); } catch (e) {}

      // Remove o token da barra de endereço (não fica visível / compartilhável por acidente)
      if (token) {
        params.delete('review');
        var clean = location.pathname + (params.toString() ? '?' + params : '') + location.hash;
        history.replaceState(history.state, '', clean);
      }

      window.__FB_CONFIG__ = { project: res.project || project, studio: studio, base: base, session: res.session, via: res.via, who: res.who || null,
        barTitle: script.getAttribute('data-title') || '', barText: script.getAttribute('data-text') || '' };
      // Carrega a interface só depois que a página terminou de carregar (não atrasa o site)
      var inject = function () {
        var s = document.createElement('script');
        s.src = base + '/overlay.js' + (res.v ? '?v=' + encodeURIComponent(res.v) : ''); // versão: evita cache antigo
        s.async = true;
        document.head.appendChild(s);
      };
      if (document.readyState === 'complete' || wantsOpen) inject(); // quem está esperando a revisão abrir não espera o site
      else window.addEventListener('load', inject, { once: true });
    })
    .catch(function () { hideBoot(); /* falha silenciosa: nunca quebrar o site do cliente */ });
})();
