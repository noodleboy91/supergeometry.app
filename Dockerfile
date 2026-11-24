# superGeometry.app is a static site: no server code, no database.
# Build the site with Node, then serve dist/ with nginx.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# The build writes the current commit into dist/version.json; slim images have no git.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first so this layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O - http://127.0.0.1/ >/dev/null || exit 1
