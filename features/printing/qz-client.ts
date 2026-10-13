"use client";

import type { CreatedOrder, PrintJob } from "@/features/orders/types";
import { customerReceipt, kitchenReceipt } from "./templates";

const SETTINGS_KEY = "cafeline:printers:v1";
export type PrinterSettings = { customerPrinter: string; kitchenPrinter: string };
export const getPrinterSettings = (): PrinterSettings => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"); } catch { return { customerPrinter: "", kitchenPrinter: "" }; } };
export const savePrinterSettings = (settings: PrinterSettings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

let securityConfigured = false;
async function qz() { const api = (await import("qz-tray")).default; if (!securityConfigured) { api.security.setSignatureAlgorithm("SHA512"); api.security.setCertificatePromise((resolve: (value: string) => void, reject: (reason: unknown) => void) => { fetch("/api/print/certificate", { cache: "no-store" }).then(async (response) => { if (response.ok) resolve(await response.text()); else reject(await response.text()); }); }); api.security.setSignaturePromise((request: string) => (resolve: (value: string) => void, reject: (reason: unknown) => void) => { fetch("/api/print/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request }) }).then(async (response) => { const body = await response.json(); if (response.ok) resolve(body.data.signature); else reject(body.error?.message); }); }); securityConfigured = true; } return api; }
export async function getQzPrinters(): Promise<string[]> { const api = await qz(); if (!api.websocket.isActive()) await api.websocket.connect(); return api.printers.find(); }

export async function printOrder(order: CreatedOrder, onResult: (job: PrintJob, status: "submitted" | "failed", error?: string) => Promise<void>, onlyType?: PrintJob["type"]) {
  const settings = getPrinterSettings();
  await Promise.all(order.printJobs.filter((job) => !onlyType || job.type === onlyType).map(async (job) => {
    const printer = job.type === "customer" ? settings.customerPrinter : settings.kitchenPrinter;
    try {
      if (!printer) throw new Error("Принтер не выбран.");
      const api = await qz();
      if (!api.websocket.isActive()) await api.websocket.connect();
      const config = api.configs.create(printer, { units: "mm", size: { width: 80 } });
      await api.print(config, [{ type: "html", format: "plain", data: job.type === "customer" ? customerReceipt(order) : kitchenReceipt(order) }]);
      await onResult(job, "submitted");
    } catch (error) { await onResult(job, "failed", error instanceof Error ? error.message : "Ошибка печати"); }
  }));
}
