import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1e2528",
        paper: "#fbfaf6",
        olive: "#64734a",
        terracotta: "#b75f3d"
      }
    }
  },
  plugins: []
};

export default config;
