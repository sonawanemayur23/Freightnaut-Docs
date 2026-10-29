import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (
  process.env.NODE_ENV !== "development" ||
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw new Error("Reset is restricted to the local development database.");
const realmPath = new URL("../.local/keycloak/realm.json", import.meta.url);
const realm = JSON.parse(await readFile(realmPath, "utf8"));
realm.verifyEmail = false;
await writeFile(realmPath, JSON.stringify(realm, null, 2), { mode: 0o600 });
const envPath = new URL("../.env", import.meta.url);
let env = await readFile(envPath, "utf8");
env = env.replace(/^LOCAL_SELF_SERVICE_SIGNUP=.*\n?/m, "");
await writeFile(envPath, env.trimEnd() + "\nLOCAL_SELF_SERVICE_SIGNUP=true\n", {
  mode: 0o600,
});
for (const args of [
  ["compose", "-p", "freightnautdocs-dev", "down", "--volumes"],
  ["compose", "-p", "freightnautdocs-dev", "up", "-d"],
]) {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Local service reset failed.");
}
console.log(
  "Cleared only freightnautdocs-dev service data. Credentials preserved. Local email verification is off; production remains unchanged. Run npm run db:migrate when Postgres is ready.",
);
