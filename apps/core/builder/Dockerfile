# Site builder: turns a site's spec.json (+ client blocks) into a static Astro site.
# Internal only (no published port). The api asks it to build over the compose network.
FROM node:22-alpine
ENV NODE_ENV=production ASTRO_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js gen.js ./
COPY template ./template
USER node
EXPOSE 3700
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3700/health || exit 1
CMD ["node","server.js"]
