import { config as dotenv } from "dotenv";
dotenv({ path: process.env.ENV_FILE ?? ".env", quiet: true });
import { loadConfig } from "./config.js";
import { createPool, assertRuntimeRole } from "./db.js";
import { buildApp } from "./app.js";
const config = loadConfig();
const pool = createPool(config);
await assertRuntimeRole(pool);
const app = await buildApp(config, pool);
const cleanup = setInterval(
  () => {
    void pool
      .query("DELETE FROM login_transactions WHERE expires_at<now()")
      .then(() =>
        pool.query(
          "DELETE FROM sessions WHERE expires_at<now() OR last_seen_at<now()-($1::integer*interval '1 second')",
          [config.SESSION_IDLE_SECONDS],
        ),
      )
      .catch(() =>
        app.log.warn(
          { event: "session.cleanup.failed" },
          "Session cleanup failed",
        ),
      );
  },
  15 * 60 * 1000,
);
cleanup.unref();
app.addHook("onClose", async () => {
  clearInterval(cleanup);
  await pool.end();
});
await app.listen({ port: config.API_PORT, host: config.API_HOST });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
