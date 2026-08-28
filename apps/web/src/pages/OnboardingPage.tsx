import { useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ScanLine, Bell, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";

// `Icon: null` → render the garage BrandMark instead of a lucide glyph.
const SLIDES: { key: string; Icon: LucideIcon | null }[] = [
  { key: "scan", Icon: ScanLine },
  { key: "remind", Icon: Bell },
  { key: "garage", Icon: null },
];

const SEEN_KEY = "garajim.onboardingSeen";

function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Private mode / storage disabled — show the carousel rather than skip it.
    return false;
  }
}

function markOnboardingSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Read once, at mount: finishing sets the flag, and re-reading it mid-render
  // would redirect the very user who is still on the last slide.
  const [seen] = useState(hasSeenOnboarding);
  const last = index >= SLIDES.length - 1;

  /**
   * Every signed-out route lands on /welcome, so an expired session, a sign-out
   * or a reinstall-restore all used to re-run the three-slide carousel before
   * the user could reach the sign-in form. Once it has been seen we go straight
   * to auth.
   */
  if (seen) return <Navigate to="/sign-in" replace />;

  /** `intent` picks the tab: someone who just watched the pitch has no account
   *  yet, so "Başla" opens sign-up. Skipping reads as "I already know this" —
   *  and that is nearly always a returning user, so it opens sign-in. */
  function finish(intent: "signup" | "signin") {
    markOnboardingSeen();
    navigate(intent === "signup" ? "/sign-up" : "/sign-in", { replace: true });
  }

  function onScroll() {
    const el = trackRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(i);
  }

  function next() {
    if (last) {
      finish("signup");
      return;
    }
    const el = trackRef.current;
    if (el) el.scrollTo({ left: (index + 1) * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-bg pl-safe pr-safe pt-safe pb-safe dark:bg-bg-dark">
      {/* ignition glow — same accent backdrop as the auth screen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55dvh] [mask-image:radial-gradient(75%_60%_at_50%_0%,#000,transparent)]"
      >
        <div className="absolute left-1/2 top-[-20%] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[110px] dark:bg-accent/20" />
      </div>

      {/* Skip */}
      <div className="relative flex justify-end px-5 pt-3">
        <button
          type="button"
          onClick={() => finish("signin")}
          className="min-h-[44px] rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
        >
          {t("onboarding.skip")}
        </button>
      </div>

      {/* Slide track (native CSS scroll-snap — smooth in WKWebView) */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="relative flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {SLIDES.map(({ key, Icon }, i) => (
          <section
            key={key}
            aria-hidden={i !== index}
            className="flex h-full w-full shrink-0 snap-center flex-col items-center justify-center gap-6 px-8 text-center"
          >
            <div className="relative">
              <div aria-hidden className="absolute inset-0 -z-10 rounded-[1.6rem] bg-accent/30 blur-2xl" />
              <div className="grid h-[84px] w-[84px] place-items-center rounded-[1.6rem] border border-border bg-surface text-text shadow-card dark:border-border-dark dark:bg-surface-dark dark:text-text-dark">
                {Icon ? (
                  <Icon className="h-9 w-9 text-accent-dim" />
                ) : (
                  <BrandMark showWordmark={false} className="[&>svg]:h-10 [&>svg]:w-auto" />
                )}
              </div>
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <h2 className="text-balance text-[26px] font-semibold leading-tight tracking-tight">
                {t(`onboarding.slides.${key}.title`)}
              </h2>
              <p className="max-w-[32ch] text-[15px] leading-relaxed text-muted dark:text-muted-dark">
                {t(`onboarding.slides.${key}.body`)}
              </p>
            </div>
          </section>
        ))}
      </div>

      {/* Dots + primary action */}
      <div className="relative flex flex-col items-center gap-5 px-8 pb-6 pt-2">
        <div className="flex items-center gap-1.5">
          {SLIDES.map((s, i) => (
            <span
              key={s.key}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-accent" : "w-1.5 bg-border-strong dark:bg-border"
              }`}
            />
          ))}
        </div>
        <Button type="button" variant="accent" size="lg" onClick={next} className="w-full shadow-ignite">
          {t(last ? "onboarding.getStarted" : "onboarding.next")}
        </Button>
      </div>
    </div>
  );
}
