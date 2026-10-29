// filepath: apps/api/src/documents/worker.ts
import { config as dotenv } from "dotenv";
dotenv({ path: process.env.ENV_FILE ?? ".env", quiet: true });
import { loadConfig } from "../config.js";
import { createPool, assertRuntimeRole } from "../db.js";
import { DocumentRunner } from "./runner.js";
const config = loadConfig(),
  pool = createPool(config);
await assertRuntimeRole(pool);
const recentEvents = new Map<string, number>();
const runner = new DocumentRunner(pool, config, (event) => {
  const now = Date.now();
  if (now - (recentEvents.get(event) ?? 0) > 30000) {
    console.warn(JSON.stringify({ event }));
    recentEvents.set(event, now);
  }
});
runner.start();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void runner
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0));
  });
console.log("Document worker started.");
