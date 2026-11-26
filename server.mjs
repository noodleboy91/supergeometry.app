// Tiny static server for superGeometry.app. No dependencies, no framework.
//
// In browser mode it only serves dist/ (plus /config.json and /health).
// In server mode it also serves /api/projects, storing each project's .super
// JSON in a file on the mounted /data volume.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = Number(process.env.PORT || 8080);
const STORAGE = String(process.env.STORAGE || "browser").toLowerCase() === "server" ? "server" : "browser";
const DATA_DIR = process.env.DATA_DIR || "/data";
const DATA_FILE = path.join(DATA_DIR, "projects.json");
const TOKEN = process.env.AUTH_TOKEN || "";

// Copied from public/_headers, so a plain HTTP server keeps the same policy.
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; " +
  "font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; " +
  "frame-src https: http:; media-src 'self' data: blob:; object-src 'none'; " +
  "base-uri 'self'; form-action 'none'";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

let projects = [];
if (STORAGE === "server") {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    if (Array.isArray(saved)) projects = saved;
  } catch {
    projects = [];
  }
}

// Serialise writes and replace atomically, so a stopped container cannot leave a half file.
let writes = Promise.resolve();
function saveProjects() {
  writes = writes.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(projects, null, 2));
    await fs.rename(tmp, DATA_FILE);
  });
  return writes;
}

function baseHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": CSP,
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...baseHeaders(), ...headers });
  res.end(body);
}

function sendJson(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    ...headers,
  });
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  let file = path.resolve(DIST, `.${decodeURIComponent(rel)}`);
  if (!file.startsWith(DIST)) return send(res, 403, "Forbidden");

  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, "index.html");
  } catch {
    // Unknown paths are client-side routes: the SPA shell handles them.
    file = path.join(DIST, "index.html");
  }

  let body;
  try {
    body = await fs.readFile(file);
  } catch {
    return send(res, 404, "Not found");
  }

  send(res, 200, req.method === "HEAD" ? undefined : body, {
    "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20_000_000) throw new Error("too large");
    chunks.push(chunk);
  }
  const value = Buffer.concat(chunks).toString("utf8");
  return value ? JSON.parse(value) : {};
}

function authorised(req) {
  if (!TOKEN) return true;
  return req.headers["x-sg-token"] === TOKEN;
}

async function handleApi(req, res, pathname) {
  // /api/projects or /api/projects/<id>
  const parts = pathname.split("/").filter(Boolean);
  const id = parts[2] ? decodeURIComponent(parts[2]) : null;
  if (parts[1] !== "projects" || (id && parts.length !== 3)) return sendJson(res, 404, { error: "Not found" });

  if (req.method === "GET" && !id) return sendJson(res, 200, projects);

  if (req.method === "PUT" && id) {
    const body = await readJson(req);
    if (typeof body.text !== "string" || typeof body.name !== "string") {
      return sendJson(res, 400, { error: "name and text are required" });
    }
    const entry = {
      id,
      name: body.name,
      modified: Number(body.modified) || Date.now(),
      thumb: typeof body.thumb === "string" ? body.thumb : undefined,
      size: typeof body.size === "number" ? body.size : body.text.length,
      text: body.text,
    };
    const at = projects.findIndex((p) => p.id === id);
    // Last write wins by the app's own timestamp.
    if (at >= 0 && projects[at].modified > entry.modified) return sendJson(res, 200, projects[at]);
    if (at >= 0) projects[at] = entry;
    else projects.push(entry);
    await saveProjects();
    return sendJson(res, 200, entry);
  }

  if (req.method === "DELETE" && id) {
    projects = projects.filter((p) => p.id !== id);
    await saveProjects();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 405, { error: "Method not allowed" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname === "/health") return sendJson(res, 200, { ok: true, storage: STORAGE });
    if (pathname === "/config.json") {
      return sendJson(res, 200, { storage: STORAGE, ...(TOKEN ? { token: TOKEN } : {}) });
    }
    if (pathname.startsWith("/api/")) {
      if (STORAGE !== "server") return sendJson(res, 404, { error: "Server storage is disabled" });
      if (!authorised(req)) return sendJson(res, 401, { error: "Unauthorized" });
      return await handleApi(req, res, pathname);
    }
    return await serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) return sendJson(res, 500, { error: "Internal error" });
    res.end();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`superGeometry.app: http://0.0.0.0:${PORT} (storage: ${STORAGE})`);
});
