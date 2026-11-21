/* Planet Grid app GA4 loader. Hooked into the existing cookie consent banner.
 * gtag.js is loaded only after analytics cookies are accepted.
 * Consent Mode defaults are denied until then.
 */
(function () {
  var ID = 'G-43744FFR6R';
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

  function loadGtag(c) {
    var ads = c && c.marketing ? 'granted' : 'denied';
    function update() {
      gtag('consent', 'update', {
        analytics_storage: c && c.analytics ? 'granted' : 'denied',
        ad_storage: ads,
        ad_user_data: ads,
        ad_personalization: ads
      });
    }
    if (c && c.analytics && !loaded) {
      loaded = true;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
      s.onload = function () {
        gtag('js', new Date());
        update();
        gtag('config', ID);
      };
      document.head.appendChild(s);
    } else {
      update();
    }
  }

  document.addEventListener('pg-consent', function (e) { loadGtag(e.detail); });
  if (window.pgConsent && typeof window.pgConsent.get === 'function') {
    var now = window.pgConsent.get();
    if (now) loadGtag(now);
  }
})();
