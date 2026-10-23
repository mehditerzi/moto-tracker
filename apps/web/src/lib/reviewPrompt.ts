import { requestNativeReview } from "@/lib/nativeIap";
import { track } from "@/lib/telemetry";

/**
 * When to ask for an App Store rating.
 *
 * Ratings are the strongest App Store ranking signal we can influence, and the
 * only moment worth asking is right after the app did something useful. So we
 * count successes (a saved date, a scan applied, a cost logged — every success
 * toast) and ask on the Nth, never in the first days, and at most once per
 * window. Apple caps the system prompt at three a year on top of this and may
 * show nothing at all, which is fine: it is a request, not a dialog we own.
 */
const KEY = "garajim.reviewPrompt";
const SUCCESSES_BEFORE_ASK = 4;
const MIN_DAYS_INSTALLED = 2;
const MIN_DAYS_BETWEEN_ASKS = 120;
const DAY = 24 * 3600 * 1000;

interface State {
  firstSeen: number;
  successes: number;
  lastAsked: number | null;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* storage unavailable — fall through to a fresh state */
  }
  return { firstSeen: Date.now(), successes: 0, lastAsked: null };
}

function save(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function notePositiveMoment(): void {
  const s = load();
  s.successes += 1;
  const now = Date.now();
  const installedLongEnough = now - s.firstSeen >= MIN_DAYS_INSTALLED * DAY;
  const notAskedRecently = s.lastAsked === null || now - s.lastAsked >= MIN_DAYS_BETWEEN_ASKS * DAY;
  if (s.successes >= SUCCESSES_BEFORE_ASK && installedLongEnough && notAskedRecently) {
    s.lastAsked = now;
    s.successes = 0;
    save(s);
    // Let the success toast land first; a prompt on top of it reads as a pop-up.
    setTimeout(() => {
      void requestNativeReview().then((asked) => {
        if (asked) track("review_prompt_requested", {});
      });
    }, 1500);
    return;
  }
  save(s);
}
