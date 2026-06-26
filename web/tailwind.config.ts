import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx,md,mdx}", "./mdx-components.tsx"],
  theme: {
    extend: {
      colors: {
        bg: "var(--void)",
        "bg-2": "var(--abyss)",
        void: "var(--void)",
        abyss: "var(--abyss)",
        panel: "var(--panel)",
        "panel-2": "var(--panel-2)",
        line: "var(--line)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        // Cryo accents.
        cyan: "var(--cyan)",
        ice: "var(--ice)",
        frost: "var(--frost)",
        glacier: "var(--glacier)",
        deep: "var(--deep)",
        glow: "var(--glow)",
        aurora: "var(--aurora)",
        // legacy "iris" kept so old classes resolve — remapped to the ice ramp.
        iris: {
          DEFAULT: "#6fe9ff",
          50: "#eafdff",
          100: "#d6faff",
          200: "#a3f0ff",
          300: "#6fe9ff",
          400: "#3e8fe6",
          500: "#2b76c9",
          600: "#164f86",
          700: "#103c66",
          800: "#0c2c4a",
          900: "#081c30",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        display: ["var(--font-bricolage)", "var(--font-geist-sans)", "ui-sans-serif", "sans-serif"],
        serif: ["var(--font-instrument)", "Georgia", "serif"],
      },
      maxWidth: { content: "1200px", prose: "46rem" },
      boxShadow: {
        "glow-cyan": "0 0 60px -10px rgba(111,233,255,0.5)",
        "glow-glacier": "0 0 60px -10px rgba(62,143,230,0.5)",
      },
      keyframes: {
        "fade-up": { "0%": { opacity: "0", transform: "translateY(12px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        float: { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        "pulse-ring": { "0%": { transform: "scale(0.8)", opacity: "0.6" }, "100%": { transform: "scale(2.2)", opacity: "0" } },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in": "fade-in 0.8s ease both",
        float: "float 6s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.16,1,0.3,1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
