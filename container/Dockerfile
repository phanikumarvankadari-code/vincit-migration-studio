# Build stage: install, type-check and build the static app.
FROM node:22.12-alpine3.21 AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build

# Runtime stage: static files only, no Node, non-root user (uid 101), port 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY container/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/mapping-studio/dist /usr/share/nginx/html
# User files (sources, output, project files) live on a mounted volume, never in the image.
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
