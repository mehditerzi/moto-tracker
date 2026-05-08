import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: "#F7F7F5", dark: "#0B0B0E" },
        surface: { DEFAULT: "#FFFFFF", dark: "#15151A" },
        "surface-elev": { DEFAULT: "#FFFFFF", dark: "#1D1D24" },
        border: { DEFAULT: "#E6E6E2", dark: "#2A2A33" },
        text: { DEFAULT: "#0B0B0E", dark: "#F4F4F2" },
        muted: { DEFAULT: "#6B6B72", dark: "#9A9AA3" },
        accent: { DEFAULT: "#E1FF4D" },
        success: { DEFAULT: "#37D67A" },
        warning: { DEFAULT: "#F2A93B" },
        danger: { DEFAULT: "#FF4757" },
      },
      fontFamily: {
        sans: ["Geist", "Inter", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "monospace"],
      },
      borderRadius: { xl: "20px" },
    },
  },
  plugins: [],
} satisfies Config;
