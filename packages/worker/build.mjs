import { build } from "esbuild";

const buildId = String(Date.now());

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/worker.js",
  format: "esm",
  target: "es2022",
  minify: true,
  external: ["node:*"],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
});
