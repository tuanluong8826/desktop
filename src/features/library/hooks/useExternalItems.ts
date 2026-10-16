import { useEffect, useState } from "react";
import { api, mediaUrl, toMaxQualityAvatarUrl } from "@/shared/api";
import type { LibraryItemViewModel } from "../types";
import {
  getLocalSavedItems,
  getLocalMetadata,
  saveLocalMetadata,
} from "../utils/savedMetadata";

export type EntityType = "album" | "artist" | "playlist";

export function useExternalItems(type: EntityType) {
  const [data, setData] = useState<LibraryItemViewModel[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const collectionType =
          type === "album" ? "albums" : type === "artist" ? "artists" : "playlists";

        let remoteItems: any[] = [];
        try {
          const response = await api.listSavedCollections(collectionType);
          if (Array.isArray(response?.items)) {
            remoteItems = response.items;
          }
        } catch (err) {
          console.warn("api.listSavedCollections failed:", err);
        }

        if (!active) return;

        const localItems = getLocalSavedItems(type);
        const itemMap = new Map<string, LibraryItemViewModel>();

        // 1. First add local saved items
        for (const local of localItems) {
          if (!local.id) continue;
          itemMap.set(local.id, {
            id: local.id,
            title: local.title || "Untitled",
            subtitle:
              type === "artist"
                ? "Artist"
                : type === "playlist"
                  ? "Playlist"
                  : [local.year, local.trackCount ? `${local.trackCount} tracks` : undefined]
                      .filter(Boolean)
                      .join(" • ") || local.artists || "Album",
            imageUrl: local.coverUrl || "",
            kind: type,
            href:
              type === "artist"
                ? `/artist?id=${encodeURIComponent(local.id)}`
                : type === "playlist"
                  ? `/collection?type=playlist&id=${encodeURIComponent(local.id)}`
                  : `/collection?type=album&id=${encodeURIComponent(local.id)}`,
            addedAt: local.savedAt || new Date().toISOString(),
            trackCount: local.trackCount,
            isOwned: false,
          });
        }

        // 2. Process remote items
        for (const entry of remoteItems) {
          if (!entry) continue;
          const value = entry[type] || entry;
          const rawId = value.id || entry.id;
          if (!rawId) continue;

          const meta = getLocalMetadata(type, rawId);

          let title =
            (type === "artist" ? value.name : value.title) ||
            meta?.title ||
            "";

          let rawCover =
            (value.cover?.url ? mediaUrl(value.cover.url) : typeof value.cover === "string" ? mediaUrl(value.cover) : "") ||
            (value.coverUrl ? mediaUrl(value.coverUrl) : "") ||
            meta?.coverUrl ||
            "";

          const cover = type === "artist" ? toMaxQualityAvatarUrl(rawCover) : rawCover;
          const addedAt = entry.savedAt || entry.addedAt || meta?.savedAt || new Date().toISOString();
          const trackCount = value.trackCount ?? meta?.trackCount;

          const existing = itemMap.get(rawId);
          if (existing) {
            if (!existing.imageUrl && cover) existing.imageUrl = cover;
            if ((!existing.title || existing.title === "Untitled") && title) existing.title = title;
          } else {
            itemMap.set(rawId, {
              id: rawId,
              title: title || (type === "album" ? "Album" : type === "artist" ? "Artist" : "Playlist"),
              subtitle:
                type === "artist"
                  ? "Artist"
                  : type === "playlist"
                    ? (value.author || (trackCount ? `${trackCount} tracks` : "Playlist"))
                    : [value.year || meta?.year, trackCount ? `${trackCount} tracks` : undefined]
                        .filter(Boolean)
                        .join(" • ") || meta?.artists || "Album",
              imageUrl: cover,
              kind: type,
              href:
                type === "artist"
                  ? `/artist?id=${encodeURIComponent(rawId)}`
                  : type === "playlist"
                    ? `/collection?type=playlist&id=${encodeURIComponent(rawId)}`
                    : `/collection?type=album&id=${encodeURIComponent(rawId)}`,
              addedAt,
              trackCount,
              isOwned: false,
            });
          }
        }

        const resultList = Array.from(itemMap.values());
        if (active) {
          setData(resultList);
        }

        // 3. For any items that are missing title or cover, background fetch if album/artist
        if (type === "album") {
          const needsEnrichment = resultList.filter(
            (it) => (!it.title || it.title === "Album" || !it.imageUrl) && !it.id.startsWith("itunes:"),
          );
          if (needsEnrichment.length > 0) {
            Promise.allSettled(
              needsEnrichment.slice(0, 5).map(async (item) => {
                try {
                  const alb = await api.getAlbum(item.id);
                  if (alb && active) {
                    const cUrl = alb.cover?.url ? mediaUrl(alb.cover.url) : (alb.tracks?.[0]?.cover ? mediaUrl(alb.tracks[0].cover.url) : "");
                    saveLocalMetadata("album", item.id, {
                      title: alb.title,
                      coverUrl: cUrl,
                      trackCount: alb.tracks?.length,
                    });
                    setData((prev) =>
                      prev.map((it) =>
                        it.id === item.id
                          ? {
                              ...it,
                              title: alb.title || it.title,
                              imageUrl: cUrl || it.imageUrl,
                              trackCount: alb.tracks?.length || it.trackCount,
                            }
                          : it,
                      ),
                    );
                  }
                } catch {}
              }),
            );
          }
        }
      } catch (err) {
        console.warn("useExternalItems load error:", err);
        if (active) {
          const fallbackLocal = getLocalSavedItems(type).map((local) => ({
            id: local.id,
            title: local.title || "Untitled",
            subtitle: type === "artist" ? "Artist" : local.artists || "Album",
            imageUrl: local.coverUrl || "",
            kind: type,
            href:
              type === "artist"
                ? `/artist?id=${encodeURIComponent(local.id)}`
                : `/collection?type=${type}&id=${encodeURIComponent(local.id)}`,
            addedAt: local.savedAt || new Date().toISOString(),
            isOwned: false,
          }));
          setData(fallbackLocal);
        }
      }
    };

    void load();

    const refresh = () => void load();
    window.addEventListener("library:changed", refresh);
    window.addEventListener("auth:changed", refresh);

    return () => {
      active = false;
      window.removeEventListener("library:changed", refresh);
      window.removeEventListener("auth:changed", refresh);
    };
  }, [type]);

  return { data };
}
