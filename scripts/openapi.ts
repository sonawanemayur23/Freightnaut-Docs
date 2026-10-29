import { writeFileSync } from "node:fs";
import { z } from "zod";
import { shipmentSchema } from "@freightnaut/domain";
const shipment = z.toJSONSchema(shipmentSchema);
delete shipment.$schema;
const json = {
  openapi: "3.1.0",
  info: {
    title: "Freightnaut Docs local pilot",
    version: "0.1.0",
    description:
      "Local test draft API. No live issuance or authentication. Bind to loopback only.",
  },
  servers: [{ url: "http://127.0.0.1:3001" }],
  paths: {
    "/api/health": {
      get: {
        operationId: "health",
        responses: { "200": { description: "Local service status" } },
      },
    },
    "/api/sample": {
      get: {
        operationId: "sampleShipment",
        responses: {
          "200": {
            description: "Sample shipment",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Shipment" },
              },
            },
          },
        },
      },
    },
    "/api/validate": {
      post: {
        operationId: "validateShipment",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Shipment" },
            },
          },
        },
        responses: {
          "200": { description: "Pilot validation issues with field paths" },
          "400": { description: "Malformed shipment" },
        },
      },
    },
    "/api/documents/{type}/pdf": {
      post: {
        operationId: "downloadDraft",
        parameters: [
          {
            name: "type",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["invoice", "packing-list"] },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Shipment" },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Test draft PDF; data blockers do not prevent draft download",
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "400": { description: "Invalid document type or shipment" },
          "503": { description: "Chromium rendering unavailable" },
        },
      },
    },
  },
  components: { schemas: { Shipment: shipment } },
};
writeFileSync(
  new URL("../docs/openapi.json", import.meta.url),
  JSON.stringify(json, null, 2) + "\n",
);
