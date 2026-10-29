import { chromium, type Browser } from "playwright";
import type { AppConfig } from "../config.js";
import { HttpError } from "../errors.js";
export class PdfRenderer {
  private active = 0;
  constructor(private config: AppConfig) {}
  async render(html: string): Promise<Buffer> {
    if (this.active >= this.config.PDF_CONCURRENCY)
      throw new HttpError(
        429,
        "Document generation is busy. Please retry shortly.",
      );
    this.active++;
    let browser: Browser | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      browser = await chromium.launch({
        headless: true,
        timeout: this.config.PDF_TIMEOUT_MS,
      });
      deadline = setTimeout(() => {
        void browser?.close();
      }, this.config.PDF_TIMEOUT_MS);
      deadline.unref();
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(this.config.PDF_TIMEOUT_MS);
      await page.route("**/*", (route) => route.abort());
      await page.setContent(html, { timeout: this.config.PDF_TIMEOUT_MS });
      return await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
    } finally {
      if (deadline) clearTimeout(deadline);
      try {
        await browser?.close();
      } finally {
        this.active--;
      }
    }
  }
}
