import { createInitialWorkspace } from "./defaults";
import type { SyncState, WorkspaceData } from "../types";

const LEGACY_STORAGE_KEY = "pricing-desk-workspace-v1";
const SYNC_STORAGE_KEY = "pricing-desk-sync-v1";
const DB_NAME = "pricing-desk-db";
const STORE_NAME = "workspace";
const RECORD_KEY = "current";

function normalizeWorkspace(value?: Partial<WorkspaceData> | null): WorkspaceData {
  const initial = createInitialWorkspace();

  return {
    products: Array.isArray(value?.products) ? value.products : initial.products,
    markets: Array.isArray(value?.markets) ? value.markets : initial.markets,
    shippingRates: Array.isArray(value?.shippingRates) ? value.shippingRates : initial.shippingRates,
    listings: Array.isArray(value?.listings) ? value.listings : initial.listings,
    sync: {
      ...initial.sync,
      ...(value?.sync ?? {}),
    },
  };
}

function parseWorkspace(raw: string | null): WorkspaceData | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizeWorkspace(JSON.parse(raw) as Partial<WorkspaceData>);
  } catch (error) {
    console.error("Failed to parse stored workspace", error);
    return null;
  }
}

function loadSyncState(): SyncState {
  const initialSync = createInitialWorkspace().sync;

  try {
    const rawSync = window.localStorage.getItem(SYNC_STORAGE_KEY);
    if (rawSync) {
      return {
        ...initialSync,
        ...(JSON.parse(rawSync) as Partial<SyncState>),
      };
    }

    const legacyWorkspace = parseWorkspace(window.localStorage.getItem(LEGACY_STORAGE_KEY));
    return legacyWorkspace?.sync ? { ...initialSync, ...legacyWorkspace.sync } : initialSync;
  } catch (error) {
    console.error("Failed to load sync state", error);
    return initialSync;
  }
}

function saveSyncState(sync: SyncState) {
  try {
    window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(sync));
  } catch (error) {
    console.error("Failed to save sync state", error);
  }
}

function clearLegacyWorkspace() {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear legacy workspace", error);
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function readFromIndexedDb(): Promise<WorkspaceData | null> {
  const database = await openDatabase();
  if (!database) {
    return null;
  }

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);

    request.onsuccess = () => {
      database.close();
      resolve(request.result ? normalizeWorkspace(request.result as Partial<WorkspaceData>) : null);
    };

    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Failed to read IndexedDB workspace"));
    };
  });
}

async function writeToIndexedDb(workspace: WorkspaceData): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.put(normalizeWorkspace(workspace), RECORD_KEY);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };

    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Failed to write IndexedDB workspace"));
    };
  });
}

export function loadWorkspace(): WorkspaceData {
  return normalizeWorkspace({ sync: loadSyncState() });
}

export async function hydrateWorkspace(): Promise<WorkspaceData> {
  const indexedDbWorkspace = await readFromIndexedDb().catch((error) => {
    console.error("Failed to hydrate workspace from IndexedDB", error);
    return null;
  });

  if (indexedDbWorkspace) {
    saveSyncState(indexedDbWorkspace.sync);
    return indexedDbWorkspace;
  }

  const legacyWorkspace = parseWorkspace(window.localStorage.getItem(LEGACY_STORAGE_KEY));
  if (legacyWorkspace) {
    await writeToIndexedDb(legacyWorkspace).catch((error) => {
      console.error("Failed to migrate legacy workspace", error);
    });
    saveSyncState(legacyWorkspace.sync);
    clearLegacyWorkspace();
    return legacyWorkspace;
  }

  return normalizeWorkspace({ sync: loadSyncState() });
}

export async function saveWorkspace(workspace: WorkspaceData) {
  saveSyncState(workspace.sync);

  await writeToIndexedDb(workspace).catch((error) => {
    console.error("Failed to persist workspace", error);
  });

  clearLegacyWorkspace();
}
