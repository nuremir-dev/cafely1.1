"use client";

import { useEffect, useState } from "react";

import type { CreatedOrder } from "@/features/orders/types";
import { getPrintStationId, isPrintStationEnabled, printOrder, printStationEvent } from "@/features/printing/qz-client";

type NextJobResponse = { data: CreatedOrder | null };

export function PrintStation() {
  // The first browser render must match the server render. The persisted
  // station setting is only available after this component mounts.
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "printing" | "error">("idle");

  useEffect(() => {
    const refresh = () => setEnabled(isPrintStationEnabled());
    refresh();
    window.addEventListener(printStationEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(printStationEvent, refresh); window.removeEventListener("storage", refresh); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let busy = false;
    async function poll() {
      if (busy || !alive) return;
      busy = true;
      try {
        const response = await fetch("/api/print-station/next", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stationId: getPrintStationId() }) });
        const payload: unknown = await response.json();
        if (!response.ok || !isNextJobResponse(payload)) throw new Error("Не удалось получить задание печати.");
        if (!payload.data) { if (alive) setStatus("idle"); return; }
        if (alive) setStatus("printing");
        const stationId = getPrintStationId();
        await printOrder(payload.data, async (job, result, lastError) => {
          await fetch(`/api/print-jobs/${job.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: result, lastError: lastError ?? null, stationId }) });
          if (alive) setStatus(result === "failed" ? "error" : "idle");
        });
      } catch { if (alive) setStatus("error"); }
      finally { busy = false; }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 750);
    return () => { alive = false; window.clearInterval(timer); };
  }, [enabled]);

  if (!enabled) return null;
  return <div className={`fixed bottom-4 right-4 z-40 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg ${status === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-teal-200 bg-white text-teal-900"}`}>{status === "printing" ? "Печатаем…" : status === "error" ? "Печатная станция: ошибка" : "Печатная станция включена"}</div>;
}

function isNextJobResponse(value: unknown): value is NextJobResponse { return Boolean(value && typeof value === "object" && "data" in value); }
