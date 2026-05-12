import type { Config } from "tailwindcss";

export default {
  // Dark mode follows the OS — there's no in-app light/dark toggle.
  darkMode: "media",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Slightly warm near-blacks rather than pure black; reads less harsh
        // and lets the lime accent feel like an LED, not a poster colour.
        bg: { DEFAULT: "#F5F5F2", dark: "#08090C" },
        surface: { DEFAULT: "#FFFFFF", dark: "#10121A" },
        "surface-elev": { DEFAULT: "#FAFAF7", dark: "#181A24" },
        border: { DEFAULT: "#E4E4DE", dark: "#262834" },
        "border-strong": { DEFAULT: "#C8C8C0", dark: "#3A3D4D" },
        text: { DEFAULT: "#0A0A0F", dark: "#F2F2EE" },
        muted: { DEFAULT: "#6B6B72", dark: "#9CA0AD" },
        accent: { DEFAULT: "#E1FF4D", dim: "#A8C235" },
        success: { DEFAULT: "#3DD680" },
        warning: { DEFAULT: "#F2A93B" },
        danger: { DEFAULT: "#FF4F5E" },
      },
      fontFamily: {
        sans: ['"Geist Variable"', "Geist", "Inter", "system-ui", "sans-serif"],
        mono: ['"Geist Mono Variable"', '"Geist Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        // Wide tracking for our small-caps micro-labels (instrument-cluster vibe).
        micro: "0.18em",
      },
      borderRadius: {
        // Slightly less rounded than default shadcn — more "instrument" than "candy".
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        // Soft elevation for cards.
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 2px 0 rgba(0,0,0,0.04)",
        "card-dark":
          "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 2px 0 rgba(0,0,0,0.40)",
        // Lime "ignition" glow under the FAB / primary CTA.
        ignite:
          "0 8px 24px -8px rgba(225,255,77,0.45), 0 2px 8px -2px rgba(225,255,77,0.30)",
      },
      keyframes: {
        // Replaces the default Tailwind `pulse` which dims opacity — we want a
        // glow ring instead so the chip's content stays readable.
        "danger-glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(255,79,94,0.50)" },
          "50%": { boxShadow: "0 0 0 6px rgba(255,79,94,0)" },
        },
        // "Instrument cluster startup" — chip rises and the numeral counts up.
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Scanline used during OCR processing.
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
      animation: {
        "danger-glow": "danger-glow 1.6s ease-in-out infinite",
        "rise-in": "rise-in 0.32s cubic-bezier(0.2,0.8,0.2,1) both",
        scanline: "scanline 1.6s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
