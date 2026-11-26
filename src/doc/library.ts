// The projects in File → Open. They are kept in the browser's storage for this
// site (so the app works offline), and, when the server is in "server" storage
// mode, mirrored to /api so any browser can open them again.

import { idbDel, idbGet, idbSet } from "./store";
import { pushNow, remoteDelete, remoteList, schedulePut, serverStorage, type RemoteEntry } from "./remote";

export interface LibraryEntry {
  id: string;
  name: string;
  /** When it was last saved (ms). */
  modified: number;
  /** A small JPEG of the view (data URL). */
  thumb?: string;
  /** How big its saved document is (characters). */
  size: number;
}

const INDEX = "library";
const CURRENT = "library-current";
const docKey = (id: string) => `project:${id}`;

export function newProjectId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The browser's own copy of the list, newest first. */
async function localEntries(): Promise<LibraryEntry[]> {
  try {
    const list = JSON.parse((await idbGet(INDEX)) ?? "[]") as LibraryEntry[];
    return Array.isArray(list) ? list.sort((a, b) => b.modified - a.modified) : [];
  } catch {
    return [];
  }
}

/** The index is read, changed and written back one change at a time. */
let queue: Promise<unknown> = Promise.resolve();
function editIndex(fn: (list: LibraryEntry[]) => LibraryEntry[]): Promise<void> {
  const run = queue.then(async () => idbSet(INDEX, JSON.stringify(fn(await localEntries()))));
  queue = run.catch(() => undefined);
  return run;
}

let lastSync = 0;
let syncing: Promise<void> | null = null;

/**
 * Copy newer server projects into this browser, including the open one's
 * autosave. Older local copies (and anything made offline) are left alone.
 */
export function syncFromRemote(): Promise<void> {
  if (!serverStorage()) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    let list: RemoteEntry[];
    try {
      list = await remoteList();
    } catch {
      return; // offline: the browser's own copies are still good
    }
    const current = await idbGet(CURRENT);
    for (const remote of list) {
      const local = (await localEntries()).find((e) => e.id === remote.id);
      if (local && local.modified >= remote.modified) continue;
      await idbSet(docKey(remote.id), remote.text);
      await editIndex((items) => {
        const old = items.find((e) => e.id === remote.id);
        const entry: LibraryEntry = {
          id: remote.id,
          name: remote.name,
          modified: remote.modified,
          thumb: remote.thumb ?? old?.thumb,
          size: remote.size,
        };
        return [entry, ...items.filter((e) => e.id !== remote.id)];
      });
      if (current === remote.id) await idbSet("autosave", remote.text);
    }
  })().finally(() => {
    syncing = null;
    lastSync = Date.now();
  });
  return syncing;
}

/** The projects, newest first. In server mode the list is refreshed now and then. */
export async function libraryEntries(): Promise<LibraryEntry[]> {
  if (serverStorage() && syncing === null && Date.now() - lastSync > 4000) {
    await syncFromRemote().catch(() => undefined);
  }
  return localEntries();
}

/** Which project is open (its autosave is its newest state). */
export async function currentProjectId(): Promise<string | null> {
  return idbGet(CURRENT);
}
export function setCurrentProject(id: string): Promise<void> {
  return idbSet(CURRENT, id);
}

/** Write to this browser, then (in server mode) to the server. */
async function persistProject(id: string, name: string, text: string, thumb: string | undefined, modified: number): Promise<void> {
  const was = (await localEntries()).find((e) => e.id === id);
  const savedThumb = thumb ?? was?.thumb;
  await idbSet(docKey(id), text);
  await editIndex((list) => {
    const entry: LibraryEntry = { id, name, modified, thumb: savedThumb, size: text.length };
    return [entry, ...list.filter((e) => e.id !== id)];
  });
  if (serverStorage()) {
    const remote: RemoteEntry = { id, name, modified, thumb: savedThumb, size: text.length, text };
    // On hide/pagehide there is no time for a debounce.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") void pushNow(remote);
    else schedulePut(remote);
  }
}

/** Keep a project (its document as text; a new picture, or the one it had). */
export async function keepProject(id: string, name: string, text: string, thumb?: string): Promise<void> {
  await persistProject(id, name, text, thumb, Date.now());
  askToKeepStorage();
}

export function projectText(id: string): Promise<string | null> {
  return idbGet(docKey(id));
}

/** A kept project's new name (in its document too). Its place in the list stays. */
export async function renameProject(id: string, name: string): Promise<void> {
  const text = await projectText(id);
  const modified = Date.now();
  if (text) {
    try {
      const doc = JSON.parse(text);
      doc.name = name;
      await persistProject(id, name, JSON.stringify(doc), undefined, modified);
      return;
    } catch {
      // unreadable: the list's name still changes
    }
  }
  await editIndex((list) => list.map((e) => (e.id === id ? { ...e, name, modified } : e)));
  if (serverStorage()) {
    try {
      const found = (await remoteList()).find((e) => e.id === id);
      if (found) schedulePut({ ...found, name, modified });
    } catch {
      // offline: queued on the next save
    }
  }
}

export async function forgetProject(id: string): Promise<void> {
  await editIndex((list) => list.filter((e) => e.id !== id));
  await idbDel(docKey(id));
  if (serverStorage()) void remoteDelete(id).catch(() => undefined);
}

/**
 * Ask the browser to keep this site's storage (it may otherwise clear it when
 * the device runs low, or - Safari - after weeks without a visit). Asked once
 * a visit; browsers decide by themselves (an installed app usually gets it).
 */
let asked = false;
function askToKeepStorage(): void {
  if (asked) return;
  asked = true;
  try {
    void navigator.storage?.persist?.();
  } catch {
    // not offered here
  }
}
