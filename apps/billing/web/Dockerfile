FROM node:24-alpine AS b
WORKDIR /w
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=b /w/dist /usr/share/nginx/html
