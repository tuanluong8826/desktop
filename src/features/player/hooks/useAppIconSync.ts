import { useEffect } from "react";
import { usePlayerStore, type AppIconStyle } from "../store/playerStore";
import iconDefault from "@/assets/icons/icon-default.png";
import iconCyber from "@/assets/icons/icon-cyber.png";
import iconSunset from "@/assets/icons/icon-sunset.png";
import iconEmerald from "@/assets/icons/icon-emerald.png";
import iconGold from "@/assets/icons/icon-gold.png";
import iconMinimal from "@/assets/icons/icon-minimal.png";

export const APP_ICONS: Record<AppIconStyle, string> = {
  default: iconDefault,
  cyber: iconCyber,
  sunset: iconSunset,
  emerald: iconEmerald,
  gold: iconGold,
  minimal: iconMinimal,
};

export async function loadIconDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 512;
        canvas.height = img.naturalHeight || 512;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("");
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load icon: " + url));
    img.src = url;
  });
}

export function useAppIconSync() {
  const appIconStyle = usePlayerStore((state) => state.appIconStyle) || "default";

  useEffect(() => {
    let active = true;
    const url = APP_ICONS[appIconStyle] || APP_ICONS.default;

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
