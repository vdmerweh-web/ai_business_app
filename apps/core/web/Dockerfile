FROM node:22-alpine AS b
WORKDIR /w
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=b /w/dist /usr/share/nginx/html
