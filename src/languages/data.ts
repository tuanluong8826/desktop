import en from "./locales/en.json";
import vi from "./locales/vi.json";
import ru from "./locales/ru.json";
import uk from "./locales/uk.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zh from "./locales/zh.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import type { Locale } from "./locale";

export const translations: Record<Locale, Record<string, unknown>> = {
  en,
  vi,
  ru,
  uk,
  ja,
  ko,
  zh,
  es,
  fr,
  de,
};
