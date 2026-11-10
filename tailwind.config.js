export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter Variable", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        canvas: "#0F1219",
        bar: "#1D63ED",
        surface: "#161D2D",
        surface2: "#1D2534",
        active: "#1D283A",
        hover: "#1E2B43",
        line: "#2A3441",
        lineStrong: "#34435C",
        ink: "#F1F5F9",
        ink2: "#94A3B8",
        muted: "#6F8199",
        ok: "#2FB47C",
        warn: "#F59E0B",
        crit: "#E5484D",
        blue: "#2496ED",
      },
    },
  },
};
