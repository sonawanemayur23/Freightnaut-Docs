import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile("apps/api/package.json", "utf8"));
await build({
  entryPoints: {
    server: "apps/api/src/server.ts",
    worker: "apps/api/src/documents/worker.ts",
  },
  outdir: "apps/api/dist",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  target: "node24",
  format: "esm",
  bundle: true,
  sourcemap: true,
  external: [
    ...Object.keys(pkg.dependencies).filter(
      (name) => name !== "@freightnaut/domain",
    ),
    "zod",
    "decimal.js",
  ],
});
