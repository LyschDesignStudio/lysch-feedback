/*!
 * gate.js — janela mostrada quando um link de revisão não abre direto.
 * Carregada pelo loader só quando a pessoa veio por link (?review=…) e o servidor respondeu:
 *   needs_code   → convite por email: pede o código de acesso que veio no email
 *   paused       → a revisão do site está pausada pelo estúdio
 *   archived     → o projeto foi encerrado pelo estúdio
 *   invalid_link → link desativado, incompleto ou de outro site
 * Visual: design system Lysch (valores dos tokens --cc-* do tema claro), em Shadow DOM.
 */
(function () {
  if (window.__FB_GATE_LOADED__) return;
  var G = window.__FB_GATE__ || {};
  if (!G.base || !G.token) return;
  window.__FB_GATE_LOADED__ = true;

  function hideBoot() { var b = document.getElementById('fb-boot'); if (b && b.parentNode) b.parentNode.removeChild(b); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hhmm(iso) { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  if (!document.getElementById('fb-ds-font')) {
    var l = document.createElement('link'); l.id = 'fb-ds-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300..700&display=swap';
    (document.head || document.documentElement).appendChild(l);
  }

  var host = document.createElement('div');
  host.id = 'fb-gate-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  // Tokens do DS usados aqui (tema claro): bg-primary, bg-secondary, border-secondary, border-strong,
  // content-primary/secondary/tertiary/placeholder, brand-static-high, feedback-critical-low, border-focus, bg-backdrop
  var CSS = ':host{all:initial;--bg:#ffffff;--bg2:#f8f7f5;--bd:#e5dfd6;--bds:#2c2821;--c1:#2c2821;--c2:#706657;--c3:#a49785;--ph:#8a7e6c;' +
    '--brand:#2c2821;--brand-c:#ffffff;--crit:#9b473f;--crit-lo:#f5e6e5;--focus:#528ca0;--dis:#e5dfd6;--dis-c:#bbb09f;--bkd:#26120966;' +
    '--ff:"DM Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    '*{box-sizing:border-box;font-family:var(--ff)}' +
    '.bk{position:fixed;inset:0;background:var(--bkd);display:flex;align-items:center;justify-content:center;padding:16px;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}' +
    '.box{width:420px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:var(--bg);border:1px solid var(--bd);border-radius:24px;padding:40px;color:var(--c1);box-shadow:0 0 16px #00000029}' +
    '.ic{width:48px;height:48px;border-radius:999px;background:var(--bg2);display:flex;align-items:center;justify-content:center;margin-bottom:20px;color:var(--c1)}.ic svg{width:24px;height:24px;fill:currentColor}' +
    'h1{margin:0 0 12px;font:500 20px/24px var(--ff)}p{margin:0 0 24px;color:var(--c2);font:400 16px/24px var(--ff)}p b{color:var(--c1);font-weight:600}' +
    'label{display:block;font:400 14px/20px var(--ff);color:var(--c2);margin:0 0 8px}' +
    '.code{width:100%;height:56px;border:1px solid var(--bd);border-radius:16px;padding:0 16px;font:600 24px/1 var(--ff);letter-spacing:10px;text-align:center;outline:0;background:var(--bg);color:var(--c1)}' +
    '.code:focus{border-color:var(--bds)}.code::placeholder{color:var(--dis-c);letter-spacing:10px}' +
    '.err{color:var(--crit);font:400 14px/20px var(--ff);margin-top:8px;min-height:20px}' +
    '.btn{width:100%;height:48px;border:0;border-radius:16px;font:600 16px/1 var(--ff);cursor:pointer;background:var(--brand);color:var(--brand-c);margin-top:16px}' +
    '.btn:hover{background-image:linear-gradient(#ffffff0d,#ffffff0d)}.btn[disabled]{background:var(--dis);color:var(--dis-c);cursor:default}' +
    '.btn.gh{background:transparent;color:var(--c1);box-shadow:inset 0 0 0 1px var(--bd);margin-top:8px}.btn.gh:hover{background:var(--bg2)}' +
    'button:focus-visible,input:focus-visible{outline:2px solid var(--focus);outline-offset:2px}' +
    '.ft{margin:20px 0 0;font:400 12px/16px var(--ff);color:var(--c3);text-align:center}' +
    '@media (max-width:480px){.box{padding:24px;border-radius:20px}}';

  var ICON = {
    key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.7577 11.8281L18.6066 3.97919L20.0208 5.3934L18.6066 6.80761L21.0815 9.28249L19.6673 10.6967L17.1924 8.22183L15.7782 9.63604L17.8995 11.7574L16.4853 13.1716L14.364 11.0503L12.1719 13.2423C13.4581 15.1837 13.246 17.8251 11.5355 19.5355C9.58291 21.4882 6.41709 21.4882 4.46447 19.5355C2.51184 17.5829 2.51184 14.4171 4.46447 12.4645C6.17493 10.754 8.81633 10.5419 10.7577 11.8281ZM10.1213 18.1213C11.2929 16.9497 11.2929 15.0503 10.1213 13.8787C8.94975 12.7071 7.05025 12.7071 5.87868 13.8787C4.70711 15.0503 4.70711 16.9497 5.87868 18.1213C7.05025 19.2929 8.94975 19.2929 10.1213 18.1213Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM9 9H11V15H9V9ZM13 9H15V15H13V9Z"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 17H22V19H19V22H17V17ZM7 7H2V5H5V2H7V7ZM18.364 15.5362L16.9497 14.1219L18.364 12.7077C20.3166 10.7551 20.3166 7.58925 18.364 5.63663C16.4113 3.68401 13.2455 3.68401 11.2929 5.63663L9.87868 7.05084L8.46447 5.63663L9.87868 4.22241C12.6124 1.48874 17.0445 1.48874 19.7782 4.22241C22.5119 6.95608 22.5119 11.3882 19.7782 14.1219L18.364 15.5362ZM15.5355 18.3646L14.1213 19.7788C11.3877 22.5125 6.9555 22.5125 4.22183 19.7788C1.48816 17.0452 1.48816 12.613 4.22183 9.87935L5.63604 8.46514L7.05026 9.87935L5.63604 11.2936C3.68342 13.2462 3.68342 16.412 5.63604 18.3646C7.58866 20.3172 10.7545 20.3172 12.7071 18.3646L14.1213 16.9504L15.5355 18.3646ZM14.8284 7.75798L16.2426 9.1722L9.17157 16.2433L7.75736 14.8291L14.8284 7.75798Z"/></svg>',
  };

  function close() {
    host.remove(); hideBoot();
    // tira o link da barra de endereço para não abrir esta janela de novo ao navegar
    try { var u = new URL(location.href); u.searchParams.delete('review'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
  }

  function message(icon, title, text) {
    root.innerHTML = '<style>' + CSS + '</style><div class="bk"><div class="box" role="dialog" aria-modal="true">' +
      '<div class="ic">' + ICON[icon] + '</div><h1></h1><p></p><button class="btn ok" type="button">Ver o site</button></div></div>';
    root.querySelector('h1').textContent = title;
    root.querySelector('p').textContent = text;
    root.querySelector('.ok').onclick = close;
    root.querySelector('.ok').focus();
  }

  function codeForm() {
    var name = G.who && G.who.name ? G.who.name.split(/\s+/)[0] : '';
    root.innerHTML = '<style>' + CSS + '</style><div class="bk"><form class="box" role="dialog" aria-modal="true" aria-labelledby="fbg-t" novalidate>' +
      '<div class="ic">' + ICON.key + '</div><h1 id="fbg-t">' + (name ? 'Olá, ' + esc(name) + '!' : 'Código de acesso') + '</h1>' +
      '<p>Digite o <b>código de 6 dígitos</b> que veio no email do convite, junto com este link.</p>' +
      '<label for="fbg-c">Código de acesso</label>' +
      '<input id="fbg-c" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="••••••" aria-describedby="fbg-e">' +
      '<div class="err" id="fbg-e" role="alert"></div>' +
      '<button class="btn go" type="submit">Entrar na revisão</button>' +
      '<button class="btn gh cl" type="button">Só ver o site</button>' +
      '<div class="ft">Neste navegador o código é pedido só uma vez. Não achou o email? Peça um novo convite a quem te enviou o link.</div>' +
      '</form></div>';
    var inp = root.querySelector('.code'), err = root.querySelector('.err'), go = root.querySelector('.go');
    root.querySelector('.cl').onclick = close;
    if (G.lockedUntil) { err.textContent = 'Muitas tentativas erradas. Tente de novo às ' + hhmm(G.lockedUntil) + '.'; }
    inp.focus();
    inp.oninput = function () {
      var d = inp.value.replace(/\D/g, '').slice(0, 6);
      if (inp.value !== d) inp.value = d;
      err.textContent = '';
      if (d.length === 6) submit();
    };
    root.querySelector('form').onsubmit = function (e) { e.preventDefault(); submit(); };
    var busy = false;
    function submit() {
      var code = inp.value.replace(/\D/g, '');
      if (code.length !== 6) { err.textContent = 'O código tem 6 números.'; inp.focus(); return; }
      if (busy) return; busy = true;
      go.disabled = true; go.textContent = 'Conferindo…';
      fetch(G.base + '/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: G.token, code: code }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, b: b }; }); })
        .then(function (x) {
          if (x.ok && x.b.pass) {
            try { localStorage.setItem('fb_pass_' + G.token, x.b.pass); } catch (e) {}
            try { if (G.key && x.b.session) sessionStorage.setItem(G.key, x.b.session); } catch (e) {}
            go.textContent = 'Abrindo revisão…';
            location.reload(); // o loader ativa de novo, agora com o passe
            return;
          }
          busy = false; go.disabled = false; go.textContent = 'Entrar na revisão';
          var e = x.b.error;
          err.textContent = e === 'locked' ? 'Muitas tentativas erradas. Tente de novo às ' + hhmm(x.b.lockedUntil) + '.'
            : e === 'wrong_code' ? 'Código incorreto.' + (x.b.left != null ? ' Restam ' + x.b.left + (x.b.left === 1 ? ' tentativa.' : ' tentativas.') : '')
            : e === 'paused' ? 'A revisão deste site está pausada pelo estúdio.'
            : e === 'invalid_link' ? 'Este link não é mais válido. Peça um novo a quem te enviou.'
            : 'Não foi possível conferir o código. Tente de novo.';
          inp.select();
        })
        .catch(function () { busy = false; go.disabled = false; go.textContent = 'Entrar na revisão'; err.textContent = 'Sem conexão. Tente de novo.'; });
    }
  }

  function show() {
    hideBoot();
    if (G.reason === 'needs_code') codeForm();
    else if (G.reason === 'paused') message('pause', 'Revisão pausada', 'O estúdio pausou a revisão deste site por enquanto. Você pode ver o site normalmente; para comentar, fale com quem te enviou o link.');
    else if (G.reason === 'archived') message('pause', 'Revisão encerrada', 'A revisão deste projeto foi encerrada pelo estúdio. Se precisar comentar de novo, fale com quem te enviou o link.');
    else message('link', 'Link de revisão inválido', 'Este link foi desativado ou está incompleto. Confira se copiou o endereço inteiro, ou peça um novo a quem te enviou.');
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); e.stopPropagation(); });
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
})();
