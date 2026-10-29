import type { Shipment } from "./index.js";
export const sampleShipment: Shipment = {
  custom: {},
  id: "DAC/EXP/26-27/0148",
  date: "2026-10-29",
  buyerPo: "AMAS-PO-77120",
  exporter: {
    name: "Deccan Auto Components Pvt Ltd",
    address: "Plot 42, MIDC Chakan Phase II, Pune 410501, Maharashtra, India",
    taxId: "27AAECD4821K1Z5",
  },
  consignee: {
    name: "Al Mansoori Auto Spares LLC",
    address:
      "Warehouse 14, Al Quoz Industrial Area 3, Dubai, United Arab Emirates",
    taxId: "100384729100003",
  },
  currency: "USD",
  originCountry: "IN",
  destinationCountry: "AE",
  incoterm: "CIF",
  portOfLoading: "Nhava Sheva · INNSA",
  portOfDischarge: "Jebel Ali · AEJEA",
  packages: 24,
  netKg: 1152,
  grossKg: 1240,
  items: [
    {
      id: "1",
      description: "Brake disc rotor, ventilated 280 mm",
      hsCode: "87083000",
      quantity: 960,
      unit: "PCS",
      unitPrice: "14.20",
    },
    {
      id: "2",
      description: "Clutch plate assembly 215 mm",
      hsCode: "87089300",
      quantity: 480,
      unit: "PCS",
      unitPrice: "21.50",
    },
  ],
};
