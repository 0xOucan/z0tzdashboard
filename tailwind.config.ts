import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0a0b",
          card: "#111114",
          elevated: "#17171c",
        },
        border: {
          DEFAULT: "#22222a",
          strong: "#2e2e38",
        },
        text: {
          DEFAULT: "#e5e7eb",
          muted: "#9ca3af",
          subtle: "#6b7280",
        },
        accent: {
          DEFAULT: "#a78bfa",
          green: "#34d399",
          red: "#f87171",
          amber: "#fbbf24",
          blue: "#60a5fa",
        },
        chain: {
          base: "#0052ff",
          arb: "#28a0f0",
          eth: "#627eea",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
