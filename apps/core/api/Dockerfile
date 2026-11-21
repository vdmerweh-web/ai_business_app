FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
FROM node:22-alpine
ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=96
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3600
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3600/api/health || exit 1
CMD ["node","src/index.js"]
