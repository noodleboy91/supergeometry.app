# superGeometry.app is a static site; this image serves dist/ with a tiny
# dependency-free Node server. STORAGE=browser|server is chosen by the Compose
# file, and only server mode uses the /data volume.

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

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY server.mjs ./server.mjs
ENV PORT=8080 STORAGE=browser DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
