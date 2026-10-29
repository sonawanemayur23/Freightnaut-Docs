import { buildApp } from "./app.js";
const app = buildApp();
await app.listen({
  port: Number(process.env.API_PORT ?? 3001),
  host: "127.0.0.1",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
