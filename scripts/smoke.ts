import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { sampleShipment } from "@freightnaut/domain";
const output = process.env.SMOKE_OUTPUT ?? "../work/verification";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "Goods & packages" }).waitFor();
  assert((await page.getByText("23,952.00", { exact: false }).count()) > 0);
  await page.screenshot({ path: output + "/workspace.png", fullPage: true });
  const qty = page.getByRole("spinbutton", {
    name: "Quantity line 1",
    exact: true,
  });
  await qty.fill("0");
  await page.getByRole("button", { name: "Review documents" }).click();
  await page.getByText("Line 1: quantity must be greater than zero.").waitFor();
  await page.getByRole("button", { name: /Line 1: quantity/ }).click();
  await qty.waitFor();
  await page.waitForFunction(
    () => document.activeElement?.id === "items.0.quantity",
  );
  await qty.fill("960");
  await page.reload();
  await page
    .getByRole("spinbutton", { name: "Quantity line 1", exact: true })
    .waitFor();
  assert.equal(await qty.inputValue(), "960");
  await page.getByRole("button", { name: "Packing list", exact: true }).click();
  await page
    .frameLocator("iframe")
    .getByRole("heading", { name: "PACKING LIST", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  for (const type of ["invoice", "packing-list"]) {
    const response = await page.request.post(
      `http://127.0.0.1:3001/api/documents/${type}/pdf`,
      { data: sampleShipment },
    );
    assert.equal(response.status(), 200, await response.text());
    const bytes = await response.body();
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    await writeFile(output + "/" + type + ".pdf", bytes);
  }
  const long = structuredClone(sampleShipment);
  long.items = Array.from({ length: 80 }, (_, i) => ({
    ...sampleShipment.items[0],
    id: String(i),
    description: `Goods line ${i + 1} — long sample description for pagination verification`,
  }));
  const response = await page.request.post(
    "http://127.0.0.1:3001/api/documents/invoice/pdf",
    { data: long },
  );
  assert.equal(response.status(), 200);
  await writeFile(output + "/multipage.pdf", await response.body());
  console.log(
    "Smoke passed: editable totals, fix navigation, draft restore, document switch, mobile overflow, no browser exceptions, two PDFs and multipage PDF.",
  );
} finally {
  await browser.close();
}
