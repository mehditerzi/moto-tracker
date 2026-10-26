/**
 * A first line of defence against objectionable text in user content
 * (captions, comments, names, bios) — App Review 1.2 asks for "a method for
 * filtering objectionable material". It is a blunt word list, on purpose:
 * reports and blocks handle what a list cannot, and a false positive here only
 * asks the user to rephrase.
 */
const fold = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/(.)\1{2,}/g, "$1$1");

// Stems: matched at the start of a word, so inflections are covered
// ("orospu", "orospunun"); the list avoids stems that start common words.
const STEMS = [
  "amk", "aminak", "amina", "amcik", "orospu", "orosbu", "pic", "picler", "sik", "siktir", "sikerim", "sikeyim",
  "yarrak", "yarak", "gotveren", "got veren", "ibne", "kahpe", "pezevenk", "kaltak", "serefsiz", "yavsak", "gavat",
  "fuck", "shit", "bitch", "cunt", "dick", "pussy", "whore", "slut", "faggot", "nigger", "nigga", "retard",
];
// Words that start with a stem but are innocent ("dickens", "pickup").
const ALLOW_SET = new Set(["dickens", "dickinson", "pickup", "picnic"]);

export function isObjectionable(text: string | null | undefined): boolean {
  if (!text) return false;
  const words = fold(text).split(/[^a-z]+/).filter(Boolean);
  const joined = words.join(" ");
  for (const w of words) {
    if (ALLOW_SET.has(w)) continue;
    for (const stem of STEMS) {
      if (stem.includes(" ")) continue;
      if (w === stem || (stem.length >= 4 && w.startsWith(stem))) return true;
    }
  }
  return STEMS.some((s) => s.includes(" ") && joined.includes(s));
}
