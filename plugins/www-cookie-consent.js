/* Planet Grid marketing site cookie consent + GA4 loader.
 * gtag.js is loaded only after the visitor accepts analytics cookies.
 * Consent Mode defaults are denied until then.
 */
(function () {
  var ID = 'G-MMXDH25V4G';
  var COOKIE = 'pg_analytics_consent';
  var MAX_AGE = 63072000; // 2 years, in seconds
  var loaded = false;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  function readChoice() {
    var m = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.indexOf(COOKIE + '=') === 0; });
    if (!m) return null;
    var v = decodeURIComponent(m.split('=').slice(1).join('='));
    if (v === 'accepted' || v === 'denied') return v;
    return null;
  }
  function writeChoice(v) {
    document.cookie = COOKIE + '=' + v + ';Max-Age=' + MAX_AGE + ';Path=/;SameSite=Lax;Secure';
  }
  function loadGtag() {
    if (loaded) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      return;
    }
    loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
    s.onload = function () {
      gtag('js', new Date());
      gtag('consent', 'update', { analytics_storage: 'granted' });
      gtag('config', ID);
    };
    document.head.appendChild(s);
  }
  function denyGtag() {
    if (loaded) gtag('consent', 'update', { analytics_storage: 'denied' });
  }
  function apply(choice) {
    if (choice === 'accepted') loadGtag();
    else denyGtag();
  }

  var css = '#pgc{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:12px;max-width:560px;margin:0 auto;background:#14203a;color:#e8ecff;border:1px solid #2a3558;border-radius:14px;padding:18px 18px 14px;font:16px/1.5 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.4)}' +
    '#pgc h2{margin:0 0 8px;font-size:1.1rem;color:#fff}#pgc p{margin:0 0 14px}#pgc a{color:#9cbcff}#pgc a:focus-visible,#pgc button:focus-visible{outline:3px solid #ffd166;outline-offset:2px}' +
    '#pgc .r{display:flex;flex-wrap:wrap;gap:8px}#pgc button{font:inherit;border-radius:9px;padding:9px 14px;border:2px solid #8fd3ff;background:transparent;color:#fff;cursor:pointer}' +
    '#pgc button.p{background:#8fd3ff;color:#0b1020;font-weight:600}' +
    '@media (prefers-reduced-motion:reduce){#pgc{transition:none;animation:none}}';

  var lastFocus = null;
  function closeBanner() {
    var b = document.getElementById('pgc');
    if (b) b.remove();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function openBanner() {
    closeBanner();
    lastFocus = document.activeElement;
    var d = document.createElement('div');
    d.id = 'pgc';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'pgc-t');
    d.setAttribute('aria-describedby', 'pgc-d');
    d.innerHTML = '<h2 id="pgc-t">Cookies on this site</h2>' +
      '<p id="pgc-d">This site works without extra cookies. If you say yes, we will use a Google Analytics cookie to see which pages help people. You can say no. <a href="/cookies.html">Read our cookie page</a>.</p>' +
      '<div class="r"><button type="button" class="p" data-a="accept">Accept</button><button type="button" data-a="reject">No thanks</button></div>';
    document.body.appendChild(d);
    var first = d.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    d.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'accept') { writeChoice('accepted'); apply('accepted'); closeBanner(); }
      if (a === 'reject') { writeChoice('denied'); apply('denied'); closeBanner(); }
    });
  }

  function start() {
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    document.querySelectorAll('[data-cookie-settings]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); openBanner(); });
    });
    var choice = readChoice();
    if (choice) apply(choice);
    else openBanner();
  }
  window.pgCookieSettings = openBanner;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
