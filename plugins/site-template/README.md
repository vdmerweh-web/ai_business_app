# Client site template: privacy pieces
Replace these placeholders in privacy.html and cookies.html before going live:
{BUSINESS} {DOMAIN} {ADDRESS} {INFO_OFFICER} {PRIVACY_EMAIL} {PHONE} {HOSTING} {REG_NO} {DATE}
Delete cookie rows for tools the site does not use. Set data-site on the consent.js tag to the site's domain.
Consent choices are logged at https://api.planet-grid.com/public/consent (no IP stored, only a hash).
Any analytics/ads/pixel script MUST be type="text/plain" data-consent="analytics" or "marketing".
Unsubscribe links: https://api.planet-grid.com/public/unsubscribe?t=<token> (tokens made by the API).

## Fonts
fonts/fonts.css sets CSS variables --pg-font-heading, --pg-font-body, --pg-heading-weight, --pg-body-weight. Default is system fonts.
Pick Google Fonts per website in the app (Blog > Fonts). Self-hosted is the default: run `tools/pull-fonts.sh <domain> <site-folder>` to copy the woff2 files into the site, so visitors never contact Google (no IP shared, nothing to add to the cookie notice).
If the Google CDN option is chosen instead, add Google Fonts to the privacy policy: it shares visitor IP addresses with Google.

## Blog (for later publishing)
Read-only JSON/RSS of published posts: https://api.planet-grid.com/public/blog/<domain>/posts.json, /posts/<slug>.json, /rss.xml. Images: /public/blog/<domain>/media/<file-id>.
