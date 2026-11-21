FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
CMD ["node","src/index.js"]
