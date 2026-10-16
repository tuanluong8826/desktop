export type Locale =
  | "en"
  | "vi"
  | "ru"
  | "uk"
  | "ja"
  | "ko"
  | "zh"
  | "es"
  | "fr"
  | "de";

export const SUPPORTED_LOCALES: Locale[] = [
  "en",
  "vi",
  "ru",
  "uk",
  "ja",
  "ko",
  "zh",
  "es",
  "fr",
  "de",
];

const LOCALE_STORAGE_KEY = "liner_locale";

export function getStoredLocale(): Locale {
  if (typeof window === "undefined" || !window.localStorage) return "vi";
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored && (SUPPORTED_LOCALES as string[]).includes(stored)) {
    return stored as Locale;
  }
  // Handle legacy stored 'ua'
  if (stored === "ua") {
    storeLocale("uk");
    return "uk";
  }
  return getBrowserLocale();
}

export function storeLocale(locale: Locale): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
}

export function getBrowserLocale(): Locale {
  if (typeof window === "undefined") return "vi";
  const langs = window.navigator.languages ?? [window.navigator.language];
  for (const l of langs) {
    const code = l.slice(0, 2).toLowerCase();
    if (code === "vi") return "vi";
    if (code === "en") return "en";
    if (code === "ru") return "ru";
    if (code === "uk" || code === "ua") return "uk";
    if (code === "ja") return "ja";
    if (code === "ko") return "ko";
    if (code === "zh") return "zh";
    if (code === "es") return "es";
    if (code === "fr") return "fr";
    if (code === "de") return "de";
  }
  return "vi";
}
