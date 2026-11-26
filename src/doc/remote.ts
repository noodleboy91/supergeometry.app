// Optional server storage. Browser storage stays the offline cache; this module
// only moves the same .super JSON to and from the Docker server's /api.

export interface RemoteEntry {
  id: string;
  name: string;
  /** ms; last write wins on the server. */
  modified: number;
  thumb?: string;
  size: number;
  text: string;
}

export interface AppConfig {
  storage: "browser" | "server";
  /** Shared secret for deployments without Cloudflare Access in front. */
  token?: string;
}

let config: AppConfig = { storage: "browser" };

/** Read /config.json before the app boots. A static host with no API just stays browser-only. */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (res.ok) {
      const value = (await res.json()) as AppConfig;
      if (value.storage === "browser" || value.storage === "server") config = value;
    }
  } catch {
    // No server config: keep the original browser-only behaviour.
  }
  return config;
}

export function serverStorage(): boolean {
  return config.storage === "server";
}

function headers(): Record<string, string> {
  return config.token ? { "x-sg-token": config.token } : {};
}

export async function remoteList(): Promise<RemoteEntry[]> {
  const res = await fetch("/api/projects", { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`list: ${res.status}`);
  return (await res.json()) as RemoteEntry[];
}

export async function remotePut(entry: RemoteEntry): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(entry.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`put: ${res.status}`);
}

export async function remoteDelete(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
  if (!res.ok) throw new Error(`delete: ${res.status}`);
}

// Coalesce the 400 ms autosaves into one request, and retry later when offline.
const pending = new Map<string, RemoteEntry>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function schedulePut(entry: RemoteEntry): void {
  pending.set(entry.id, entry);
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushPending();
  }, 1200);
}

/** The page is going away (or the project is switching): do not wait for the debounce. */
export async function pushNow(entry: RemoteEntry): Promise<void> {
  try {
    await remotePut(entry);
    pending.delete(entry.id);
  } catch {
    pending.set(entry.id, entry);
  }
}

async function flushPending(): Promise<void> {
  for (const entry of [...pending.values()]) await pushNow(entry);
}

if (typeof window !== "undefined") window.addEventListener("online", () => void flushPending());
