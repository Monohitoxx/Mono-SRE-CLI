import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.tsx"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ["react", "ink", "yoga-layout", "better-sqlite3"],
  noExternal: [],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
