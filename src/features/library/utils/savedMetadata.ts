import type { EntityType } from "../hooks/useExternalItems";

const STORAGE_PREFIX = "liner_saved_metadata_";
const ITEMS_STORAGE_PREFIX = "liner_local_saved_";

export interface SavedItemMetadata {
  id: string;
  title: string;
  coverUrl?: string;
  artists?: string;
  year?: string;
  trackCount?: number;
  type: EntityType;
  savedAt?: string;
}

export function saveLocalMetadata(type: EntityType, id: string, meta: Partial<SavedItemMetadata>): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const key = `${STORAGE_PREFIX}${type}_${id}`;
    const existing = getLocalMetadata(type, id) || {};
    const merged = { ...existing, ...meta, id, type, updatedAt: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(merged));
  } catch (err) {
    console.warn("Failed to save local metadata:", err);
  }
}

export function getLocalMetadata(type: EntityType, id: string): SavedItemMetadata | null {
  if (typeof window === "undefined" || !id) return null;
  try {
    const key = `${STORAGE_PREFIX}${type}_${id}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function addLocalSavedItem(type: EntityType, id: string, meta: Partial<SavedItemMetadata>): void {
  if (typeof window === "undefined" || !id) return;
  try {
    saveLocalMetadata(type, id, meta);
    const key = `${ITEMS_STORAGE_PREFIX}${type}s`;
    const list = getLocalSavedItems(type);
    const filtered = list.filter((item) => item.id !== id);
    const newItem: SavedItemMetadata = {
      id,
      title: meta.title || "Untitled",
      coverUrl: meta.coverUrl || "",
      artists: meta.artists || "",
      year: meta.year,
      trackCount: meta.trackCount,
      type,
      savedAt: new Date().toISOString(),
    };
    filtered.unshift(newItem);
    localStorage.setItem(key, JSON.stringify(filtered));
    window.dispatchEvent(new Event("library:changed"));
  } catch (err) {
    console.warn("Failed to add local saved item:", err);
  }
}

export function removeLocalSavedItem(type: EntityType, id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const key = `${ITEMS_STORAGE_PREFIX}${type}s`;
    const list = getLocalSavedItems(type);
    const filtered = list.filter((item) => item.id !== id);
    localStorage.setItem(key, JSON.stringify(filtered));
    window.dispatchEvent(new Event("library:changed"));
  } catch (err) {
    console.warn("Failed to remove local saved item:", err);
  }
}

export function getLocalSavedItems(type: EntityType): SavedItemMetadata[] {
  if (typeof window === "undefined") return [];
  try {
    const key = `${ITEMS_STORAGE_PREFIX}${type}s`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
