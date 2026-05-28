import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./apps/web/src/**/*.{ts,tsx}",
    "./packages/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        forest: {
          950: "#03110d",
          900: "#061b15",
          800: "#08281f",
          700: "#0B3D2E",
          600: "#115640",
          500: "#1d7659"
        },
        surface: {
          950: "#050505",
          900: "#0a0b0b",
          850: "#0f1111",
          800: "#151818",
          700: "#202525"
        }
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "SFMono-Regular", "Menlo", "monospace"]
      },
      boxShadow: {
        premium: "0 24px 80px rgba(0, 0, 0, 0.45)",
        glow: "0 0 60px rgba(29, 118, 89, 0.32)"
      }
    }
  },
  plugins: []
};

export default config;
