// base url of the share-link redirector
export const SHARE_BASE_URL = "https://miloapi.dev";

export type ShareEntityType = "artist" | "album" | "playlist" | "track";

// builds a public share link, the redirector bounces it to the liner:// deeplink
export function buildShareUrl(type: ShareEntityType, id: string): string {
  return `${SHARE_BASE_URL}/${type}?id=${encodeURIComponent(id)}`;
}
