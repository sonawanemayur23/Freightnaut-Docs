import Fastify from "fastify";
import { chromium } from "playwright";
import {
  shipmentSchema,
  sampleShipment,
  validateShipment,
  renderDocument,
} from "@freightnaut/domain";
export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
  app.get("/api/health", async () => ({ status: "ok", mode: "local-pilot" }));
  app.get("/api/sample", async () => sampleShipment);
  app.post("/api/validate", async (request, reply) => {
    const parsed = shipmentSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Invalid shipment", details: parsed.error.issues });
    return { issues: validateShipment(parsed.data) };
  });
  app.post("/api/documents/:type/pdf", async (request, reply) => {
    const { type } = request.params as { type: string };
    if (type !== "invoice" && type !== "packing-list")
      return reply.code(400).send({ error: "Unknown document type" });
    const parsed = shipmentSchema.safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Invalid shipment", details: parsed.error.issues });
    // Drafts deliberately remain downloadable with issues; live issuance is not implemented.
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.route("**/*", (route) => route.abort());
      await page.setContent(renderDocument(parsed.data, type));
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      return reply
        .type("application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${type}-draft.pdf"`,
        )
        .send(pdf);
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({
        error:
          "PDF rendering unavailable. Run npm run browser:install, then retry.",
      });
    } finally {
      await browser?.close();
    }
  });
  return app;
}
