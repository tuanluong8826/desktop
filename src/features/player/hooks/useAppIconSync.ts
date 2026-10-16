import { useEffect } from "react";
import { usePlayerStore, type AppIconStyle } from "../store/playerStore";

const ICON_URLS: Record<AppIconStyle, string> = {
  default: "/icon.png",
  cyber: "/icon-cyber.png",
  sunset: "/icon-sunset.png",
  emerald: "/icon-emerald.png",
  gold: "/icon-gold.png",
  minimal: "/icon-minimal.png",
};

async function loadIconDataUrl(url: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load icon: " + url));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 512;
  canvas.height = img.naturalHeight || 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function useAppIconSync() {
  const appIconStyle = usePlayerStore((state) => state.appIconStyle) || "default";

  useEffect(() => {
    let active = true;
    const url = ICON_URLS[appIconStyle] || ICON_URLS.default;

    loadIconDataUrl(url)
      .then((dataUrl) => {
        if (!active || !dataUrl) return;

        if (window.linerElectron?.setAppIcon) {
          window.linerElectron.setAppIcon(dataUrl);
        }

        let favicon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
        if (!favicon) {
          favicon = document.createElement("link");
          favicon.rel = "icon";
          document.head.appendChild(favicon);
        }
        favicon.href = dataUrl;
      })
      .catch((err) => {
        console.error("[useAppIconSync] failed to sync icon:", err);
      });

    return () => {
      active = false;
    };
  }, [appIconStyle]);
}
