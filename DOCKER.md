# Running superGeometry.app in Docker

There are two install modes. Pick one Compose file; it builds the image and
starts the container configured for that mode.

| Mode | Compose file | Where projects live |
| --- | --- | --- |
| Browser storage | `compose.browser.yml` | Only in each browser's IndexedDB (original behaviour). |
| Server storage | `compose.server.yml` | In a named Docker volume, mirrored to each browser as an offline cache. |

No nginx is involved. The image runs a small dependency-free Node HTTP server
(`server.mjs`) that serves the built site and, in server mode, the `/api`
endpoints.

## Requirements

- Docker with Compose v2 (`docker compose version`)
- ~2 GB free disk for build layers and the ~23 MB geometry engine
- A browser with WebGL and WebAssembly

## Quick start

From a checkout of this repository:

```bash
# Browser storage (default behaviour)
docker compose -f compose.browser.yml up -d --build

# Or server storage
docker compose -f compose.server.yml up -d --build
```

Open <http://localhost:8080>. To use another host port:

```bash
SUPERGEOMETRY_PORT=18080 docker compose -f compose.server.yml up -d --build
```

Stop the running stack before switching modes:

```bash
docker compose -f compose.browser.yml down
docker compose -f compose.server.yml up -d --build
```

Both files use the same container name on purpose: only one mode runs at a
time. The image is tagged differently (`supergeometry:browser` vs
`supergeometry:server`).

## How server storage works

- The server keeps `projects.json` at `/data` in the named volume
  `supergeometry-data`. Each entry holds the project's `.super` JSON text and
  its thumbnail.
- The browser still autosaves to IndexedDB. In server mode it also writes the
  same JSON to `PUT /api/projects/<id>` (debounced, queued while offline and
  retried when the connection returns).
- On startup and when the gallery is opened, newer server projects are copied
  into the browser, including the open project's autosave. A save from another
  browser therefore shows up here. The last save wins by timestamp.
- Undo/redo history stays local to the browser; it is not sent to the server.
- `File → Save project` still downloads a portable `.super` file at any time.

Endpoints (same origin, so the app's CSP needs no change):

| Method | Path | Use |
| --- | --- | --- |
| `GET` | `/config.json` | Tells the app which storage mode is active. |
| `GET` | `/health` | Container health check. |
| `GET` | `/api/projects` | List projects with their text. |
| `PUT` | `/api/projects/<id>` | Create or update one project. |
| `DELETE` | `/api/projects/<id>` | Delete one project. |

`GET /api/projects` returns `404` in browser mode. The service worker skips
`/config.json` and `/api/` so offline caching never serves stale project data.

## Access control and Cloudflare Tunnel

With Cloudflare Tunnel + Zero Trust you can rely on Access for authentication:
point the tunnel at `localhost:8080` and keep the container's port unpublished
if the tunnel runs on the same host. HTTPS is required for installable/offline
mode; `localhost` is the only exception.

For defence in depth, set a shared token:

```bash
SUPERGEOMETRY_TOKEN='a-long-random-string' docker compose -f compose.server.yml up -d --build
```

The token is delivered to the browser in `/config.json` and sent as
`x-sg-token` on API calls. It is a shared secret for a trusted group, not a
per-user account system. Do not expose the app publicly without either Access
or the token (ideally both).

If you later want separate project lists per person, Cloudflare Access adds
`Cf-Access-Authenticated-User-Email`; the API could scope rows by it. That is
not implemented in this first version.

## Backups and updates

There is no database process — just one file on a volume. To back it up:

```bash
docker compose -f compose.server.yml down
docker run --rm -v supergeometry-data:/data -v "$PWD":/backup alpine \
  cp /data/projects.json /backup/projects.json
docker compose -f compose.server.yml up -d
```

Or simply copy the volume from your Docker host's storage directory. Keep
`.super` exports as the portable backup too.

To update the app:

```bash
git pull
docker compose -f compose.server.yml up -d --build
```

Hashed asset names change with each build, so browsers pick up the new code
while keeping their local cache of projects.

## Everyday commands

```bash
docker compose -f compose.server.yml logs -f
docker compose -f compose.server.yml ps
docker compose -f compose.server.yml restart
docker compose -f compose.server.yml down
```

## What the server handles

- SPA fallback for client-side routes
- `application/wasm` MIME type for the geometry engine
- long-lived caching for `/assets/`, `no-cache` for the page, service worker
  and update metadata
- the CSP, `nosniff` and referrer headers from `public/_headers`

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `address already in use` | Change `SUPERGEOMETRY_PORT`, or stop the other service. |
| `401 Unauthorized` from `/api` | `SUPERGEOMETRY_TOKEN` is set; the browser must load the page fresh so `/config.json` picks it up. |
| Projects from another browser don't appear | Open File → Open (that refreshes the list), and check both browsers use the same URL/origin. |
| Old UI after an update | Hard refresh or unregister the service worker; confirm the container was recreated. |
| Container unhealthy | `docker compose -f compose.server.yml logs` and `curl http://localhost:8080/health`. |
| Blank page / geometry error | Browser needs WebGL and WebAssembly; check that `/assets/*.wasm` returns `Content-Type: application/wasm`. |

## Licence

AGPL-3.0-or-later. Self-hosting is allowed; if you publish a modified build,
the modified source must stay available. See [`LICENSE`](LICENSE).
