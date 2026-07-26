# Build Stage
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts --legacy-peer-deps

COPY . .
RUN npm run build

# Production Stage — the -unprivileged image runs as non-root (uid 101) and
# listens on 8080, so there is no root master process (CKV_DOCKER_3).
FROM nginxinc/nginx-unprivileged:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

USER nginx

EXPOSE 8080

# CKV_DOCKER_2: fail the container if nginx stops serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
