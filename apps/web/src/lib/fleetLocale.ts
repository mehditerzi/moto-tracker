import i18n from "@/lib/i18n";

/**
 * The fleet vocabulary, loaded on demand.
 *
 * `lib/i18n.ts` imports tr.json and en.json statically, so every string in them
 * lands in the entry bundle that a consumer downloads on first paint. The fleet
 * screens need roughly 16 kB of Turkish and 16 kB of English that a user with no
 * organization will never render — a tenth of the entry payload, spent on copy
 * for a product they cannot see (docs/fleet-design.md §1).
 *
 * So the manager-facing half lives in its own pair of files and is registered
 * here, once, before any fleet screen mounts. What stays in the always-loaded
 * files is only what a DRIVER's consumer dashboard renders: the company-vehicle
 * marker, the standing monitoring notice and the three limits it expands to.
 * Those must never be late, because they are a legal disclosure.
 *
 * Both languages are fetched together (~6 kB gzipped) so switching language
 * inside the fleet UI does not need a second round trip.
 */
let pending: Promise<void> | null = null;

export function ensureFleetLocale(): Promise<void> {
  if (!pending) {
    pending = Promise.all([
      import("@/locales/fleet.tr.json"),
      import("@/locales/fleet.en.json"),
    ])
      .then(([tr, en]) => {
        // deep = true so this merges INTO the `fleet` object the main bundle
        // already contributed rather than replacing it.
        i18n.addResourceBundle("tr", "translation", tr.default, true, true);
        i18n.addResourceBundle("en", "translation", en.default, true, true);
      })
      .catch((e) => {
        // A failed chunk fetch must not permanently poison the module: clear the
        // memo so the next navigation retries instead of rendering raw keys.
        pending = null;
        throw e;
      });
  }
  return pending;
}

/** Resolve a lazy page only once its strings are registered. */
export function withFleetLocale<T>(load: () => Promise<T>): Promise<T> {
  return ensureFleetLocale().then(load);
}
