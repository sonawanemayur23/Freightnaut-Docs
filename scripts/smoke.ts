import "dotenv/config";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.PUBLIC_ORIGIN!);
  await page
    .getByRole("heading", { name: "Welcome to Freightnaut Docs." })
    .waitFor();
  await page
    .getByRole("link", { name: /Continue with/ })
    .first()
    .click();
  await page.locator('input[name="username"]').waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Unauthenticated browser flow passes: app redirects to the configured OIDC login. Authenticated coverage: npm run test:integration.",
  );
} finally {
  await browser.close();
}
