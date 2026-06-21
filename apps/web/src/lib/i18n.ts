import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import tr from "@/locales/tr.json";
import en from "@/locales/en.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "tr",
    supportedLngs: ["tr", "en"],
    detection: {
      // Turkish-market app: default to TR (fallbackLng) for everyone, ignoring
      // the browser language. Only an explicit in-app choice (saved to
      // localStorage) switches it — e.g. to EN.
      order: ["localStorage"],
      caches: ["localStorage"],
      lookupLocalStorage: "lang",
    },
    interpolation: { escapeValue: false },
    resources: { tr: { translation: tr }, en: { translation: en } },
  });

function syncHtmlLang(lng: string) {
  if (typeof document === "undefined") return;
  const short = lng.toLowerCase().startsWith("en") ? "en" : "tr";
  document.documentElement.lang = short;
}

syncHtmlLang(i18n.language);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;

export function setLanguage(lng: "tr" | "en"): void {
  void i18n.changeLanguage(lng);
}
